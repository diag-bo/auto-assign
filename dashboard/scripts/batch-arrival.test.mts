// Run: npx tsx scripts/batch-arrival.test.mts
import assert from "node:assert/strict";
import { findStuckBatches, type LisBatch } from "../src/lib/batch-arrival";
import type { Job } from "../src/lib/types";

const D001 = "3927b076-3af9-11ed-b939-506b8dbc8dfb";
const now = Date.parse("2026-11-11T10:00:00+07:00");
const job = (id: number, codes: string[], dropAt: string | null, dropId = D001): Job => ({
  job_id: id, item_tracking_numbers: codes, driver: { first_name: "Tài xế" },
  stops: [
    { stop_type_id: 1, customer_id: "branch", activity_completed_ts: "2026-11-11 08:00:00" },
    { stop_type_id: 3, customer_id: dropId, activity_completed_ts: dropAt },
  ],
} as unknown as Job);
const lis = (code: string, status = "transferred", transferred = "2026-11-11T01:00:00Z", dst = "001"): LisBatch =>
  ({ batch_code: code, status, source_location: code.slice(1, 4), destination_location: dst, total_sample: 3, transferred_at: transferred });

const A = "B038261111080000", B = "B038261111081000", C = "B005261111082000", D = "B011261101041618", E = "B014261111083000";
const rows = findStuckBatches(
  [job(1, [A], "2026-11-11 09:00:00"),      // 60 min ago → stuck
   job(2, [B], "2026-11-11 09:45:00"),      // 15 min ago → inside grace
   job(3, [C], null),                        // not delivered yet
   job(4, [E], "2026-11-11 09:00:00", "x")], // delivered somewhere else
  [lis(A), lis(B), lis(C), lis(E), lis(D, "transferred", "2026-11-01T04:16:00Z"), lis("B038261111090000", "completed")],
  [], now);
assert.deepEqual(rows.map((r) => r.code), [D, A], "oldest first; grace, undelivered, elsewhere and completed are left out");
assert.equal(rows[1].job_id, 1);
assert.equal(rows[1].branch, "D038");
assert.equal(rows[0].delivered_at, null, "Labcenter-only row after a day");

// Yesterday's delivery is gone from today's timeline but stays listed while Labcenter still has it open.
const carried = findStuckBatches([], [lis(A)], rows, now + 86_400_000);
assert.deepEqual(carried.map((r) => [r.code, r.delivered_at]), [[A, "2026-11-11 09:00:00"]]);
// …and leaves once Labcenter completes it.
assert.deepEqual(findStuckBatches([], [], rows, now + 86_400_000), []);
// "arrived" and "completed" both mean done: no alarm, even long after the drop-off.
for (const status of ["arrived", "completed"]) {
  assert.deepEqual(findStuckBatches([job(1, [A], "2026-11-11 09:00:00")], [lis(A, status, "2026-11-01T04:16:00Z")], rows, now), [], status);
}
// Not headed to D001 in Labcenter → never listed.
assert.deepEqual(findStuckBatches([job(1, [A], "2026-11-11 09:00:00")], [lis(A, "transferred", "2026-11-11T01:00:00Z", "007")], [], now), []);
console.log("batch-arrival ok");
