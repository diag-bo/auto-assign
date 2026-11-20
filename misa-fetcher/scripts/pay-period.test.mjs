/**
 * The morning sync stores shifts for the two pay periods payroll can still touch
 * (15th → 14th), and reads leave to the end of next month.
 *
 *   node scripts/pay-period.test.mjs
 */
import assert from "node:assert/strict";
import { payPeriodRange } from "../lib/parse.mjs";

const at = (vn) => payPeriodRange(new Date(Date.parse(vn + "+07:00")));
const pick = (r) => [r.monthStart, r.monthEnd, r.leaveEnd];

assert.deepEqual(pick(at("2026-11-20T05:00:00")), ["2026-10-15", "2026-12-14", "2026-12-31"]);
assert.deepEqual(pick(at("2026-12-05T05:00:00")), ["2026-10-15", "2026-12-14", "2027-01-31"]);
assert.deepEqual(pick(at("2026-12-15T05:00:00")), ["2026-11-15", "2027-01-14", "2027-01-31"]);
assert.deepEqual(pick(at("2027-01-03T05:00:00")), ["2026-11-15", "2027-01-14", "2027-02-28"]);
// 05:00 VN on the 15th is still the 14th in UTC: the period must roll on VN time.
assert.equal(at("2026-12-15T05:00:00").monthStart, "2026-11-15");

const r = at("2026-12-20T05:00:00");
assert.equal(r.fromDate, "2026-11-14T17:00:00.000Z");   // 15/11 00:00 VN
assert.equal(r.toDate, "2027-01-14T16:59:59.999Z");     // 14/01 23:59:59 VN
assert.deepEqual(r.years, [2026, 2027]);                // attendance is read per year

console.log("pay-period: ok");
