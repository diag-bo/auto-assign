/**
 * One-tap chấm công's pure rules: reading Cartrack's last known position, which
 * allowed place the driver is at, and what the one button does next.
 *
 *   npx tsx scripts/cham-cong-tap.test.mts
 */
import assert from "node:assert/strict";
import { positionOf, pickPlace, parseLiveTs, browserFix, agreesWithCartrack, CHAM_CONG_RADIUS_M, type Place } from "../src/lib/cham-cong-geo";
import { nextPunch, sameNext, shiftMidpoint, type PunchTask } from "../src/lib/cham-cong-state";

const NOW = new Date("2026-11-03T07:20:00+07:00");
const live = (positionUpdatedTs: string | null, latitude: number | null = 10.77846, longitude: number | null = 106.67974) =>
  ({ deliveryDriverId: "d", latitude, longitude, positionUpdatedTs, lastOnlineTs: "2026-11-03 07:19:59.000000+07" });

// ── Cartrack live-list time format (seen on prod 2026-11-03) ──
assert.equal(parseLiveTs("2026-11-03 17:56:51.704844+07"), Date.parse("2026-11-03T17:56:51.704+07:00"));
assert.equal(parseLiveTs("2026-11-03 17:56:51.70484+07"), Date.parse("2026-11-03T17:56:51.704+07:00"), "5-digit fraction");
assert.equal(parseLiveTs("2026-11-03 17:56:51"), Date.parse("2026-11-03T17:56:51+07:00"), "bare = VN time");
assert.equal(parseLiveTs("2026-11-03 10:56:51+00"), Date.parse("2026-11-03T17:56:51+07:00"));
assert.ok(Number.isNaN(parseLiveTs("hôm qua")) && Number.isNaN(parseLiveTs(null)));

// ── position ──
assert.deepEqual(positionOf(undefined, NOW), { ok: false, reason: "no_position" });
assert.deepEqual(positionOf(live("2026-11-03 07:19:00", 0, 0), NOW), { ok: false, reason: "no_position" });
assert.deepEqual(positionOf(live("2026-11-03 07:19:00", null, null), NOW), { ok: false, reason: "no_position" });
const real = positionOf(live("2026-11-03 07:18:20.704844+07"), NOW);
assert.ok(real.ok && real.age_s === 99, "the format Cartrack actually sends");
const old = positionOf(live("2026-11-03 05:00:00.000000+07"), NOW);
assert.ok(old.ok && old.age_s === 8400, "the last known fix is used whatever its age");
const noTime = positionOf(live(null), NOW);
assert.ok(noTime.ok && noTime.age_s === null, "no timestamp still uses the fix");

// ── place ──
const D000: Place = { customer_id: "a", name: "D000", lat: 10.77846, lon: 106.67974, why: "branch" };
const D001: Place = { customer_id: "b", name: "D001", lat: 10.76866, lon: 106.67745, why: "branch" };
const stop: Place = { customer_id: "c", name: "Phòng khám", lat: 10.77900, lon: 106.67974, why: "first_stop" };
assert.deepEqual(pickPlace({ lat: 10.77846, lon: 106.67974 }, []), { near: false, nearest: null, distance_m: null });
const atDepot = pickPlace({ lat: 10.77846, lon: 106.67974 }, [D001, stop, D000]);
assert.ok(atDepot.near && atDepot.place.name === "D000" && atDepot.distance_m === 0, "nearest within the radius wins");
const nearStop = pickPlace({ lat: 10.77905, lon: 106.67974 }, [D000, stop]);
assert.ok(nearStop.near && nearStop.place.why === "first_stop");
const away = pickPlace({ lat: 10.7600, lon: 106.6774 }, [D000, D001]);
assert.ok(!away.near && away.nearest?.name === "D001" && away.distance_m! > CHAM_CONG_RADIUS_M, "too far reports the nearest");

// ── the phone's position, and Cartrack's say on it ──
assert.equal(browserFix(null), null);
assert.equal(browserFix({ lat: "10.7", lon: 106.6, accuracy_m: 5 }), null, "numbers only");
assert.equal(browserFix({ lat: 10.7, lon: 106.6 }), null, "no accuracy, no fix");
assert.equal(browserFix({ lat: 0, lon: 0, accuracy_m: 5 }), null);
assert.equal(browserFix({ lat: 91, lon: 106.6, accuracy_m: 5 }), null);
assert.deepEqual(browserFix({ lat: 10.7, lon: 106.6, accuracy_m: 12, extra: 1 }), { lat: 10.7, lon: 106.6, accuracy_m: 12 });
const atBranch = { lat: 10.77846, lon: 106.67974 };
const km15 = { lat: 10.77846 + 15 / 111, lon: 106.67974 };
const ct = (pos: { lat: number; lon: number }, age_s: number | null) => ({ ok: true as const, pos, age_s });
assert.deepEqual(agreesWithCartrack(atBranch, { ok: false, reason: "no_position" }), { ok: true, distance_m: null }, "no Cartrack fix: nothing to contradict");
assert.equal(agreesWithCartrack(atBranch, ct(km15, null)).ok, true, "a fix of unknown age cannot contradict");
assert.equal(agreesWithCartrack(atBranch, ct(km15, 30)).ok, false, "faked: at the branch, Cartrack 15 km away 30 s ago");
assert.equal(agreesWithCartrack(atBranch, ct(atBranch, 30)).ok, true);
assert.equal(agreesWithCartrack(atBranch, ct(km15, 4 * 3600)).ok, true, "app closed for hours: Cartrack cannot say");
assert.equal(agreesWithCartrack(atBranch, ct({ lat: 10.77846 + 2 / 111, lon: 106.67974 }, 180)).ok, true, "drove 2 km in the 3 min since the fix");

// ── next punch ──
const t = (job_id: number, type: PunchTask["type"], done: boolean, at: string): PunchTask => ({ job_id, type, done, at });
assert.deepEqual(nextPunch([], NOW), { action: "create", type: "check-in" });
assert.deepEqual(nextPunch([t(1, "check-in", false, "2026-11-03 06:00:00")], NOW), { action: "complete", job_id: 1, type: "check-in" });
const wait = nextPunch([t(1, "check-in", true, "2026-11-03 07:17:00")], NOW);
assert.equal(wait.action, "wait");
assert.ok(wait.action === "wait" && wait.type === "check-out" && Date.parse(wait.until) === Date.parse("2026-11-03T07:27:00+07:00"));
assert.deepEqual(nextPunch([t(1, "check-in", true, "2026-11-03 07:09:00")], NOW), { action: "create", type: "check-out" });
assert.deepEqual(nextPunch([t(1, "check-in", true, "2026-11-03 07:10:00")], NOW), { action: "create", type: "check-out" }, "exactly 10:00 is allowed");
assert.deepEqual(nextPunch([t(1, "check-in", true, "2026-11-03 06:00:00"), t(2, "check-out", true, "2026-11-03 07:00:00")], NOW),
  { action: "create", type: "check-out" }, "after the first tap, every tap is a check-out — the last one counts");
assert.deepEqual(nextPunch([t(2, "check-out", true, "2026-11-03 07:00:00"), t(1, "check-in", true, "2026-11-03 06:00:00")], NOW),
  { action: "create", type: "check-out" }, "order of the list does not matter");
const again = nextPunch([t(1, "check-in", true, "2026-11-03 06:00:00"), t(2, "check-out", true, "2026-11-03 07:15:00")], NOW);
assert.ok(again.action === "wait" && again.type === "check-out", "the 10-minute gap holds between check-outs too");
assert.deepEqual(nextPunch([t(1, "check-out", true, "2026-11-03 06:00:00")], NOW),
  { action: "create", type: "check-in" }, "a day with only a check-out (made by điều phối) still gets its check-in");
assert.deepEqual(nextPunch([t(1, "check-in", true, "?")], NOW), { action: "create", type: "check-out" }, "an unreadable time does not block");

// ── first tap after the middle of today's shift is a check-out ──
const D = "2026-11-03";
const at = (hhmm: string) => new Date(`${D}T${hhmm}:00+07:00`);
const hoaMid = shiftMidpoint([{ start: "07:00", end: "15:00" }], D);
assert.equal(hoaMid, Date.parse(`${D}T11:00:00+07:00`));
const tuMid = shiftMidpoint([{ start: "15:00", end: "21:30" }, { start: "06:00", end: "15:00" }], D);
assert.equal(tuMid, Date.parse(`${D}T13:45:00+07:00`), "Anh Tú: BO 06:00 to driving 21:30");
assert.equal(shiftMidpoint([], D), null);
assert.equal(shiftMidpoint([{ start: "15:00", end: "15:00" }], D), null);
assert.deepEqual(nextPunch([], at("06:55"), hoaMid), { action: "create", type: "check-in" }, "before the middle: check-in");
assert.deepEqual(nextPunch([], at("15:05"), hoaMid), { action: "create", type: "check-out" }, "forgot to tap in: the lone tap is the check-out");
assert.deepEqual(nextPunch([], at("11:00"), hoaMid), { action: "create", type: "check-out" }, "exactly the middle counts as after");
assert.deepEqual(nextPunch([t(1, "check-out", true, `${D} 15:05:00`)], at("16:00"), hoaMid),
  { action: "create", type: "check-out" }, "after a midpoint check-out, still check-out — the last one counts");
assert.deepEqual(nextPunch([t(1, "check-in", true, `${D} 06:00:00`)], at("09:00"), tuMid), { action: "create", type: "check-out" });
assert.deepEqual(nextPunch([], at("15:05"), null), { action: "create", type: "check-in" }, "no shift: first tap in, then out");
assert.deepEqual(nextPunch([t(1, "check-in", true, `${D} 15:05:00`)], at("15:20"), null), { action: "create", type: "check-out" });

assert.ok(sameNext({ action: "create", type: "check-in" }, { action: "create", type: "check-in" }));
assert.ok(!sameNext({ action: "create", type: "check-in" }, { action: "create", type: "check-out" }));
assert.ok(!sameNext({ action: "complete", job_id: 1, type: "check-in" }, { action: "complete", job_id: 2, type: "check-in" }));

console.log("cham-cong-tap: all assertions passed");
