/**
 * A smart driver on leave with nobody covering is dropped from the pool BEFORE
 * the open-task cap. Left in, they carry no jobs, so they alone kept the pool
 * "not all full" and the cap threw out every working driver (job 34530421).
 *
 *   npx tsx scripts/smart-pool-leave.test.mts
 */
import { buildSmartPool } from "../src/lib/assign";
import { MAX_OPEN_TASKS } from "../src/lib/smart-rank";
import { vnDate } from "../src/lib/time";
import type { Driver } from "../src/lib/types";
import type { LeaveEntry } from "../src/lib/leave-config";

let failures = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}   ${label}`);
  if (!cond) failures++;
};

const drv = (id: string) => ({ delivery_driver_id: id, first_name: "F", last_name: id, latitude: 10.77, longitude: 106.67 }) as unknown as Driver;
const drivers = ["busy1", "busy2", "off"].map(drv);
const coords = new Map(drivers.map((d) => [d.delivery_driver_id, { lat: 10.77, lon: 106.67 }]));
const load = new Map([["busy1", MAX_OPEN_TASKS], ["busy2", MAX_OPEN_TASKS], ["off", 0]]);
const leave: LeaveEntry[] = [{
  driver_id: "off", driver_name: "F - C - X Off", loai_nghi: "Nghỉ nguyên buổi",
  leave_from: vnDate(), leave_to: vnDate(), gio_bat_dau: null, gio_ket_thuc: null, subs: [],
}];

const p = buildSmartPool(["busy1", "busy2", "off"], drivers, coords, leave, load);
const ids = p.candidates.map((d) => d.delivery_driver_id).sort();
ok("on-leave driver with no cover is not a candidate", !ids.includes("off"));
ok("both full drivers stay (all full → best still wins)", ids.join() === "busy1,busy2");
ok("absent driver is reported", p.onLeaveNoSub.length === 1);

const all = buildSmartPool(["off"], drivers, coords, leave, load);
ok("only the absent driver → empty pool", all.candidates.length === 0 && all.onLeaveNoSub.length === 1);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall ok");
