/**
 * Overtime review checks (lib/overtime.ts), on the shapes of real requests from
 * the 17/11/2026 pending list.
 *
 *   npx tsx scripts/overtime.test.mts
 */
const { checkOvertime, overlappingRequests, otKind } = await import("../src/lib/overtime");
type Req = Parameters<typeof checkOvertime>[0];
type Ev = Parameters<typeof checkOvertime>[1];

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const TODAY = "2026-11-17";
const req = (o: Partial<Req>): Req => ({
  id: 1, code: "DC1", name: "A", date: "2026-10-19", from: "17:00", to: "19:40", hours: 2.667,
  kind: "after", kindLabel: "Sau ca", shiftCode: "08001700", shiftName: null, taps: ["07:24", "19:40"],
  reason: "", appliedAt: "", approver: "", lateFiled: false, multiDay: false, ...o,
});
const ev = (o: Partial<Ev>): Ev => ({ ftFound: true, dayArchived: true, legs: [], twins: [], sunday: null, leave: [], ...o });
const texts = (v: ReturnType<typeof checkOvertime>) => v.checks.map((c) => `${c.level}:${c.text}`).join(" | ");

// After-shift, trips run to 19:38 and clock-out 19:40 — matches.
let v = checkOvertime(req({}), ev({ legs: [{ dep: "16:31", arr: "17:20" }, { dep: "19:00", arr: "19:38" }] }), TODAY);
check("after-shift ending with the work is ok", v.status === "ok", texts(v));
check("mid-trip at the start is not a short start", v.coveredMins === 158, String(v.coveredMins));

// 16/10: claimed to 21:00, last trip 20:37, no clock-out after 19:00.
v = checkOvertime(req({ from: "19:00", to: "21:00", shiftCode: "06001900", taps: ["05:53"] }),
  ev({ legs: [{ dep: "18:12", arr: "19:30" }, { dep: "20:00", arr: "20:37" }] }), TODAY);
check("claim past the last trip warns", v.checks.some((c) => c.level === "warn" && c.text.includes("20:37")), texts(v));
check("no clock-out after the start warns", v.checks.some((c) => c.text.includes("không chấm ra")), texts(v));

// Few minutes of rounding past the clock-out stay ok (17:15 claimed, 17:12 tapped).
v = checkOvertime(req({ from: "16:30", to: "17:15", shiftCode: "07301630", taps: ["07:29", "17:12"] }),
  ev({ legs: [{ dep: "16:14", arr: "17:10" }] }), TODAY);
check("3-minute rounding is ok", v.status === "ok", texts(v));

// Sunday day off: on Lịch CN 08–15, clocked 07:49–15:00, last trip 12:24.
v = checkOvertime(req({ date: "2026-10-18", from: "08:00", to: "15:00", kind: "dayoff", kindLabel: "Ngày nghỉ", shiftCode: null, taps: ["07:49", "15:00"] }),
  ev({ legs: [{ dep: "08:34", arr: "10:00" }, { dep: "11:00", arr: "12:24" }], sunday: ["08:00 - 15:00"] }), TODAY);
check("rostered Sunday with idle hours is flagged, not failed", v.status === "warn", texts(v));
check("roster line is reported ok", v.checks.some((c) => c.level === "ok" && c.text.includes("Lịch Chủ nhật")), texts(v));
check("start 34 min late is flagged on a day off", v.checks.some((c) => c.text.includes("chuyến đầu 08:34")), texts(v));
v = checkOvertime(req({ date: "2026-10-18", from: "08:00", to: "15:00", kind: "dayoff", shiftCode: null }),
  ev({ legs: [{ dep: "08:00", arr: "15:00" }], sunday: [] }), TODAY);
check("Sunday not on the roster warns", v.checks.some((c) => c.text.includes("Không có tên")), texts(v));

// The part-time twin drove in the overtime hours: the time was not FT work.
v = checkOvertime(req({}), ev({ legs: [{ dep: "16:00", arr: "17:05" }], twins: [{ code: "PT9", legs: [{ dep: "17:20", arr: "19:30" }] }] }), TODAY);
check("PT twin trip in the window fails", v.status === "bad" && v.checks.some((c) => c.text.includes("PT9")), texts(v));
v = checkOvertime(req({}), ev({ legs: [{ dep: "19:00", arr: "19:38" }], twins: [{ code: "PT9", legs: [{ dep: "06:00", arr: "07:00" }] }] }), TODAY);
check("PT twin outside the window is fine", v.status === "ok", texts(v));

check("no trips at all fails", checkOvertime(req({}), ev({}), TODAY).status === "bad");
check("no FT account fails", checkOvertime(req({}), ev({ ftFound: false }), TODAY).status === "bad");
check("future day is unchecked", checkOvertime(req({ date: "2026-11-22" }), ev({}), TODAY).status === "unchecked");
check("today is unchecked", checkOvertime(req({ date: TODAY }), ev({}), TODAY).status === "unchecked");
check("day not archived is unchecked", checkOvertime(req({}), ev({ dayArchived: false }), TODAY).status === "unchecked");
check("whole-day leave fails", checkOvertime(req({}), ev({ legs: [{ dep: "19:00", arr: "19:38" }], leave: [{ label: "Nghỉ nguyên buổi", wholeDay: true }] }), TODAY).status === "bad");
check("starting before the shift ends warns",
  checkOvertime(req({ from: "16:00" }), ev({ legs: [{ dep: "19:00", arr: "19:38" }] }), TODAY).checks.some((c) => c.text.includes("trước giờ hết ca")));

const clash = overlappingRequests([req({ id: 1 }), req({ id: 2, from: "19:00", to: "20:00" }), req({ id: 3, from: "19:40", to: "20:30", code: "DC2" })]);
check("same person, meeting hours, same day = overlap", clash.has(1) && clash.has(2) && !clash.has(3), JSON.stringify([...clash.keys()]));
check("touching end-to-start is not an overlap", !overlappingRequests([req({ id: 1 }), req({ id: 2, from: "19:40", to: "20:00" })]).size);

check("kinds", otKind("Sau ca") === "after" && otKind("Ngày nghỉ") === "dayoff" && otKind("Trước ca") === "before" && otKind("") === "other");

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall passed");
