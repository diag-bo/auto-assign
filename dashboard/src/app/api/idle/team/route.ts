/**
 * "Thời gian chết" — every driver's idle-by-choice time for a month, as a share
 * of their working time (lib/idle.ts has the rules). `?driver=<uuid>` adds that
 * driver's days with each idle event, for the drill-down.
 *
 * Computed on read from tat_legs + driver_shifts; nothing derived is stored.
 * Same no-auth posture as /api/tat/team (the dashboard has none).
 */
import { NextRequest, NextResponse } from "next/server";
import { sbSelectAll, supabaseConfigured } from "@/lib/supabase-rest";
import { masterDriverNames } from "@/lib/master-store";
import { idleDay, type IdleLeg, type IdleDay } from "@/lib/idle";
import { mergeWindows, type ShiftWindow } from "@/lib/pay";
import { vnDate } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "sin1";

const UUID = /^[0-9a-f-]{36}$/i;
const LEG_COLS = "driver_id,driver_name,trip_date,seq,from_name,to_name,departed_ts,arrived_ts,tat_mins,benchmark_mins,unscored," +
  "from_arrived_ts,from_ready_at,from_due_at,from_opens_at,to_ready_at,to_due_at,start_ts,start_bench_mins";

function monthRange(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from: `${month}-01`, to: d.toISOString().slice(0, 10) };
}

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ ok: false, error: "Chưa cấu hình hệ thống lưu trữ." }, { status: 503 });
  const month = req.nextUrl.searchParams.get("month") ?? vnDate().slice(0, 7);
  const only = req.nextUrl.searchParams.get("driver");
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ ok: false, error: "month phải có dạng YYYY-MM" }, { status: 400 });
  if (only && !UUID.test(only)) return NextResponse.json({ ok: false, error: "driver không hợp lệ" }, { status: 400 });
  const { from, to } = monthRange(month);
  const who = only ? `&driver_id=eq.${only}` : "";

  try {
    const [legs, shiftRows] = await Promise.all([
      sbSelectAll<IdleLeg & { driver_id: string; driver_name: string | null; trip_date: string }>(
        "tat_legs", `select=${LEG_COLS}&trip_date=gte.${from}&trip_date=lte.${to}${who}`, "id.asc"),
      sbSelectAll<{ driver_id: string; shift_date: string; start_time: string; end_time: string; source: string }>(
        "driver_shifts",
        `select=driver_id,shift_date,start_time,end_time,source&day_type=eq.working&start_time=not.is.null&end_time=not.is.null` +
          `&driver_id=not.is.null&shift_date=gte.${from}&shift_date=lte.${to}${who}`,
        "employee_code.asc,shift_date.asc,slot.asc"),
    ]);

    // A day's shift: payroll's or hand-entered rows when there are any (they are
    // that day's truth for a part-timer), else what MISA rosters.
    const byDay = new Map<string, typeof shiftRows>();
    for (const r of shiftRows) {
      const k = `${r.driver_id}|${r.shift_date}`;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r);
    }
    const shiftsOf = (k: string): ShiftWindow[] => {
      const rows = byDay.get(k) ?? [];
      const firm = rows.filter((r) => r.source === "payroll" || r.source === "manual");
      return mergeWindows((firm.length ? firm : rows).map((r) => ({ start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) })));
    };

    const days = new Map<string, typeof legs>();
    for (const l of legs) {
      const k = `${l.driver_id}|${l.trip_date}`;
      (days.get(k) ?? days.set(k, []).get(k)!).push(l);
    }

    const perDriver = new Map<string, {
      name: string | null; days: number; idle: number; work: number; noShift: number;
      ride: number; stay: number; first: number; detail: ({ date: string; shifts: ShiftWindow[] } & IdleDay)[];
    }>();
    for (const [k, ls] of days) {
      const [id, date] = k.split("|");
      const shifts = shiftsOf(k);
      const r = idleDay(ls, shifts, date);
      const d = perDriver.get(id) ?? { name: ls[0].driver_name, days: 0, idle: 0, work: 0, noShift: 0, ride: 0, stay: 0, first: 0, detail: [] };
      d.days++;
      // The share only counts days with a shift on both sides, so a day with no
      // shift cannot add idle minutes against zero working time.
      if (r.work_mins == null) d.noShift++;
      else {
        d.idle += r.idle_mins; d.work += r.work_mins;
        for (const e of r.events) d[e.kind] += e.mins - e.excused;
      }
      if (only) d.detail.push({ date, shifts, ...r });
      perDriver.set(id, d);
    }

    const names = await masterDriverNames([...perDriver.keys()]);
    const drivers = [...perDriver].map(([driver_id, d]) => ({
      driver_id,
      driver_name: names.get(driver_id) || d.name || driver_id.slice(0, 8),
      days: d.days, no_shift_days: d.noShift,
      idle_mins: d.idle, work_mins: d.work,
      idle_pct: d.work > 0 ? Math.round((d.idle / d.work) * 1000) / 10 : null,
      ride_mins: d.ride, stay_mins: d.stay, first_mins: d.first,
      ...(only ? { detail: d.detail.sort((a, b) => a.date.localeCompare(b.date)) } : {}),
    })).sort((a, b) => (b.idle_pct ?? -1) - (a.idle_pct ?? -1));

    const idle = drivers.reduce((s, d) => s + d.idle_mins, 0), work = drivers.reduce((s, d) => s + d.work_mins, 0);
    return NextResponse.json({
      ok: true, month, from, to,
      // Legs archived before 2026-11-28 carry none of the stop facts, so their
      // stays, scheduled stops and first stops cannot be judged.
      facts_from: legs.filter((l) => l.to_ready_at).map((l) => l.trip_date).sort()[0] ?? null,
      totals: { idle_mins: idle, work_mins: work, idle_pct: work > 0 ? Math.round((idle / work) * 1000) / 10 : null },
      drivers,
    });
  } catch (e) {
    console.error("[idle/team] error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Không tải được báo cáo." }, { status: 502 });
  }
}
