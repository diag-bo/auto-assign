// Run: npx tsx scripts/late-alert-stamp.test.mts
// The "Lần cuối" line on the late-pickup Zalo alert: the driver's latest stamp today.
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "mocked";
const { lastDriverStamp, stampText } = await import("../src/lib/assign");

const today = "2026-11-26";
const job = (id: number, driver: string, stops: object[]) => ({ job_id: id, delivery_driver_id: driver, stops });
const day = [
  job(1, "d1", [
    { stop_id: 11, stop_type_id: 1, customer_name: "21362 - CChi - QL22 - PS315 QL22",
      activity_started_ts: `${today} 10:00:00`, activity_arrived_ts: `${today} 10:20:00`, activity_completed_ts: `${today} 10:25:00` },
    { stop_id: 12, stop_type_id: 2, customer_name: "D001", latitude: 10.77, longitude: 106.67,
      activity_started_ts: `${today} 10:25:00`, activity_arrived_ts: `${today} 10:40:00`, activity_completed_ts: `${today} 10:42:00` },
  ]),
  // Another driver's later stamp never counts.
  job(2, "d2", [{ stop_id: 21, stop_type_id: 1, activity_started_ts: `${today} 11:00:00` }]),
  // Yesterday's stamp on a rolled-over job never counts.
  job(3, "d1", [{ stop_id: 31, stop_type_id: 1, activity_completed_ts: `2026-11-25 23:00:00` }]),
];

const s = lastDriverStamp(day, "d1", today)!;
assert.equal(s.stop_id, 12);
assert.equal(stampText(s), "10:42 hoàn thành giao D001");

// The same second: the further-along kind wins (arrived 10:42 + completed 10:42 → completed).
const pick = lastDriverStamp([job(4, "d1", [{ stop_id: 41, stop_type_id: 1, customer_name: "D001",
  activity_arrived_ts: `${today} 10:42:00`, activity_completed_ts: `${today} 10:42:00` }])], "d1", today)!;
assert.equal(stampText(pick), "10:42 hoàn thành lấy D001");

const arrived = lastDriverStamp([job(5, "d1", [{ stop_id: 51, stop_type_id: 1, customer_name: "PS315",
  activity_started_ts: `${today} 10:30:00`, activity_arrived_ts: `${today} 10:50:00` }])], "d1", today)!;
assert.equal(stampText(arrived), "10:50 đã tới PS315");

const started = lastDriverStamp([job(6, "d1", [{ stop_id: 61, stop_type_id: 1, customer_name: "PS200",
  activity_started_ts: `${today} 10:55:00` }])], "d1", today)!;
assert.equal(stampText(started), "10:55 bấm di chuyển tới PS200");

assert.equal(lastDriverStamp(day, "nobody", today), null);
console.log("late-alert-stamp: ok");
