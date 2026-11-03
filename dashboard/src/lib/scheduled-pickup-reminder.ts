import { createHash } from "node:crypto";
import { botToken } from "./kiot-bot";
import { SCHEDULE_JOB_LABEL } from "./schedule-job";
import { claimLateAlert } from "./smart-log-kv";
import type { Env } from "./cartrack";
import type { Job, LogLevel } from "./types";
import { sendZaloMessage } from "./zalo";

export const SAMPLE_PICKUP_CUSTOMER_ID = "81f0d4a6-acf9-11f1-9378-fa163ee8d8ac";
export const PHARMACY_PICKUP_CUSTOMER_ID = "51bfb168-446f-11ed-888f-506b8dbc8dfb";
export const CHAT_BY_CUSTOMER_ID: Record<string, string> = {
  [PHARMACY_PICKUP_CUSTOMER_ID]: "zgr-1c7aa981bbcf52910bde",
  "f88dfab6-b522-11ee-bb52-506b8d9879b5": "zgr-5f2b2b46331ada44830b",
};
export const AN_SINH_CUSTOMER_ID = "f0773008-0f51-11ee-951b-506b8dbc8dfb";

/** A client group served by its own Zalo bot. `chatId` is blank until the group sends "/id". */
export type ClientBot = { customerId: string; mention: string; token?: string; chatId?: string; secret?: string };

/** Keyed by webhook path. Read per call: env is per deployment. */
export function clientBots(): Record<string, ClientBot> {
  const ansinh = process.env.ZALO_ANSINH_BOT_TOKEN;
  return {
    sample: {
      customerId: SAMPLE_PICKUP_CUSTOMER_ID, mention: "@Bot Giao nhận mẫu",
      token: process.env.ZALO_SAMPLE_BOT_TOKEN, chatId: process.env.ZALO_SAMPLE_CHAT_ID,
      secret: process.env.ZALO_SAMPLE_WEBHOOK_SECRET,
    },
    // Secret derived from the token: whoever holds the token controls the bot anyway,
    // and it keeps a new bot to one env var.
    "an-sinh": {
      customerId: AN_SINH_CUSTOMER_ID, mention: "@Bot Trợ Lý Diag", token: ansinh, chatId: "zgr-f12287b103e4eabab3f5",
      secret: ansinh && createHash("sha256").update(ansinh).digest("hex").slice(0, 32),
    },
  };
}

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
  const clientBot = Object.values(clientBots()).find(bot => bot.customerId === pickup?.customer_id);
  const chatId = clientBot
    ? clientBot.chatId
    : pickup?.customer_id ? CHAT_BY_CUSTOMER_ID[pickup.customer_id] : undefined;
  if (
    !pickup || !chatId ||
    pickup.stop_status_id !== 1 ||
    pickup.activity_started_ts || pickup.activity_arrived_ts || pickup.activity_completed_ts
  ) return;

  const token = clientBot ? clientBot.token : botToken();
  if (!token) {
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
    const mention = clientBot?.mention ?? "@Bot Điều Phối X";
    const text = `${MESSAGE}\n👉 Nếu hôm nay không có mẫu, tag **${mention}** và nhắn "không có mẫu", "chưa có mẫu" hoặc tương tự!`;
    if (!(await sendZaloMessage(token, chatId, text, "markdown"))) {
      log(`Job ${job.job_id} - Fixed-pickup Zalo reminder failed`, "WARN");
    } else {
      log(`Job ${job.job_id} - Fixed-pickup Zalo reminder sent to ${chatId}`, "INFO");
    }
  } catch (error) {
    log(`Job ${job.job_id} - Fixed-pickup Zalo reminder failed: ${error}`, "WARN");
  }
}
