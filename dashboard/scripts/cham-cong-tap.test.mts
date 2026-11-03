/**
 * One-tap chấm công's pure rules: is the Cartrack position fresh, which allowed place
 * is the driver at, and what does the one button do next.
 *
 *   npx tsx scripts/cham-cong-tap.test.mts
 */
import assert from "node:assert/strict";
import { positionOf, pickPlace, CHAM_CONG_RADIUS_M, type Place } from "../src/lib/cham-cong-geo";
import { nextPunch, sameNext, type PunchTask } from "../src/lib/cham-cong-state";

const NOW = new Date("2026-11-03T07:20:00+07:00");
const live = (lastOnlineTs: string | null, latitude: number | null = 10.77846, longitude: number | null = 106.67974) =>
  ({ deliveryDriverId: "d", latitude, longitude, lastOnlineTs });

// ── position ──
assert.deepEqual(positionOf(undefined, NOW), { ok: false, reason: "no_position" });
assert.deepEqual(positionOf(live("2026-11-03 07:19:00", 0, 0), NOW), { ok: false, reason: "no_position" });
assert.deepEqual(positionOf(live("2026-11-03 07:19:00", null, null), NOW), { ok: false, reason: "no_position" });
assert.deepEqual(positionOf(live(null), NOW), { ok: false, reason: "stale" }, "no timestamp is stale");
assert.deepEqual(positionOf(live("hôm qua"), NOW), { ok: false, reason: "stale" }, "unparseable is stale, never fresh");
assert.deepEqual(positionOf(live("2026-11-03 07:14:59"), NOW), { ok: false, reason: "stale", age_s: 301 });
const fresh = positionOf(live("2026-11-03 07:15:00"), NOW);
assert.ok(fresh.ok && fresh.age_s === 300, "exactly 5 min is still fresh");

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

// ── next punch ──
const t = (job_id: number, type: PunchTask["type"], done: boolean, at: string): PunchTask => ({ job_id, type, done, at });
assert.deepEqual(nextPunch([], NOW), { action: "create", type: "check-in" });
assert.deepEqual(nextPunch([t(1, "check-in", false, "2026-11-03 06:00:00")], NOW), { action: "complete", job_id: 1, type: "check-in" });
const wait = nextPunch([t(1, "check-in", true, "2026-11-03 07:17:00")], NOW);
assert.equal(wait.action, "wait");
assert.ok(wait.action === "wait" && wait.type === "check-out" && Date.parse(wait.until) === Date.parse("2026-11-03T07:27:00+07:00"));
assert.deepEqual(nextPunch([t(1, "check-in", true, "2026-11-03 07:09:00")], NOW), { action: "create", type: "check-out" });
assert.deepEqual(nextPunch([t(1, "check-in", true, "2026-11-03 07:10:00")], NOW), { action: "create", type: "check-out" }, "exactly 10:00 is allowed");
assert.deepEqual(nextPunch([
  t(4, "check-out", true, "2026-11-03 07:00:00"), t(1, "check-in", true, "2026-11-03 05:00:00"),
  t(3, "check-in", true, "2026-11-03 06:30:00"), t(2, "check-out", true, "2026-11-03 06:00:00"),
], NOW), { action: "create", type: "check-in" }, "latest by job id, whatever the order");
assert.deepEqual(nextPunch([t(1, "check-in", true, "?")], NOW), { action: "create", type: "check-out" }, "an unreadable time does not block");

assert.ok(sameNext({ action: "create", type: "check-in" }, { action: "create", type: "check-in" }));
assert.ok(!sameNext({ action: "create", type: "check-in" }, { action: "create", type: "check-out" }));
assert.ok(!sameNext({ action: "complete", job_id: 1, type: "check-in" }, { action: "complete", job_id: 2, type: "check-in" }));

console.log("cham-cong-tap: all assertions passed");
