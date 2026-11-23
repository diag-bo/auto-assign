// npx tsx scripts/pharmacy-doctors.test.mts
import assert from "node:assert/strict";
import { groupByDoctor } from "../src/lib/pharmacy-doctors";
import { parseCommand } from "../src/lib/kiot-bot";

const r = groupByDoctor(
  [
    { code: "HD1", orderCode: "DH1", total: 1000 },
    { code: "HD2", orderCode: "DH2", total: 300 }, // two doctors on one visit → split
    { code: "HD3", orderCode: "", total: 50 }, // counter sale, no order
    { code: "HD4", orderCode: "DH4", total: 20 }, // order with no prescription
  ],
  new Map([
    ["DH1", ["BS. An"]],
    ["DH2", ["BS. An", "BS. Vui"]],
    ["DH4", []],
  ])
);
assert.deepEqual(r.doctors, [
  { name: "BS. An", revenue: 1150, invoices: 2 },
  { name: "BS. Vui", revenue: 150, invoices: 1 },
]);
assert.deepEqual(r.unlinked, { revenue: 70, invoices: 2 });
assert.equal(r.total, 1370);

for (const t of ["bacsi", "Bác sĩ", "/bacsi", "@Kiot Bot bacsi"]) assert.equal(parseCommand(t).kind, "doctors", t);
for (const t of ["hỏi bác sĩ đi", "bacsi An"]) assert.equal(parseCommand(t).kind, "ignore", t);
console.log("ok");
