import { SCHEDULE_JOB_LABEL } from "./schedule-job";
import { claimLateAlert } from "./smart-log-kv";
import { clientBotGroups, clientBots, clientBotToken, mentionOf, type ClientBot, type ClientBotGroup } from "./client-bots";
import type { Env } from "./cartrack";
import type { Job, LogLevel } from "./types";
import { sendZaloMessage } from "./zalo";

export { SAMPLE_PICKUP_CUSTOMER_ID } from "./client-bots";
export const PICKUP_REMINDER_CLAIM = "fixed-pickup-reminder";
const MESSAGE = "Dạ, sắp đến giờ lấy mẫu cố định của bên mình rồi ạ. Bên mình hôm nay có mẫu không, cho Diag xin xác nhận với ạ?";

/** Call only after Cartrack confirms that a queue-driver job was released. */
export async function remindScheduledPickup(
  job: Job,
  env: Env,
  log: (msg: string, level?: LogLevel) => void,
): Promise<void> {
  if (env !== "prod" || ![2, 4].includes(job.job_status_id ?? 0) || !job.labels?.includes(SCHEDULE_JOB_LABEL)) return;
  const pickup = job.stops?.find((stop) => stop.stop_type_id === 1);
  if (
    !pickup?.customer_id ||
    pickup.stop_status_id !== 1 ||
    pickup.activity_started_ts || pickup.activity_arrived_ts || pickup.activity_completed_ts
  ) return;
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
      const text = `${MESSAGE}\n👉 Nếu hôm nay không có mẫu, tag **${mentionOf(bot)}** và nhắn "không có mẫu", "chưa có mẫu" hoặc tương tự!`;
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
