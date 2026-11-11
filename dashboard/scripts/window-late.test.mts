// Run: npx tsx scripts/window-late.test.mts
import assert from "node:assert/strict";
import type { Job } from "../src/lib/types";

process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "mocked";
process.env.ZALO_ADMIN_BOT_TOKEN = "mocked";
process.env.ZALO_ADMIN_CHAT_ID = "supervisors";
const { computePickupWarnings, computeLateAlerts, alertLateJobs } = await import("../src/lib/assign");

const today = "2026-10-03";
const originalDate = Date;
const originalFetch = globalThis.fetch;
const at = (hhmmss: string) => new originalDate(`${today}T${hhmmss}+07:00`).getTime();
let now = at("09:30:00");
// Both Date.now() and new Date() must use the same clock (quiet-hours guard).
globalThis.Date = class extends originalDate {
  constructor(value: string | number = now) { super(value); }
  static now() { return now; }
} as DateConstructor;

const job: Job = {
  job_id: 101, job_status_id: 4, delivery_driver_id: "driver-1",
  scheduled_delivery_ts: `${today} 09:00:00`,
  stops: [
    { stop_id: 1, stop_type_id: 1, stop_status_id: 1, customer_id: "clinic", customer_name: "Clinic",
      delivery_windows: [{ time_from: "09:00:00+07:00", time_to: "09:30:00+07:00" }] },
    { stop_id: 2, stop_type_id: 2, stop_status_id: 1, customer_id: "lab" },
  ],
};
const withPickup = (extra: object, id = job.job_id): Job =>
  ({ ...job, job_id: id, stops: [{ ...job.stops[0], ...extra }, job.stops[1]] });
const claims = new Set<string>();
const messages: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://redis.test")) {
    const body = JSON.parse(String(init?.body));
    // Only the once-per-job claim writes; every read (the stale-window cache) is empty.
    const run = (c: (string | number)[]) => {
      if (String(c[0]).toLowerCase() !== "set") return { result: null };
      assert.ok(c.includes("nx"));
      const key = String(c[1]);
      const result = claims.has(key) ? null : "OK";
      claims.add(key);
      return { result };
    };
    // A pipeline posts a list of commands; a single command posts itself.
    return Response.json(Array.isArray(body[0]) ? body.map(run) : run(body));
  }
  if (url.startsWith("https://bot-api.zaloplatforms.com/")) {
    messages.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response(null, { status: 200 });
  }
  // Cartrack (the stale-window booking-time lookup): unreachable → the alert is kept.
  return new Response(null, { status: 500 });
};
const alert = (jobs: Job[], env: "prod" | "uat" = "prod") => alertLateJobs(jobs, today, env, () => {});

try {
  // ── Windowed: 30 minutes after the window STARTS ──
  now -= 1_000;
  assert.deepEqual(computeLateAlerts([job], today, {}), [], "09:29:59 is inside the grace");
  await alert([job]);
  assert.equal(messages.length, 0);
  now += 1_000;
  const due = computeLateAlerts([job], today, {});
  assert.equal(due.length, 1, "09:30 is exactly thirty minutes after the window start");
  assert.equal(due[0].minutes_late, 30);
  await alert([job], "uat");
  assert.equal(claims.size, 0, "UAT cannot consume a production claim");
  await alert([job]);
  await alert([job]);
  assert.equal(messages.length, 1, "subsequent cycles do not repeat the alert");
  assert.match(messages[0], /Trễ lấy mẫu ~30 phút/);
  assert.match(messages[0], /khung giờ 09:00–09:30/);

  // ── The test is ARRIVAL: on the way is still late, arrived is not ──
  assert.equal(computeLateAlerts([withPickup({ activity_started_ts: `${today} 09:20:00` })], today, {}).length, 1);
  assert.deepEqual(computeLateAlerts([withPickup({ activity_started_ts: `${today} 09:20:00`, activity_arrived_ts: `${today} 09:28:00` })], today, {}), []);
  const busy: Job = { ...job, job_id: 102, stops: [{ stop_id: 9, stop_type_id: 1, activity_started_ts: `${today} 09:20:00` }] };
  assert.equal(computeLateAlerts([job, busy], today, {}).filter((a) => a.job_id === 101).length, 1, "a busy driver defers nothing");

  // ── ASAP: booking + the client's ETA + 30 ──
  const asap = withPickup({ delivery_windows: [] }, 103);
  const eta = { clinic: 45 };
  assert.deepEqual(computeLateAlerts([asap], today, eta, at("10:14:59")), []);
  const [late] = computeLateAlerts([asap], today, eta, at("10:15:00"));
  assert.equal(late?.minutes_late, 30);
  assert.equal(late?.ref, "ETA 09:45");
  assert.deepEqual(computeLateAlerts([asap], today, {}, at("10:29:59")), [], "no ETA on file counts as 60 minutes");
  assert.equal(computeLateAlerts([asap], today, {}, at("10:30:00"))[0]?.ref, "ETA 10:00");
  assert.deepEqual(computeLateAlerts([asap], today, null, at("12:00:00")), [], "ETA read failed: wait, do not guess");

  // ── The dashboard list keeps its own marks ──
  assert.deepEqual(computePickupWarnings([job], today), [], "window end + 5 has not come yet at 09:30");
  now = at("09:35:00");
  assert.equal(computePickupWarnings([job], today).length, 1);

  now = at("21:30:00");
  await alert([{ ...job, job_id: 105 }]);
  assert.equal(messages.length, 1, "21:30 cutoff remains in effect");
  assert.ok(!claims.has("assign:late_alert:prod:105"));
  console.log("Window late-alert checks passed.");
} finally {
  globalThis.Date = originalDate;
  globalThis.fetch = originalFetch;
}
