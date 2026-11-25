import assert from "node:assert/strict";
import { buildActiveRouteMap, isDuplicateExemptJob, isPastDayScheduleJob } from "../src/lib/assign";

const job = (id: number, labels: string[] = [], planId: number | null = null) => ({
  job_id: id,
  job_status_id: 4,
  labels,
  last_assigned_plan_id: planId,
  stops: [
    { stop_type_id: 1, stop_status_id: 1, customer_id: "pickup" },
    { stop_type_id: 2, customer_id: "dropoff" },
  ],
});

const scheduled = job(1, ["📅 Lịch cố định"]);
const adHoc = job(2);
const cartrackPlan = job(3, [], 2811861);
assert.equal(isDuplicateExemptJob(scheduled), true);
assert.equal(isDuplicateExemptJob(adHoc), false);
assert.equal(isDuplicateExemptJob(cartrackPlan), false);
assert.equal(buildActiveRouteMap([scheduled]).size, 0);
assert.equal(buildActiveRouteMap([scheduled, adHoc]).get("pickup:dropoff"), 2);

// A fixed trip made for an earlier day is never released from the queue driver.
const fixedFor = (day: string, labels = ["📅 Lịch cố định"]) =>
  ({ job_id: 9, labels, reference_number: `ANSINH_1020_${day}`, stops: [] }) as never;
assert.equal(isPastDayScheduleJob(fixedFor("2026-11-24"), "2026-11-25"), true);
assert.equal(isPastDayScheduleJob(fixedFor("2026-11-25"), "2026-11-25"), false);
assert.equal(isPastDayScheduleJob(fixedFor("2026-11-24", []), "2026-11-25"), false); // not a Lịch cố định job
assert.equal(isPastDayScheduleJob({ job_id: 9, labels: ["📅 Lịch cố định"], reference_number: "ANSINH", stops: [] } as never, "2026-11-25"), false);
console.log("past-day fixed trips: ok");
