/**
 * Overtime requests waiting for approval in MISA, each with the evidence the
 * dashboard holds for its hours (lib/overtime.ts). READ ONLY: approving still
 * happens in MISA.
 *
 * The list comes from `misa_overtime_snapshot`, which the morning MISA sync
 * writes while its session is open — so opening the tab costs no browser login.
 * `?live=1` ("Tải lại") logs into MISA here (~20–40 s) and replaces the copy;
 * with no copy yet, the first read goes live too. Checks always run on read, so
 * the evidence is current even when the list is from the morning. Like
 * /api/pay/team this carries no auth of its own — it follows the dashboard's
 * posture.
 */
import { NextRequest, NextResponse } from "next/server";
import { readMisaOvertime } from "@/lib/misa-native";
import { sbSelect, sbSelectAll, supabaseConfigured } from "@/lib/supabase-rest";
import { staffCode } from "@/lib/display-names";
import { coverageOnDate, loadLeaveEntries } from "@/lib/leave-config";
import { checkOvertime, otKind, overlappingRequests, type OtEvidence, type OtRequest } from "@/lib/overtime";
import { vnDate, vnMinutesSinceMidnight } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = "sin1";

type MisaRow = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** "2026-10-18T08:00:00.000+07:00" → ["2026-10-18", "08:00"]. MISA stamps VN time. */
const splitTs = (v: unknown): [string, string] => { const s = str(v); return [s.slice(0, 10), s.slice(11, 16)]; };

function toRequest(r: MisaRow): OtRequest {
  const [date, from] = splitTs(r.FromDate);
  const [, to] = splitTs(r.ToDate);
  const [ad, at] = splitTs(r.ApplyDate);
  const kindLabel = str(r.OverTimeInWorkingShiftName);
  return {
    id: Number(r.OverTimeID), code: str(r.EmployeeCode), name: str(r.FullName), date, from, to,
    hours: Number(r.TotalTime) || 0, kind: otKind(kindLabel), kindLabel,
    shiftCode: str(r.WorkingShiftCode) || null, shiftName: str(r.WorkingShiftName) || null,
    taps: str(r.TimeAttendanceData).split(";").map((s) => s.trim()).filter(Boolean),
    reason: str(r.Reason || r.Description), appliedAt: `${ad} ${at}`, approver: str(r.ApprovalName),
    lateFiled: r.IsViolateDeadline === true, multiDay: r.IsMultipleDate === true,
  };
}

const vnHhmm = (ts: string) => {
  const m = vnMinutesSinceMidnight(new Date(ts));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const inList = (xs: string[]) => `in.(${[...new Set(xs)].map(encodeURIComponent).join(",")})`;
const nameKey = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  let rows: MisaRow[] | null = null;
  let fetchedAt = new Date().toISOString();
  if (req.nextUrl.searchParams.get("live") !== "1") {
    const [snap] = await sbSelect<{ rows: MisaRow[]; fetched_at: string }>("misa_overtime_snapshot", "select=rows,fetched_at&id=eq.pending");
    if (snap) { rows = snap.rows; fetchedAt = snap.fetched_at; }
  }
  if (!rows) {
    try {
      rows = await readMisaOvertime(); // also replaces the saved copy
    } catch (e) {
      return NextResponse.json({ error: `Không đọc được MISA: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
  }
  const reqs = rows.map(toRequest).filter((r) => r.code && r.date);
  const today = vnDate();
  if (!reqs.length) return NextResponse.json({ fetched_at: fetchedAt, requests: [] });

  // Accounts: the DC account by staff code, and the same person's PT accounts by name.
  const drivers = await sbSelectAll<{ driver_id: string; first_name: string | null; last_name: string | null }>(
    "master_drivers", "select=driver_id,first_name,last_name", "driver_id.asc");
  const byCode = new Map<string, { id: string; name: string }>();
  for (const d of drivers) {
    const code = staffCode(d.first_name) || staffCode(d.last_name);
    if (code) byCode.set(code, { id: d.driver_id, name: d.last_name ?? "" });
  }
  const twinsOf = (code: string) => {
    const ft = byCode.get(code);
    if (!ft?.name) return [];
    return [...byCode.entries()]
      .filter(([c, d]) => c.startsWith("PT") && d.id !== ft.id && nameKey(d.name) === nameKey(ft.name))
      .map(([c, d]) => ({ code: c, id: d.id }));
  };

  const dates = [...new Set(reqs.map((r) => r.date).filter((d) => d < today))];
  const ids = reqs.flatMap((r) => [byCode.get(r.code)?.id, ...twinsOf(r.code).map((t) => t.id)]).filter((x): x is string => !!x);

  const [legs, sunday, archived, leave] = await Promise.all([
    dates.length && ids.length
      ? sbSelectAll<{ id: number; driver_id: string; trip_date: string; departed_ts: string | null; arrived_ts: string | null }>(
          "tat_legs", `select=id,driver_id,trip_date,departed_ts,arrived_ts&driver_id=${inList(ids)}&trip_date=${inList(dates)}`, "id.asc")
      : [],
    dates.length && ids.length
      ? sbSelect<{ driver_id: string; work_date: string; shift: string | null }>(
          "master_sunday_roster", `select=driver_id,work_date,shift&driver_id=${inList(ids)}&work_date=${inList(dates)}`)
      : [],
    // Is the day in the trip archive at all? It is filled after midnight, a day per ping.
    Promise.all(dates.map(async (d) => [d, (await sbSelect("tat_legs", `select=id&trip_date=eq.${d}&limit=1`)).length > 0] as const)),
    loadLeaveEntries().catch(() => null),
  ]);
  const isArchived = new Map(archived);
  const legsFor = (id: string | undefined, date: string) =>
    legs.filter((l) => l.driver_id === id && l.trip_date === date && l.departed_ts && l.arrived_ts)
      .map((l) => ({ dep: vnHhmm(l.departed_ts!), arr: vnHhmm(l.arrived_ts!) }));

  const clashes = overlappingRequests(reqs);
  const requests = reqs.map((r) => {
    const ft = byCode.get(r.code);
    const isSunday = new Date(`${r.date}T12:00:00+07:00`).getUTCDay() === 0;
    const ev: OtEvidence = {
      ftFound: !!ft,
      dayArchived: !!isArchived.get(r.date),
      legs: legsFor(ft?.id, r.date),
      twins: twinsOf(r.code).map((t) => ({ code: t.code, legs: legsFor(t.id, r.date) })),
      sunday: isSunday ? sunday.filter((s) => s.driver_id === ft?.id && s.work_date === r.date).map((s) => s.shift ?? "") : null,
      leave: (leave ?? []).filter((e) => e.driver_id === ft?.id)
        .map((e) => ({ e, c: coverageOnDate(e, r.date) })).filter(({ c }) => c.covers)
        .map(({ e, c }) => ({ label: c.timeLabel ? `${e.loai_nghi} ${c.timeLabel}` : e.loai_nghi, wholeDay: !c.timeLabel })),
    };
    const verdict = checkOvertime(r, ev, today);
    const clash = clashes.get(r.id);
    if (clash && verdict.status !== "unchecked") {
      verdict.checks.push({ level: "bad", text: `Trùng giờ với đơn khác cùng ngày (${clash.map((c) => `${c.from}–${c.to}`).join(", ")})` });
      verdict.status = "bad";
    }
    if (leave === null && verdict.status !== "unchecked") {
      verdict.checks.push({ level: "warn", text: "Không đọc được danh sách nghỉ phép — chưa kiểm ngày nghỉ" });
      if (verdict.status === "ok") verdict.status = "warn";
    }
    return { ...r, verdict };
  });
  return NextResponse.json({ fetched_at: fetchedAt, requests });
}
