/**
 * Leave MISA stopped charging comes back off.
 *
 * The case that started it (2026-11-20): Lâm Sơn Tuấn's requests for 31/10,
 * 06/11, 14/11, 20/11 and 26/11 were filed by the sync on 30/09 and 09/10, then
 * vanished from MISA. A supervisor deleted them by hand one day at a time; 26/11
 * was still on file, both accounts, when it was noticed.
 *
 *   node scripts/leave-withdraw.test.mjs
 */
import assert from "node:assert/strict";
import { withdrawnMisaRows, knownLeaveAccounts, vnToday } from "../lib/leave-push.mjs";

const FT = "ft-1", PT = "pt-1", OTHER = "ft-2", STRANGER = "ft-9";
const known = new Set([FT, PT, OTHER]);
const opts = { to: "2026-12-31", known, today: "2026-11-20" };
const row = (id, driver_id, day, note = "MISA auto 2026-10-09 12:16", leave_to = day) =>
  ({ id, revision: 1, note, driver_id, leave_from: day, leave_to });

const rows = [
  row(1, FT, "2026-11-26"),                                   // MISA dropped it → goes
  row(2, PT, "2026-11-26", "MISA auto PT 2026-10-09 12:16"),  // its twin → goes too
  row(3, FT, "2026-11-27"),                                   // still charged → stays
  row(4, PT, "2026-11-27", "MISA auto PT 2026-10-09 12:16"),  // twin of a charged day → stays
  row(5, FT, "2026-11-28", "Nhập từ dashboard"),              // a person's filing → stays
  row(6, FT, "2026-11-29", 'LEAVE_SPLIT_V1:{"originalNote":"MISA auto"}'), // split by hand → stays
  row(7, FT, "2026-11-19"),                                   // already past → stays
  row(8, FT, "2027-01-05"),                                   // beyond what was read → stays
  row(9, FT, "2026-11-30", "MISA auto 2026-10-09", "2026-12-02"), // multi-day → stays
  row(10, STRANGER, "2026-11-26"),                            // code no longer matches → stays
  row(11, FT, "2026-11-20"),                                  // today, dropped → goes
];
const submissions = [
  { driver_id: FT, date: "2026-11-27" },
  { driver_id: PT, date: "2026-11-27", pt_companion: true },
  // A moved window (morning → afternoon) still charges the day: its old row is kept.
  { driver_id: OTHER, date: "2026-11-26" },
];
const ids = (r) => r.map((x) => x.id).sort((a, b) => a - b);

assert.deepEqual(ids(withdrawnMisaRows(rows, submissions, opts)), [1, 2, 11]);
assert.deepEqual(ids(withdrawnMisaRows([row(12, OTHER, "2026-11-26")], submissions, opts)), [], "any charge that day keeps the row");

// The twin is known through its full-time owner, so its rows can be taken back too.
const roster = [
  { driver_id: FT, label: "F - D - DC101809 Lâm Sơn Tuấn", active: true },
  { driver_id: PT, label: "P - P - PT101690 Lâm Sơn Tuấn", active: true },
];
assert.deepEqual([...knownLeaveAccounts(new Map([["DC101809", roster[0]]]), roster)].sort(), [FT, PT]);

// 05:00 VN is 22:00 UTC the day before: "today" must still be the VN date.
assert.equal(vnToday(Date.parse("2026-11-19T22:00:00Z")), "2026-11-20");

console.log("leave-withdraw: ok");
