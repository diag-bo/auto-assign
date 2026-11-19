/**
 * Tiền gửi xe: what a visit is, and when a line is refused.
 * Run: npx tsx scripts/parking-fee.test.mts
 */
import assert from "node:assert/strict";
import { toPlaces, countVisits, checkLines, shortName, openPayMonths } from "../src/lib/parking-fee";

const places = toPlaces([
  { customer_id: "nd", customer_name: "SENDOUT8 - D5 - VVKiet - BV Nhiệt Đới", address_line_1: "(Cutoff 13h00 thứ 6) 764 Võ Văn Kiệt", parking_fee_vnd: 6000 },
  { customer_id: "tm", customer_name: "NDTP - BChanh - DK3 - BV Truyền Máu Huyết Học", address_line_1: "1 Đ. DK3", parking_fee_vnd: 5000 },
]);
assert.equal(places.find((p) => p.id === "nd")!.address, "764 Võ Văn Kiệt");
assert.equal(shortName("53407684 - D8 - ADLan - Bệnh Viện Phục Hồi Chức Năng - Điều Trị Bệnh Nghề Nghiệp"),
  "Bệnh Viện Phục Hồi Chức Năng - Điều Trị Bệnh Nghề Nghiệp");

// Two arrivals at nd; a second stop there in a row is the same parking.
const visits = countVisits([
  { from_customer_id: "x", to_customer_id: "nd" },
  { from_customer_id: "nd", to_customer_id: "nd" },
  { from_customer_id: null, to_customer_id: "nd" },
]);
assert.equal(visits.get("nd"), 2);

const byId = new Map(places.map((p) => [p.id, p]));
assert.equal(checkLines([{ place_id: "nd", amount_vnd: 6000, times: 2 }], byId, visits).valid, true);
assert.equal(checkLines([{ place_id: "nd", amount_vnd: 4000, times: 1 }], byId, visits).valid, true); // less is fine
const bad = checkLines([
  { place_id: "nd", amount_vnd: 7000, times: 1 },  // dearer than the record
  { place_id: "tm", amount_vnd: 5000, times: 1 },  // never went
], byId, visits);
assert.equal(bad.valid, false);
assert.ok(bad.lines.every((l) => l.problem));

assert.deepEqual(openPayMonths("2026-11-19"), ["2026-12", "2026-11"]);
assert.deepEqual(openPayMonths("2026-11-26"), ["2026-12"]);
console.log("parking-fee: ok");
