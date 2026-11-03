import type { Redis } from "@upstash/redis";
import { sharedRedis } from "./redis";
import { BASE_URL, getDrivers, getHeaders, jsonRpc, type Env } from "./cartrack";
import { sendZaloMessage } from "./zalo";
import { appendGeofenceLog } from "./action-log";

/**
 * Temporarily lets a driver complete stops outside the arrival geofence.
 *
 * Cartrack's fleetweb has no per-stop override, only a per-driver setting
 * (`driver_enforce_stop_arrival_range_enabled`). So we switch it off, remember when
 * to switch it back in a Redis sorted set, and the assign cron (pinged every ~1.5 min)
 * restores anything past due. A failed restore stays in the set and retries next ping —
 * the only unsafe outcome is a geofence left open, so nothing is removed until the
 * restore has actually landed.
 *
 * The update RPC is the one the fleetweb driver modal sends. It carries the whole
 * DELIVERY chunk (shift, locations, capabilities), and whether omitted fields are
 * kept or wiped is unverified — so every field is rebuilt from the live REST record
 * rather than sent partial. `shiftWorkDays` has no REST equivalent; the UI sent []
 * for a driver with none set.
 */

export const BYPASS_MINUTES = 5;
const KEY = "geofence:bypass:v1"; // zset: member `${env}|${deliveryDriverId}`, score = revert-at ms
const RADIUS_M = "200";
const RANGE_KEYS = ["driver_enforce_stop_arrival_range_radius", "driver_enforce_stop_arrival_range_enabled"];
// list of log rows (JSON arrays, GF_LOG_HEADERS order) not yet written to the "Mở Geofence Log" action log
const LOG_KEY = "geofence:log:v1";

function getRedis() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return sharedRedis();
}

interface RestDriver {
  delivery_driver_id: string;
  fleet_driver_id: string;
  registration: string | null;
  start_location_customer_id: string | null;
  end_location_customer_id: string | null;
  shift_time_start: string | null;
  shift_time_end: string | null;
  subuser_id: string | null;
  max_weight: number | null;
  max_volume: number | null;
  special_equipment: { equipment_id: number }[] | null;
}

/** Opening writes a per-driver "off" override. Locking REMOVES the override, so the
 *  driver follows the account-wide rule (on, 400 m) — it used to write its own "on,
 *  200 m", quietly moving every driver ever bypassed off the account radius. Reset
 *  verified on the test account 2026-11-03. */
async function setGeofence(deliveryDriverId: string, enforce: boolean, env: Env): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/drivers/${deliveryDriverId}`, { headers: getHeaders(env), cache: "no-store" });
  const d = ((await res.json().catch(() => null)) as { data?: RestDriver } | null)?.data;
  if (!res.ok || !d?.fleet_driver_id) return `Không đọc được tài xế (HTTP ${res.status})`;

  const out = await jsonRpc("ct_fleet_update_client_driver_details_chunk", {
    type: "DELIVERY",
    client_driver_id: d.fleet_driver_id,
    client_driver_data: {
      id: d.delivery_driver_id,
      registration: d.registration,
      startLocationCustomerId: d.start_location_customer_id,
      endLocationCustomerId: d.end_location_customer_id,
      shiftTimeStart: d.shift_time_start,
      shiftTimeEnd: d.shift_time_end,
      itemContainer: {
        maxWeight: d.max_weight,
        maxVolume: d.max_volume,
        deliveryCapabilities: (d.special_equipment ?? []).map((e) => e.equipment_id),
      },
      subuserId: d.subuser_id,
      shiftWorkDays: [],
      ...(enforce ? { resetSettings: RANGE_KEYS } : { updateDriverSettings: [
        { setting_key: RANGE_KEYS[0], setting_value: RADIUS_M },
        { setting_key: RANGE_KEYS[1], setting_value: "false" },
      ] }),
    },
  }, { env });
  return out.ok ? null : out.error;
}

/** Opens the geofence and schedules the restore. Schedules BEFORE opening, so a crash
 *  between the two can only cause a harmless extra restore, never an unrestored open. */
export async function openGeofence(deliveryDriverId: string, env: Env): Promise<{ error: string } | { until: number }> {
  const redis = getRedis();
  if (!redis) return { error: "Redis chưa cấu hình — không thể hẹn giờ khoá lại" };
  const until = Date.now() + BYPASS_MINUTES * 60_000;
  await redis.zadd(KEY, { score: until, member: `${env}|${deliveryDriverId}` });
  const err = await setGeofence(deliveryDriverId, false, env);
  if (err) {
    await redis.zrem(KEY, `${env}|${deliveryDriverId}`).catch(() => {});
    return { error: err };
  }
  return { until };
}

/** Queue one log row. Written to the action log later by the cron, so the button never waits
 *  on Google. */
export async function queueBypassLog(row: (string | number)[]): Promise<void> {
  await getRedis()?.rpush(LOG_KEY, JSON.stringify(row));
}

/** Write every queued row in one append, then drop exactly those rows (new ones are
 *  pushed to the tail, so LTRIM from n keeps them). Left queued on failure → retried. */
async function flushBypassLog(redis: Redis): Promise<void> {
  const raw = await redis.lrange<unknown>(LOG_KEY, 0, -1);
  if (!raw.length) return;
  const rows = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r) as (string | number)[]);
  await appendGeofenceLog(rows);
  await redis.ltrim(LOG_KEY, rows.length, -1);
}

/** Called from the assign cron. One ZRANGE per ping when nothing is due. The action log
 *  is flushed only when something IS due: every open queues its row before its restore
 *  comes due, so this costs no command on an idle ping. */
export async function restoreExpiredGeofences(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const due = await redis.zrange<string[]>(KEY, 0, Date.now(), { byScore: true });
  if (due.length) {
    await flushBypassLog(redis).catch((e) => console.error("[geofence] action log flush failed:", e instanceof Error ? e.message : e));
  }
  let restored = 0;
  for (const member of due) {
    const [env, id] = member.split("|") as [Env, string];
    const err = await setGeofence(id, true, env);
    if (err) { console.error(`[geofence] restore failed for ${member}: ${err}`); continue; }
    await redis.zrem(KEY, member);
    restored++;
  }
  return restored;
}

/** Accounts deliberately left open: test accounts, the trainees and the supplies
 *  proxy (supervisor, 2026-11-03). Anyone else found open is locked. */
const STAY_OPEN = new Set([
  "8094d712-0f78-11f0-b96d-506b8d982279", // Nguyễn Thành Long (test)
  "31f703f0-002f-11ee-afcc-506b8dbc8dfb", // Test - DC999999 D001
  "7e89ea30-5aea-11f0-95d4-506b8d982279", // Log - Proxy Vật tư C&H
  "387f9e72-98b0-11f1-9378-fa163ee8d8ac", // Học việc 1
  "ed884848-9bab-11f1-9378-fa163ee8d8ac", // Học việc 2
  "3913f960-9bb6-11f1-9378-fa163ee8d8ac", // Học việc 3
  "6f63b538-9c87-11f1-9378-fa163ee8d8ac", // Học việc 4
  "3496b016-9d5b-11f1-9378-fa163ee8d8ac", // Học việc 5
]);

/**
 * The morning sweep. The 5-minute button restores what IT opens; this catches the
 * rest — on 2026-11-03, 23 drivers had the check switched off by hand in Cartrack's
 * driver settings, none of them through the button. Reads every active driver (one
 * RPC per 100), locks each one found open that is not exempt and not inside a live
 * bypass, and tells the admin group who was locked.
 */
export async function lockOpenGeofences(env: Env = "prod"): Promise<{ locked: string[]; failed: string[] }> {
  const drivers = (await getDrivers(env)).filter((d) => d.is_active && !STAY_OPEN.has(d.delivery_driver_id));
  if (!drivers.length) throw new Error("Không đọc được danh sách tài xế");
  const live = new Set(((await getRedis()?.zrange<string[]>(KEY, 0, -1)) ?? []).map((m) => m.split("|")[1]));
  const open: { id: string; name: string }[] = [];
  for (let i = 0; i < drivers.length; i += 100) {
    const r = await jsonRpc<{ drivers: { deliveryDriverId: string; firstName: string | null; lastName: string | null; settings?: { key: string; value: string | null }[] }[] }>(
      "delivery_get_driver_details", { data: { driverIds: drivers.slice(i, i + 100).map((d) => d.delivery_driver_id) } }, { env });
    if (!r.ok) throw new Error(`Không đọc được cài đặt tài xế: ${r.error}`);
    for (const d of r.result.drivers) {
      if (live.has(d.deliveryDriverId)) continue;
      if (d.settings?.find((x) => x.key === RANGE_KEYS[1])?.value === "false") open.push({ id: d.deliveryDriverId, name: `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim() });
    }
  }
  const locked: string[] = [], failed: string[] = [];
  for (const d of open) {
    const err = await setGeofence(d.id, true, env);
    if (err) { console.error(`[geofence] sweep lock failed for ${d.name}: ${err}`); failed.push(d.name); } else locked.push(d.name);
  }
  if (open.length && env === "prod") {
    const list = (names: string[]) => names.map((n) => `• ${n}`).join("\n");
    const text = [
      locked.length ? `🔒 Đã khoá lại kiểm tra vị trí (geofence) cho ${locked.length} tài xế đang bị tắt trên Cartrack:\n${list(locked)}` : "",
      failed.length ? `⚠️ Chưa khoá được ${failed.length} tài xế, cần khoá tay trên Cartrack:\n${list(failed)}` : "",
    ].filter(Boolean).join("\n\n");
    await sendZaloMessage(process.env.ZALO_ADMIN_BOT_TOKEN ?? "", process.env.ZALO_ADMIN_CHAT_ID ?? "", text).catch(() => false);
  }
  return { locked, failed };
}
