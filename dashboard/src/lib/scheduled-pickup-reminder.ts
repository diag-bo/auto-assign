import { SCHEDULE_JOB_LABEL } from "./schedule-job";
import { claimLateAlert } from "./smart-log-kv";
import { clientBotGroups, clientBots, clientBotToken, mentionOf, type ClientBot, type ClientBotGroup } from "./client-bots";
import type { Env } from "./cartrack";
import type { Job, LogLevel } from "./types";
import { sendZaloMessage } from "./zalo";
import { parseVnTimestamp } from "./time";

export const PICKUP_REMINDER_CLAIM = "fixed-pickup-reminder";
/** The pickup window's start the way clients write it: "09:00:00+07:00" → "9h",
 *  "09:30" → "9h30". Left out when the job has no window. */
const message = (time?: string) => {
  const m = /^(\d{2}):(\d{2})/.exec(time ?? "");
  const at = m ? ` **${Number(m[1])}h${m[2] === "00" ? "" : m[2]}**` : "";
  return `Dạ, sắp đến chuyến lấy mẫu cố định${at} của bên mình rồi, cho Diag xin xác nhận với ạ!`;
};

/** The pickup's own time (its scheduled day + window end, else start, else 23:59:59)
 *  is already behind us. A job left parked while the engine was off is released late —
 *  on 25/11 at 07:48 the engine released 24/11's An Sinh 10:20 and Raffles 12:30/17:00
 *  pickups and told both groups a pickup was coming. No scheduled day → can't tell → false. */
export function pickupTimePassed(job: Job, now = Date.now()): boolean {
  const day = job.scheduled_delivery_ts?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const w = job.stops?.find((s) => s.stop_type_id === 1)?.delivery_windows?.[0];
  const hms = (w?.time_to || w?.time_from || "").slice(0, 8);
  const at = parseVnTimestamp(`${day} ${/^\d{2}:\d{2}:\d{2}$/.test(hms) ? hms : "23:59:59"}`).getTime();
  return Number.isFinite(at) && at < now;
}

/** Call only after Cartrack confirms that a queue-driver job was released. */
export async function remindScheduledPickup(
  job: Job,
  env: Env,
  log: (msg: string, level?: LogLevel) => void,
  now = Date.now(),
): Promise<void> {
  if (env !== "prod" || ![2, 4].includes(job.job_status_id ?? 0) || !job.labels?.includes(SCHEDULE_JOB_LABEL)) return;
  const pickup = job.stops?.find((stop) => stop.stop_type_id === 1);
  if (
    !pickup?.customer_id ||
    pickup.stop_status_id !== 1 ||
    pickup.activity_started_ts || pickup.activity_arrived_ts || pickup.activity_completed_ts
  ) return;
  if (pickupTimePassed(job, now)) {
    log(`Job ${job.job_id} - Fixed-pickup Zalo reminder skipped: pickup time already passed (${job.scheduled_delivery_ts?.slice(0, 10)})`, "INFO");
    return;
  }
  let groups: ClientBotGroup[];
  let bots: ClientBot[];
  try {
    groups = (await clientBotGroups()).filter((g) => g.remind && g.customer_id === pickup.customer_id);
    bots = groups.length ? await clientBots() : [];
  } catch (error) {
    log(`Job ${job.job_id} - Fixed-pickup Zalo reminder skipped: bot groups unreadable (${error})`, "WARN");
    return;
  }
  if (!groups.length) return;
  const botOf = (g: ClientBotGroup) => bots.find((b) => b.id === g.bot);
  if (groups.some((g) => { const bot = botOf(g); return !bot || !clientBotToken(bot); })) {
    log(`Job ${job.job_id} - Fixed-pickup Zalo reminder skipped: bot token missing`, "WARN");
    return;
  }
  const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    log(`Job ${job.job_id} - Fixed-pickup Zalo reminder skipped: deduplication storage missing`, "WARN");
    return;
  }

  try {
    // Claim before sending: a stale queue-driver list cannot repeat the reminder.
    if (!(await claimLateAlert(job.job_id, env, 86400, PICKUP_REMINDER_CLAIM))) return;
    for (const group of groups) {
      const bot = botOf(group)!;
      const text = `${message(pickup.delivery_windows?.[0]?.time_from)}\n👉 Nếu hôm nay không có mẫu, có thể nhắc tới **${mentionOf(bot)}** và nhắn "không có mẫu", "chưa có mẫu" hoặc tương tự!`;
      if (!(await sendZaloMessage(clientBotToken(bot), group.chat_id, text, "markdown"))) {
        log(`Job ${job.job_id} - Fixed-pickup Zalo reminder failed`, "WARN");
      } else {
        log(`Job ${job.job_id} - Fixed-pickup Zalo reminder sent to ${group.chat_id}`, "INFO");
      }
    }
  } catch (error) {
    log(`Job ${job.job_id} - Fixed-pickup Zalo reminder failed: ${error}`, "WARN");
  }
}
