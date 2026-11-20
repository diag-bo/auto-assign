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
check("month keeps opening + its own changes", g.monthChanges("2026-10", changes).map((c) => c.price).join() === "27080,27180,28250,27020,26670,24860,25730");

// 10% rule: base 20,150 → 22,165 is exactly 10%
check("exactly 10% is paid", g.verdict(22165).paid);
check("just under 10% is not paid, allowance 0", !g.verdict(22164).paid && g.verdict(22164).perKm === 0);
const rows = g.allowanceRows([
  { driver_id: "a", name: "F - P - DC1 A", km: 500 }, { driver_id: "b", name: "P - P - PT1 B", km: 1000 },
  { driver_id: "c", name: "Học việc 1", km: 50 }, { driver_id: "d", name: "DC100XXX Proxy", km: 900 },
  { driver_id: "e", name: "F - P - DC100043 Lê Huỳnh Hồng Huệ", km: 750 },
], g.verdict(22164));
check("only FT/PT accounts listed, FT first, Huệ left out", rows.map((r) => r.driver_id).join() === "a,b", JSON.stringify(rows));
check("unpaid month lists km but pays 0", rows.every((r) => r.allowance_vnd === 0 && r.km > 0));
const paidRows = g.allowanceRows([{ driver_id: "a", name: "F - P - DC1 A", km: 3145.3 }], v);
check("row = km/50 × (avg − base)", paidRows[0].allowance_vnd === Math.round((3145.3 / 50) * (avg - 20150)));

// giaxanghomnay.com/lich-su-gia-xang (shape copied from the live page, 2026-11-20)
const block = (date: string, rows: [string, string][]) => `<div class="bg-[#073871] text-white px-3 py-1.5">
                Điều chỉnh ngày ${date}
            </div><table><tbody>${rows.map(([n, p]) => `<tr class="even:bg-gray-50">
                        <td class="border-b border-gray-100 p-2">${n}</td>
                        <td class="border-b border-gray-100 p-2 text-right font-bold">${p}</td><td>-1 ▼</td></tr>`).join("")}</tbody></table>`;
const page = [
  block("22/10/2026", [["Dầu hỏa 2-K", "30,050"], ["Xăng E10 RON 95 Mức 5", "25,710"], ["Xăng E10 RON 95 Mức 3", "24,910"]]),
  block("15/10/2026", [["Xăng E10 RON 95 Mức 3", "26,720"]]),
  block("24/09/2026", [["Dầu hỏa 2-K", "30,020"]]),
].join("\n");
const imported = g.parseGiaxanghomnay(page);
check("reads Mức 3 (not Mức 5) at 15:00, skips a day with no petrol", JSON.stringify(imported) === JSON.stringify([
  { at: "2026-10-22T15:00", price: 24910 }, { at: "2026-10-15T15:00", price: 26720 }]), JSON.stringify(imported));
const held = [{ at: "2026-10-16T00:00", price: 26670 }];
check("a change within a day of a held one is not imported", g.importable(held, imported).map((c) => c.at).join() === "2026-10-22T15:00");

// Petrolimex release list (link shapes copied from the live list, 2026-11-20)
const list = ["15-gio-00-phut-ngay-22-10-2026", "00-gio-00-phut-ngay-01-11-2026", "22-gio-00-phut-ngay-03-11-2026", "15-gio-00-phut-ngay-24-9-2026"]
  .map((s) => `<a href="/ndi/thong-cao-bao-chi/petrolimex-dieu-chinh-gia-xang-dau-tu-${s}.html">x</a>`).join("") +
  `<a href="/ndi/thong-cao-bao-chi/petrolimex-chu-dong-giam-gia-xang-dau-300-dong-litkg.html">y</a>`;
const releases = g.parsePetrolimexReleases(list);
check("release times read from the links", releases.map((r) => r.at).join() === "2026-10-22T15:00,2026-11-01T00:00,2026-11-03T22:00,2026-09-24T15:00", JSON.stringify(releases));
const figures = [{ at: "2026-10-22T15:00", price: 24910 }, { at: "2026-11-01T15:00", price: 24150 }, { at: "2026-11-03T15:00", price: 23230 }, { at: "2026-10-15T15:00", price: 26720 }];
const { found, missing } = g.petrolimexChanges(releases, figures);
check("figure takes the release's time; a figure with no release stays at 15:00", JSON.stringify(found) === JSON.stringify([
  { at: "2026-10-22T15:00", price: 24910 }, { at: "2026-11-01T00:00", price: 24150 }, { at: "2026-11-03T22:00", price: 23230 }, { at: "2026-10-15T15:00", price: 26720 }]), JSON.stringify(found));
check("a release with no figure is flagged", missing.map((m) => m.at).join() === "2026-09-24T15:00");
const eff = g.effectivePrices([
  { at: "2026-10-22T15:00", price: 24910, source: "petrolimex" }, { at: "2026-10-22T15:00", price: 24900, source: "manual" },
  { at: "2026-10-16T00:00", price: 26670, source: "pvoil" }, { at: "2026-10-15T15:00", price: 26720, source: "petrolimex" },
]);
check("typed price wins, PVOil rows ignored, oldest first", JSON.stringify(eff.map((e) => [e.at.slice(5, 10), e.price])) === '[["10-15",26720],["10-22",24900]]', JSON.stringify(eff));

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log("all passed");
