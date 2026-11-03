import { createJob } from "./cartrack";
import { botContext, clientBotGroups, clientBots, clientBotToken, mentionOf, requestKeywords, type ClientBot, type ClientBotGroup } from "./client-bots";
import { DROPOFF_PHOTO_TODO, LAB_CUSTOMER_ID, PICKUP_PHOTO_TODO } from "./job-filters";
import { classifyPickupReply, getPickupReply, plainText, STAFF_CHECK, stripMentions } from "./scheduled-pickup-cancel";
import { acquireCreateLock, releaseCreateLock } from "./smart-log-kv";
import { getRedis } from "./tat-archive";
import { vnDate, vnHoursMinutes, vnMinutesSinceMidnight } from "./time";
import { notifyAdminGroup, sendZaloMessage } from "./zalo";

// What a client bot does in a group, per the group's switches in "Bot khách hàng".
// Every bot's webhook (the two legacy routes and /api/zalo/bot/[id]) goes through
// replyToGroup, so a group behaves the same whichever bot sits in it.

const GUIDE_COMMANDS = ["huong dan", "help", "?"];

/** Whole-phrase keyword hit, after the bot's own @mention is taken out. */
export function isTripRequest(text: string, keywords: string[], mentions: string[] = []): boolean {
  const plain = stripMentions(text, mentions);
  return keywords.map(plainText).filter(Boolean).some(kw =>
    new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(plain));
}

/** The daily tip (supervisor's wording, 2026-11-03), naming the first three shared
 *  keywords so it never advertises a word that books nothing. null = request is off. */
export function guideText(bot: Pick<ClientBot, "name">, group: ClientBotGroup, keywords: string[]): string | null {
  if (!group.request || !keywords.length) return null;
  const words = keywords.slice(0, 3).map(k => `“${k}”`);
  const said = words.length > 1 ? `${words.slice(0, -1).join(", ")} hoặc ${words.at(-1)}` : words[0];
  return `💡 Gợi ý 💡 khách hàng có thể tag ${mentionOf(bot)} và nhắn ${said} để có thể được hỗ trợ lấy mẫu nhanh nhất.`;
}

/** The client's own words for the pickup note: the bot's @mention removed, the rest
 *  kept as typed, so the note gate and its safe-list see what the client wrote. */
export function noteFromMessage(text: string, botName: string): string {
  const mention = `@${botName}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(mention, "gi"), " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** The bot's reply to a GROUP message in one of its client groups, or null to stay quiet. */
export async function replyToGroup(bot: ClientBot, group: ClientBotGroup, text: string, chatId: string): Promise<string | null> {
  const reply = await groupReply(bot, group, text, chatId);
  // The reply promised a Diag staff check; make sure staff hear about it.
  if (reply?.includes(STAFF_CHECK)) {
    await notifyAdminGroup(`⚠️ Bot Zalo cần kiểm tra — ${group.label || group.customer_id}\nKhách nhắn: “${text}”\nBot trả lời: ${reply}`);
  }
  return reply;
}

async function groupReply(bot: ClientBot, group: ClientBotGroup, text: string, chatId: string): Promise<string | null> {
  const mentions = [mentionOf(bot)];
  const plain = stripMentions(text, mentions).replace(/^\//, "").trim();
  if (GUIDE_COMMANDS.includes(plain)) return guideText(bot, group, await requestKeywords());
  // A "không có mẫu" reply is never a request, even with cancel switched off — it
  // contains the request words ("có mẫu", "lấy mẫu") negated.
  if (classifyPickupReply(text, mentions) !== "ignore") {
    return group.cancel ? getPickupReply(group.customer_id, text, chatId, mentions) : null;
  }
  if (group.request && isTripRequest(text, await requestKeywords(), mentions)) return requestTrip(group, noteFromMessage(text, bot.name));
  return null;
}

type ZaloUpdate = {
  event_name?: string;
  message?: { text?: string; chat?: { id?: string | number; chat_type?: string }; from?: { is_bot?: boolean } };
};

/** A client-only bot's webhook body, after the route has checked the secret. GROUP text
 *  only. A group not yet in "Bot khách hàng" may ask "/id" — that is how its chat id
 *  is found when setting it up; anything else there is ignored. */
export async function handleClientBotUpdate(botId: string, body: unknown): Promise<void> {
  const raw = body as { result?: ZaloUpdate } & ZaloUpdate | null;
  const update = raw && typeof raw === "object" ? raw.result ?? raw : null;
  if (!update || update.event_name !== "message.text.received" || update.message?.from?.is_bot) return;
  const chat = update.message?.chat;
  const chatId = chat?.id == null ? "" : String(chat.id);
  if (!chatId || chat?.chat_type !== "GROUP") return;
  const text = typeof update.message?.text === "string" ? update.message.text : "";

  let ctx: Awaited<ReturnType<typeof botContext>>;
  try {
    ctx = await botContext(botId, chatId);
  } catch (e) {
    console.error(`[client-bot] ${botId}: groups unreadable`, e);
    return;
  }
  const token = ctx.bot ? clientBotToken(ctx.bot) : "";
  if (!ctx.bot || !token) return;
  if (!ctx.group) {
    if (/^(?:@.+?\s+)?\/?id(?:\s+@.+)?$/i.test(text.trim())) {
      if (!(await sendZaloMessage(token, chatId, `Chat ID: ${chatId}`))) console.error(`[client-bot] ${botId}: chat ID reply failed`, chatId);
    }
    return;
  }
  const reply = await replyToGroup(ctx.bot, ctx.group, text, chatId);
  if (reply) await sendZaloMessage(token, chatId, reply, "markdown");
}

/** Client → D001 pickup; the assign cycle places it by config, alt drop-off included.
 *  Created even when today's Lịch cố định trip is still pending (supervisor,
 *  2026-11-03) — that trip is duplicate-exempt, so it does not block this one.
 *  `note` (the client's message) goes on the pickup stop, so the note gate holds the
 *  trip in "Cần xử lý" for a Giao ngay unless the sentence is safe-listed (supervisor,
 *  2026-11-03: review over speed). */
export async function requestTrip(group: ClientBotGroup, note: string): Promise<string> {
  // Double-tag guard only (120s), as /corp: a second real request is allowed after.
  const lockKey = `zalo-bot:${group.customer_id}-${vnDate()}`;
  if (!(await acquireCreateLock(lockKey))) return "Yêu cầu vừa được ghi nhận. Vui lòng đợi 2 phút trước khi gửi lại.";
  const { hours, minutes } = vnHoursMinutes();
  const hhmm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  try {
    const res = await createJob({
      job_type_id: 1,
      schedule_type_id: 1,
      reference_number: `Zalo ${(group.label || "KH").slice(0, 30)}→D001_${hhmm}`,
      stops: [
        { stop_type_id: 1, customer_id: group.customer_id, duration: 5, ...(note ? { note } : {}), todos: [PICKUP_PHOTO_TODO, { todo_type_id: 5, description: "Ghi chú" }] },
        { stop_type_id: 2, customer_id: LAB_CUSTOMER_ID, duration: 5, todos: [DROPOFF_PHOTO_TODO] },
      ],
    }, "prod");
    if (!res.ok) {
      // A 5xx may still have created the trip — keep the lock so a re-tag cannot make a twin.
      if (res.status < 500) void releaseCreateLock(lockKey);
      console.error("[client-bot] trip create failed", group.chat_id, JSON.stringify(res.body).slice(0, 300));
      return `⚠️ Chưa tạo được chuyến lấy mẫu. ${STAFF_CHECK}`;
    }
    const jobId = res.body?.data?.job_id;
    return `✅ Đã nhận yêu cầu lấy mẫu${jobId ? ` (Job #${jobId})` : ""}. Diag sẽ sắp xếp nhân viên qua lấy, xin cám ơn!`;
  } catch (e) {
    console.error("[client-bot] trip create uncertain", group.chat_id, e);
    return `⚠️ Chưa xác nhận được chuyến. ${STAFF_CHECK}`;
  }
}

const hhmmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** A group's guide goes out at most once a day, within an hour of its time. */
const GUIDE_WINDOW_MIN = 60;

/** Cron, every ping: send each group's daily guide, Mon–Sat, once per day. */
export async function maybeClientBotGuides(now = new Date()): Promise<void> {
  const date = vnDate(now);
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return;
  const nowMin = vnMinutesSinceMidnight(now);
  const due = (await clientBotGroups()).filter(g => {
    if (!g.guide) return false;
    const at = hhmmToMin(g.guide_time);
    return nowMin >= at && nowMin < at + GUIDE_WINDOW_MIN;
  });
  if (!due.length) return;
  const redis = getRedis();
  if (!redis) return;
  const [bots, keywords] = await Promise.all([clientBots(), requestKeywords()]);
  for (const group of due) {
    const bot = bots.find(b => b.id === group.bot);
    const text = bot && guideText(bot, group, keywords);
    if (!bot || !text || !clientBotToken(bot)) continue;
    const key = `client_bot_guide:${group.bot}:${group.chat_id}:${date}`;
    if (await redis.set(key, Date.now(), { nx: true, ex: 2 * 86_400 }) !== "OK") continue;
    if (!(await sendZaloMessage(clientBotToken(bot), group.chat_id, text, "markdown"))) {
      console.error("[client-bot] guide send failed", group.bot, group.chat_id);
      await redis.del(key).catch(() => {});
    }
  }
}
