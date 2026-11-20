/**
 * Phụ cấp xăng (lib/gas-allowance.ts) against the hand-built October 2026 sheet.
 *
 *   npx tsx scripts/gas-allowance.test.mts
 */
const g = await import("../src/lib/gas-allowance");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${cond ? "" : ` — ${detail}`}`);
}

// PVOil E10 RON 95-III changes, 24/09 → 31/10/2026 (read off pvoil.com.vn 2026-11-20)
const changes = [
  { at: "2026-09-24T15:00", price: 27080 }, { at: "2026-10-01T15:00", price: 27180 },
  { at: "2026-10-08T15:00", price: 28250 }, { at: "2026-10-15T15:00", price: 27020 },
  { at: "2026-10-16T00:00", price: 26670 }, { at: "2026-10-22T15:00", price: 24860 },
  { at: "2026-10-29T15:00", price: 25730 }, { at: "2026-11-01T00:00", price: 24150 },
];
const periods = g.pricePeriods("2026-10", changes);
check("7 periods, 744 hours", periods.length === 7 && periods.reduce((t, p) => t + p.hours, 0) === 744, JSON.stringify(periods));
check("opening price carried from 24/09", periods[0].price === 27080 && periods[0].hours === 15);
check("31/10 24:00 change belongs to November", periods.at(-1)!.price === 25730 && periods.at(-1)!.to === "2026-11-01T00:00");
const avg = g.averagePrice(periods)!;
check("October average 26,673.71", Math.abs(avg - 26673.71) < 0.01, String(avg));
const v = g.verdict(avg);
check("October paid at ~130.47 đ/km", v.paid && Math.abs(v.perKm - 130.47) < 0.01, JSON.stringify(v));
check("no opening price → no periods", g.pricePeriods("2026-10", changes.slice(1)).length === 0);

// 10% rule: base 20,150 → 22,165 is exactly 10%
check("exactly 10% is paid", g.verdict(22165).paid);
check("just under 10% is not paid, allowance 0", !g.verdict(22164).paid && g.verdict(22164).perKm === 0);
const rows = g.allowanceRows([
  { driver_id: "a", name: "F - P - DC1 A", km: 500 }, { driver_id: "b", name: "P - P - PT1 B", km: 1000 },
  { driver_id: "c", name: "Học việc 1", km: 50 }, { driver_id: "d", name: "DC100XXX Proxy", km: 900 },
], g.verdict(22164));
check("only FT/PT accounts listed, FT first", rows.map((r) => r.driver_id).join() === "a,b", JSON.stringify(rows));
check("unpaid month lists km but pays 0", rows.every((r) => r.allowance_vnd === 0 && r.km > 0));
const paidRows = g.allowanceRows([{ driver_id: "a", name: "F - P - DC1 A", km: 3145.3 }], v);
check("row = km/50 × (avg − base)", paidRows[0].allowance_vnd === Math.round((3145.3 / 50) * (avg - 20150)));

// PVOil load-view fragment (shape copied from the live page)
const table = `<table class="table mb-4"><thead><tr><td><strong>TT</strong></td><td><strong>Mặt hàng</strong></td>
<td><strong>Giá điều chỉnh lúc 24:00 ngày 15/10/2026</strong></td></tr></thead><tbody>
<tr><td>1</td><td>Xăng E10 RON 95-III</td><td>26.670 đ</td><td>-350</td></tr>
<tr><td>2</td><td>Xăng E5 RON 92-II</td><td>26.620 đ</td><td>-350</td></tr></tbody></table>`;
const parsed = g.parsePvoilTable(table);
check("24:00 on the 15th reads as 16th 00:00", parsed?.at === "2026-10-16T00:00" && parsed.price === 26670, JSON.stringify(parsed));
check("15:00 table", g.parsePvoilTable(table.replace("24:00 ngày 15/10", "15:00 ngày 22/10").replace("26.670", "24.860"))?.at === "2026-10-22T15:00");
check("unrelated table → null", g.parsePvoilTable("<table><tr><td>x</td></tr></table>") === null);
check("picker dates", g.parsePvoilDates(`<select id="ddlpricedate"><option value="2026-11-19">19-11-2026</option>\n<option value="2026-11-12">12</option></select>`).join() === "2026-11-19,2026-11-12");

const blob = [table, table.replace("24:00 ngày 15/10", "15:00 ngày 22/10").replace("26.670", "24.860"), table].join("\n");
const many = g.parsePvoilTables(blob);
check("pasted blob → each change once, oldest first", many.map((c) => `${c.at}=${c.price}`).join() === "2026-10-16T00:00=26670,2026-10-22T15:00=24860", JSON.stringify(many));
check("month keeps opening + its own changes", g.monthChanges("2026-10", changes).map((c) => c.price).join() === "27080,27180,28250,27020,26670,24860,25730");
check("bookmarklet is one javascript: line", g.PVOIL_BOOKMARKLET.startsWith("javascript:") && !g.PVOIL_BOOKMARKLET.includes("\n"));

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log("all passed");
