/**
 * Overtime review: each MISA "Đăng ký làm thêm" request waiting for approval,
 * checked against what we can see ourselves — the Cartrack trips on the person's
 * FULL-TIME account, their part-time twin's trips in the same hours, MISA's own
 * clock-ins, the shift, Lịch Chủ nhật and leave.
 *
 * It only REPORTS. Nothing here approves or rejects: a Sunday with no jobs for
 * two of its rostered hours is still a rostered Sunday, and whether that is paid
 * is the supervisor's call. `scripts/overtime.test.mts`.
 */
import { timeToMins } from "./time";

/** Minutes a claimed boundary may sit past the evidence before it is flagged —
 *  the hand-over allowance part-time pay already uses. */
export const OT_TOLERANCE_MIN = 15;

export type OtKind = "after" | "before" | "dayoff" | "other";
export type OtLevel = "ok" | "warn" | "bad";

export interface OtRequest {
  id: number;
  code: string;          // DC… staff code
  name: string;
  date: string;          // YYYY-MM-DD, the day the window starts
  from: string;          // HH:MM
  to: string;            // HH:MM (earlier than `from` = past midnight)
  hours: number;         // MISA's TotalTime
  kind: OtKind;
  kindLabel: string;     // MISA's own words: "Sau ca", "Ngày nghỉ", …
  shiftCode: string | null; // "07301630"
  shiftName: string | null;
  taps: string[];        // MISA clock-ins that day, HH:MM
  reason: string;
  appliedAt: string;     // YYYY-MM-DD HH:MM
  approver: string;
  lateFiled: boolean;
  multiDay: boolean;
}

export interface OtEvidence {
  /** The full-time Cartrack account was found for the staff code. */
  ftFound: boolean;
  /** Our trip archive holds this day at all (it is filled after midnight). */
  dayArchived: boolean;
  legs: { dep: string; arr: string }[];                    // FT account, that day
  twins: { code: string; legs: { dep: string; arr: string }[] }[]; // PT accounts of the same person
  /** Lịch Chủ nhật lines for that day ("08:00 - 15:00"), or null when not a Sunday. */
  sunday: string[] | null;
  leave: { label: string; wholeDay: boolean }[];
}

export interface OtCheck { level: OtLevel; text: string }
export interface OtVerdict {
  status: OtLevel | "unchecked";
  checks: OtCheck[];
  /** Part of the claimed window the trips cover, minutes. Null when unchecked. */
  coveredMins: number | null;
  claimedMins: number;
  workFrom: string | null;
  workTo: string | null;
}

const hhmm = (m: number) => {
  const d = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
};

/** Window in minutes; an end at or before the start runs past midnight. */
function window(from: string, to: string): [number, number] {
  const f = timeToMins(from);
  let t = timeToMins(to);
  if (t <= f) t += 1440;
  return [f, t];
}

/** Legs that touch the window. A leg's clock is taken on the request's day;
 *  ponytail: trips after midnight sit on the next trip_date and are not read —
 *  add the next day's legs if past-midnight overtime ever shows up. */
function legsIn(legs: { dep: string; arr: string }[], f: number, t: number) {
  return legs
    .map((l) => ({ dep: timeToMins(l.dep), arr: timeToMins(l.arr) }))
    .filter((l) => l.dep >= 0 && l.arr >= 0 && l.arr > f && l.dep < t);
}

/** "08:00 - 15:00" → [480, 900]. */
function rosterWindow(line: string): [number, number] | null {
  const m = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(line);
  return m ? window(m[1], m[2]) : null;
}

export function checkOvertime(req: OtRequest, ev: OtEvidence, today: string): OtVerdict {
  const [f, t] = window(req.from, req.to);
  const claimedMins = t - f;
  const checks: OtCheck[] = [];
  const add = (level: OtLevel, text: string) => checks.push({ level, text });
  const base = { claimedMins, coveredMins: null, workFrom: null, workTo: null };

  if (req.date >= today) {
    return { ...base, status: "unchecked", checks: [{ level: "warn", text: "Chưa diễn ra hoặc đang diễn ra — kiểm lại sau ngày làm" }] };
  }
  if (!ev.ftFound) {
    return { ...base, status: "bad", checks: [{ level: "bad", text: `Không tìm thấy tài khoản Cartrack ${req.code}` }] };
  }
  if (!ev.dayArchived) {
    return { ...base, status: "unchecked", checks: [{ level: "warn", text: "Chuyến Cartrack của ngày này chưa được lưu — kiểm lại sau" }] };
  }
  if (req.multiDay) add("warn", "Đơn nhiều ngày — chỉ kiểm ngày đầu, xem các ngày còn lại trong MISA");

  // Which account: overtime is full-time work, so a PT trip in these hours means
  // the time was driven (and is paid) on the part-time account.
  for (const tw of ev.twins) {
    const hit = legsIn(tw.legs, f, t);
    if (hit.length) {
      const a = Math.min(...hit.map((l) => l.dep)), b = Math.max(...hit.map((l) => l.arr));
      add("bad", `Chạy bằng tài khoản ${tw.code} trong giờ tăng ca (${hhmm(a)}–${hhmm(b)}, ${hit.length} chặng)`);
    } else {
      add("ok", `Tài khoản ${tw.code} không chạy trong giờ này`);
    }
  }

  // Trips on the full-time account.
  const hit = legsIn(ev.legs, f, t);
  let workFrom: string | null = null, workTo: string | null = null, coveredMins: number | null = 0;
  if (!hit.length) {
    add("bad", `Không có chuyến nào trên Cartrack trong ${req.from}–${req.to}`);
  } else {
    const a = Math.min(...hit.map((l) => l.dep)), b = Math.max(...hit.map((l) => l.arr));
    workFrom = hhmm(a); workTo = hhmm(b);
    coveredMins = Math.max(0, Math.min(t, b) - Math.max(f, a));
    const short: string[] = [];
    // After the shift the driver is usually mid-trip at the start, so only the
    // END is evidence; a day off or before-shift window has to be met at both.
    if (req.kind !== "after" && a - f > OT_TOLERANCE_MIN) short.push(`chuyến đầu ${hhmm(a)} (khai từ ${req.from})`);
    if (t - b > OT_TOLERANCE_MIN) short.push(`chuyến cuối xong ${hhmm(b)} (khai đến ${req.to})`);
    const h = (m: number) => String(Math.round(m / 6) / 10).replace(".", ",");
    if (short.length) add("warn", `Cartrack: ${short.join(", ")} — có việc ${h(coveredMins)}/${h(claimedMins)} giờ`);
    else add("ok", `Cartrack: chạy ${workFrom}–${workTo} (${hit.length} chặng)`);
  }

  // MISA's clock-ins.
  const taps = req.taps.map(timeToMins).filter((m) => m >= 0).sort((x, y) => x - y);
  if (!taps.length) {
    add("warn", "MISA không có giờ chấm công hôm đó");
  } else {
    const first = taps[0], last = taps[taps.length - 1];
    const tapIssues: string[] = [];
    if (req.kind !== "after" && first - f > OT_TOLERANCE_MIN) tapIssues.push(`chấm vào ${hhmm(first)} (khai từ ${req.from})`);
    if (last <= f) tapIssues.push(`không chấm ra sau ${req.from} (lần chấm cuối ${hhmm(last)})`);
    else if (t - last > OT_TOLERANCE_MIN) tapIssues.push(`chấm ra ${hhmm(last)} (khai đến ${req.to})`);
    if (tapIssues.length) add("warn", `Chấm công: ${tapIssues.join(", ")}`);
    else add("ok", `Chấm công: ${hhmm(first)} → ${hhmm(last)}`);
  }

  // The shift the overtime sits against: "07301630" = 07:30–16:30.
  const sc = req.shiftCode && /^\d{8}$/.test(req.shiftCode) ? req.shiftCode : null;
  if (sc) {
    const s = timeToMins(`${sc.slice(0, 2)}:${sc.slice(2, 4)}`), e = timeToMins(`${sc.slice(4, 6)}:${sc.slice(6, 8)}`);
    if (req.kind === "after" && f < e) add("warn", `Bắt đầu ${req.from}, trước giờ hết ca ${hhmm(e)}`);
    if (req.kind === "before" && t > s) add("warn", `Kết thúc ${req.to}, sau giờ vào ca ${hhmm(s)}`);
  }

  // A Sunday is worked off Lịch Chủ nhật.
  if (ev.sunday) {
    const wins = ev.sunday.map(rosterWindow).filter((w): w is [number, number] => !!w);
    if (!ev.sunday.length) add("warn", "Không có tên trong Lịch Chủ nhật hôm đó");
    else if (wins.some(([rs, re]) => f >= rs - OT_TOLERANCE_MIN && t <= re + OT_TOLERANCE_MIN)) add("ok", `Lịch Chủ nhật: ${ev.sunday.join("; ")}`);
    else add("warn", `Lịch Chủ nhật ${ev.sunday.join("; ")}, khai ${req.from}–${req.to}`);
  }

  for (const l of ev.leave) add(l.wholeDay ? "bad" : "warn", `Có đơn ${l.label} hôm đó`);
  if (req.lateFiled) add("warn", "MISA: nộp đơn trễ hạn");

  const status: OtLevel = checks.some((c) => c.level === "bad") ? "bad" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  return { status, checks, coveredMins, claimedMins, workFrom, workTo };
}

/** Two requests of one person whose hours meet on the same day — the second is
 *  the same hours claimed twice. Keyed by request id. */
export function overlappingRequests(reqs: OtRequest[]): Map<number, OtRequest[]> {
  const out = new Map<number, OtRequest[]>();
  for (const a of reqs) {
    const [af, at] = window(a.from, a.to);
    const clash = reqs.filter((b) => {
      if (b.id === a.id || b.code !== a.code || b.date !== a.date) return false;
      const [bf, bt] = window(b.from, b.to);
      return af < bt && bf < at;
    });
    if (clash.length) out.set(a.id, clash);
  }
  return out;
}

/** MISA's "OverTimeInWorkingShiftName" → the kind the checks read. */
export function otKind(label: string | null | undefined): OtKind {
  const s = (label ?? "").toLowerCase();
  if (s.includes("sau ca")) return "after";
  if (s.includes("trước ca")) return "before";
  if (s.includes("ngày nghỉ") || s.includes("nghỉ")) return "dayoff";
  return "other";
}
