import { botToken } from "./kiot-bot";
import { sbSelect } from "./supabase-rest";

// Client Zalo bots, the groups they sit in and what each group lets them do —
// Supabase `client_bots` / `client_bot_groups` / `client_bot_settings`, edited from
// Master Setup → "Bot khách hàng". What the actions DO lives in client-bot-actions.ts.

/** token/webhook_secret never leave the server: the API strips them. */
export type ClientBot = { id: string; name: string; token: string | null; webhook_secret: string | null };

/** remind = fixed-pickup reminder on release; cancel = "không có mẫu" cancels it;
 *  request = a keyword books a trip; guide = "how to use" message Mon–Sat at guide_time. */
export type ClientBotGroup = {
  bot: string; chat_id: string; customer_id: string; label: string;
  remind: boolean; cancel: boolean; request: boolean; guide: boolean; guide_time: string;
};

/** The bots that predate the table: env tokens, webhooks on their own routes
 *  (Điều Phối X also answers revenue), so the panel never re-registers them. */
export const LEGACY_BOTS = ["dieu_phoi", "giao_nhan_mau", "an_sinh"];

export const mentionOf = (bot: Pick<ClientBot, "name">) => `@${bot.name}`;

export function clientBotToken(bot: ClientBot): string {
  if (bot.token) return bot.token;
  if (bot.id === "giao_nhan_mau") return process.env.ZALO_SAMPLE_BOT_TOKEN?.trim() || "";
  if (bot.id === "dieu_phoi") return botToken();
  if (bot.id === "an_sinh") return process.env.ZALO_ANSINH_BOT_TOKEN?.trim() || "";
  return "";
}

export async function clientBots(): Promise<ClientBot[]> {
  return sbSelect<ClientBot>("client_bots", "select=id,name,token,webhook_secret&order=created_at.asc,id.asc");
}

/** Every group. Throws when Supabase can't be read — callers in a client group
 *  must then stay silent, not fall through to the revenue bot's replies. */
export async function clientBotGroups(): Promise<ClientBotGroup[]> {
  // The table is the whole list. ZALO_SAMPLE_CHAT_ID (TECCO) is no longer read: that
  // group was closed, and an env group could not be removed from the panel.
  return sbSelect<ClientBotGroup>("client_bot_groups",
    "select=bot,chat_id,customer_id,label,remind,cancel,request,guide,guide_time&order=bot.asc,label.asc");
}

export async function requestKeywords(): Promise<string[]> {
  const [row] = await sbSelect<{ request_keywords: string[] }>("client_bot_settings", "select=request_keywords&id=eq.1");
  return row?.request_keywords ?? [];
}

/** The bot and, when the chat is one of its client groups, that group. */
export async function botContext(botId: string, chatId: string): Promise<{ bot?: ClientBot; group?: ClientBotGroup }> {
  const [bots, groups] = await Promise.all([clientBots(), clientBotGroups()]);
  return { bot: bots.find(b => b.id === botId), group: groups.find(g => g.bot === botId && g.chat_id === chatId) };
}
