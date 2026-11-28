/**
 * Idle by choice (lib/idle.ts): each rule, and the cases it must NOT count.
 *
 *   npx tsx scripts/idle.test.mts
 */
const { idleDay } = await import("../src/lib/idle");
type Leg = Parameters<typeof idleDay>[0][number];

const D = "2026-11-27";
const T = (hm: string) => `${D}T${hm}:00+07:00`;
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const leg = (o: Partial<Leg> & { seq: number }): Leg => ({
  from_name: "A", to_name: "B", departed_ts: null, arrived_ts: null, tat_mins: null, benchmark_mins: null,
  unscored: false, from_arrived_ts: null, from_ready_at: null, from_due_at: null, from_opens_at: null,
  to_ready_at: null, to_due_at: null, start_ts: null, start_bench_mins: null, ...o,
});
const shift = [{ start: "06:00", end: "15:00" }];

// RIDE: past benchmark + 15, only the excess counts.
{
  const r = idleDay([leg({ seq: 1, departed_ts: T("08:00"), arrived_ts: T("09:00"), tat_mins: 60, benchmark_mins: 20 })], shift, D);
  check("slow ride counts minutes past benchmark + 15", r.idle_mins === 25, JSON.stringify(r.events));
  const ok = idleDay([leg({ seq: 1, departed_ts: T("08:00"), arrived_ts: T("08:35"), tat_mins: 35, benchmark_mins: 20 })], shift, D);
  check("inside the 15-min grace is not idle", ok.idle_mins === 0);
  const out = idleDay([leg({ seq: 1, departed_ts: T("08:00"), arrived_ts: T("10:00"), tat_mins: 120, benchmark_mins: 20, unscored: true })], shift, D);
  check("unscored outbound ride is not judged", out.idle_mins === 0);
}

// SCHEDULED stop: deadline = later of window end and ready+benchmark, no grace.
{
  const early = idleDay([leg({ seq: 1, departed_ts: T("09:00"), arrived_ts: T("10:25"), tat_mins: 85, benchmark_mins: 20, to_due_at: T("10:30") })], shift, D);
  check("leaving early, arriving inside the window is not idle", early.idle_mins === 0, JSON.stringify(early.events));
  const late = idleDay([leg({ seq: 1, departed_ts: T("09:00"), arrived_ts: T("10:40"), tat_mins: 100, benchmark_mins: 20, to_due_at: T("10:30") })], shift, D);
  check("past the window end counts from the first minute", late.idle_mins === 10, JSON.stringify(late.events));
  const handedLate = idleDay([leg({ seq: 1, departed_ts: T("09:00"), arrived_ts: T("10:45"), tat_mins: 30, benchmark_mins: 32, to_ready_at: T("10:20"), to_due_at: T("10:30") })], shift, D);
  check("job ready too late to make the window moves the deadline", handedLate.idle_mins === 0, JSON.stringify(handedLate.events));
}

// FIRST stop: from shift start + ride from the check-in place.
{
  const l = { seq: 1, from_arrived_ts: T("06:50"), start_ts: T("05:55"), start_bench_mins: 20 };
  const r = idleDay([leg(l)], shift, D);
  check("late first stop counts past shift start + expected ride", r.idle_mins === 30, JSON.stringify(r.events));
  check("no check-in place → no first-stop verdict", idleDay([leg({ ...l, start_bench_mins: null })], shift, D).idle_mins === 0);
  check("no shift → no first-stop verdict", idleDay([leg(l)], [], D).idle_mins === 0);
  const sched = idleDay([leg({ ...l, from_due_at: T("07:00") })], shift, D);
  check("first stop with a later window is judged by the window", sched.idle_mins === 0);
}

// STAY: > 20 min after the next job was ready; not waiting for a window, not at hubs.
{
  const base = { seq: 1, from_arrived_ts: T("08:00"), departed_ts: T("08:50") };
  check("long stay counts past 20 min", idleDay([leg(base)], shift, D).idle_mins === 30);
  check("stay counted only once the next job was ready",
    idleDay([leg({ ...base, to_ready_at: T("08:25") })], shift, D).idle_mins === 5);
  check("waiting for the stop's own window to open is not idle",
    idleDay([leg({ ...base, from_opens_at: T("08:30") })], shift, D).idle_mins === 0);
  check("hub PSC stays are exempt", idleDay([leg({ ...base, from_name: "BRA - D007" })], shift, D).idle_mins === 0);
}

// LUNCH: biggest event starting 11:00–14:00 excused up to 60 min, once.
{
  const r = idleDay([
    leg({ seq: 1, departed_ts: T("11:30"), arrived_ts: T("13:30"), tat_mins: 120, benchmark_mins: 20 }), // 85 over
    leg({ seq: 2, departed_ts: T("13:40"), arrived_ts: T("14:30"), tat_mins: 50, benchmark_mins: 10 }),  // 25 over
  ], shift, D);
  check("lunch excuses 60 min of the biggest midday event only", r.idle_mins === 85 - 60 + 25, JSON.stringify(r.events));
}

// WORK time: shift hours, stretched only at the end.
{
  const late = idleDay([leg({ seq: 1, departed_ts: T("15:00"), arrived_ts: T("16:00") })], shift, D);
  check("late finish stretches the shift end", late.work_mins === 10 * 60, String(late.work_mins));
  const early = idleDay([leg({ seq: 1, departed_ts: T("05:00"), arrived_ts: T("05:30") })], shift, D);
  check("early start does not stretch the shift", early.work_mins === 9 * 60, String(early.work_mins));
  check("no shift → no working time", idleDay([], [], D).work_mins === null);
}

// START point without a check-in: the config PSC covering the first arrival.
{
  const { configStartFor } = await import("../src/lib/tat");
  const row = (lat: number, s: string, e: string, fixed: number, rules: number) =>
    ({ driver_id: "x", latitude: lat, longitude: 106, shift_start: s, shift_end: e, fixed_rules: fixed, rules });
  const rows = [row(1, "06:00:00", "15:00:00", 1, 1), row(2, "15:00:00", "21:00:00", 5, 5), row(3, "06:00:00", "15:00:00", 0, 3)];
  check("PSC whose hours cover the first arrival, fixed rules first", configStartFor(rows, T("07:10"))?.lat === 1);
  check("evening first arrival takes the evening PSC", configStartFor(rows, T("16:00"))?.lat === 2);
  check("no rule covers the hour → most rules overall", configStartFor(rows, T("22:00"))?.lat === 2);
  check("no config → no start", configStartFor([], T("07:00")) === null);
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall passed");
