"use client";

/**
 * Part-time pay for a whole month, every PT driver — the supervisor side of the
 * Thu Nhập tab drivers see in /cham-cong, and the sibling of TatTeamPanel.
 *
 * Defaults to this payroll month: the previous 15th through this 14th.
 *
 * Sorted by what is OWED, largest first — this is a payables list, so the biggest
 * number is the one worth checking before it is paid, not the best performer.
 *
 * HOURS USE LỊCH CA, FED BY PAYROLL'S FILE. The hours are computed on the
 * driver's shift in Lịch ca tài xế; payroll's monthly records file is written
 * into it here ("Nhập ca từ file"). Until it is, the shifts are MISA's plan —
 * which matched payroll on only half the days — and the panel says so.
 *
 * Two things here are TASKS rather than a report, both before the 25th:
 * "Không ca" (days worked with no shift, which pay no hours) and "Cập nhật công"
 * (drivers' requests to correct a day, waiting for a decision).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, Check, CheckCircle2, Clock, Download, ChevronLeft, ChevronRight, ChevronDown, Search, X, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { parsePayrollSheet } from "@/lib/pay-shifts";
import { foldName } from "@/lib/driver-cell";
import { DriverName } from "./driver-name";
import { PayCorrectionsPanel } from "./pay-corrections-panel";
import { PayNoShiftPanel, type NoShiftDay } from "./pay-no-shift-panel";

interface DriverRow {
  driver_id: string;
  driver_name: string;
  days_worked: number;
  jobs: number;
  km: number;
  /** Km actually ridden (every leg, paid or not) — the Hiệu Suất measure. */
  real_km: number;
  worked_mins: number;
  hour_pay: number;
  km_pay: number;
  total_pay: number;
  /** BO Runner hours' pay — left out of đ/km thực, it buys no driving. */
  bo_pay: number;
  /** Days worked with no shift in payroll's file — they pay no hours. */
  no_shift_days: number;
  /** Days begun more than 45 min after the shift start (payroll's red cells). */
  late_days: number;
  /** Days on the "Nghi vấn" list (padded-hours signs). */
  suspect_days: number;
  unpriced_jobs: number;
}

interface PayTeamReport {
  ok: boolean;
  month: string;
  from: string;
  to: string;
  rates: { per_hour: number; per_km: number };
  driver_count: number;
  coverage: { expected_days: number; missing_days: string[]; period_closed: boolean; shifts_imported: boolean; pending_corrections: number; ready: boolean };
  totals: Omit<DriverRow, "driver_id" | "driver_name">;
  no_shift?: NoShiftDay[];
  suspects?: SuspectDay[];
  drivers: DriverRow[];
  error?: string;
}

interface DetailJob {
  job_id: number;
  reference_number: string | null;
  driver_name: string | null;
  trip_date: string;
  pickup_name: string | null;
  dropoff_name: string | null;
  pickup_completed_ts: string | null;
  dropoff_completed_ts: string | null;
  distance_km: number | string | null;
}

const staffCode = (name: string | null) => /\b(PT\w+|DC\w+)/.exec(name ?? "")?.[1] ?? "";
const hhmmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
const hhmm = (iso: string | null) => (iso ? hhmmFmt.format(new Date(iso)) : "");

const vnd = new Intl.NumberFormat("vi-VN");
const fmtVnd = (v: number) => `${vnd.format(Math.round(v))}đ`;

/** ONE scale for the money column, and the exact figure. It used to switch to
 *  "17.2tr" above a million and print grouped đồng below it, with no unit either
 *  way — two conventions in the column an approval is read off, and the exact
 *  number reachable only through a hover tooltip. tabular-nums keeps it aligned. */

const fmtHours = (mins: number) => `${vnd.format(Math.floor(mins / 60))}h${String(mins % 60).padStart(2, "0")}`;

/** Kilometres in Vietnamese notation: 2.199 not 2199. Whole km in the table —
 *  the decimals live in the CSV, which is what a figure gets paid from. */
const fmtKm = (km: number) => vnd.format(Math.round(km));

/** What a kilometre actually costs: EVERYTHING a driver earns — hours and km
 *  together — over every kilometre they rode. Deliberately not comparable to the
 *  2.000đ rate, which prices distance alone; this is the whole wage bill per
 *  kilometre, and it sits well above the rate wherever attendance hours are long
 *  against the distance covered.
 *
 *  Three things move it, and a reader should know which one they are seeing:
 *  unpaid riding (to the next pickup, the run home) pushes it down per km of
 *  paid work, a multi-clinic loop pushes it up (each job pays its own
 *  pickup→lab distance while the loop is ridden once), and the hourly component
 *  pushes it up wherever a driver was on the clock without covering ground.
 *
 *  Null where the day's legs are missing: dividing by an unarchived zero would
 *  print a number nobody could defend. */
const realRate = (totalPay: number, realKm: number): number | null =>
  realKm > 0 ? Math.round(totalPay / realKm) : null;
const fmtRate = (r: number | null) => (r == null ? "—" : vnd.format(r));

const monthLabel = (m: string) => `Tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;

function shiftMonth(m: string, delta: number): string {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

function defaultMonth(): string {
  const vnNow = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })
    .format(new Date()).slice(0, 7);
  return vnNow;
}

/** One day of one driver, as /api/pay/team?driver= returns it. */
interface DayLine {
  date: string; shift: string; tap_in: string | null; tap_out: string | null;
  first_task: string | null; last_task: string | null; paid_from: string | null; paid_to: string | null;
  worked_mins: number; bo_mins: number; multiplier: number; jobs: number; km: number;
  hour_pay: number; km_pay: number; no_shift: boolean; no_shift_rejected?: boolean; corrected: boolean; pending: boolean; late_mins: number; suspect: string[]; admin_done: boolean;
  shift_in: string | null; shift_out: string | null;
  /** One per shift window (split day = several; Anh Tú's BO window is its own). */
  parts?: { shift_in: string | null; shift_out: string | null; kind: string; paid_from: string | null; paid_to: string | null; minutes: number; hour_pay: number }[];
}
const LATE_FLAG = 45;
type PayView = "pay" | "noshift" | "suspect" | "corrections";

interface SuspectDay {
  driver_id: string; driver_name: string; date: string; shift: string; last_task: string | null; reasons: string[];
  /** The supervisor's ruling: ok = paid as computed, cut = paid `paid` instead. */
  review: { verdict: "ok" | "cut"; note: string; paid: string | null } | null;
}

/** One "Nghi vấn" day with its ruling: Giữ giờ (pay as computed) or Cắt giờ (pay
 *  the hours typed — a supervisor correction, approved at once). A ruled day stays
 *  listed, greyed, with Hoàn tác. */
function SuspectRow({ r, onChanged }: { r: SuspectDay; onChanged: () => void }) {
  const times = r.shift.match(/\d{2}:\d{2}/g) ?? [];
  const [cutting, setCutting] = useState(false);
  const [range, setRange] = useState({ in_time: times[0] ?? "", out_time: times.at(-1) ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(action: "suspect_ok" | "suspect_cut" | "suspect_undo") {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/pay/corrections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, driver_id: r.driver_id, date: r.date, ...(action === "suspect_cut" ? range : {}),
          note: action === "suspect_cut" ? `Nghi vấn kéo dài giờ: ${r.reasons.join("; ")}` : "" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error ?? "Không lưu được."); return; }
      setCutting(false);
      onChanged();
    } catch {
      setErr("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }
  const btn = "rounded border px-2 py-0.5 text-xs font-semibold disabled:opacity-50";
  return (
    <tr className={r.review ? "text-slate-500" : ""}>
      <td className="px-3 py-1.5 whitespace-nowrap">{r.date.slice(8, 10)}/{r.date.slice(5, 7)}</td>
      <td className="px-2 py-1.5"><DriverName full={r.driver_name} className={r.review ? "" : "text-slate-800"} /></td>
      <td className="px-2 py-1.5">{r.shift}</td>
      <td className="px-2 py-1.5">{r.last_task ?? "—"}</td>
      <td className={`px-3 py-1.5 ${r.review ? "" : "text-rose-700"}`}>{r.reasons.join(" · ")}</td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        {r.review ? (
          <span className="text-slate-600">
            {r.review.verdict === "ok" ? "Đã duyệt — giữ giờ" : `Đã cắt giờ: trả ${r.review.paid}`}{" "}
            <button disabled={busy} onClick={() => send("suspect_undo")} className="underline underline-offset-2 hover:text-slate-900 disabled:opacity-50">Hoàn tác</button>
          </span>
        ) : cutting ? (
          <span className="inline-flex items-center gap-1">
            <input type="time" aria-label="Giờ vào được trả" className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={range.in_time} onChange={(e) => setRange({ ...range, in_time: e.target.value })} />
            –
            <input type="time" aria-label="Giờ ra được trả" className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={range.out_time} onChange={(e) => setRange({ ...range, out_time: e.target.value })} />
            <button disabled={busy || !range.in_time || !range.out_time} onClick={() => send("suspect_cut")} className={`${btn} border-rose-600 bg-rose-600 text-white hover:bg-rose-700`}>Lưu</button>
            <button disabled={busy} onClick={() => setCutting(false)} className={`${btn} border-slate-300 text-slate-600 hover:bg-slate-50`}>Huỷ</button>
          </span>
        ) : (
          <span className="inline-flex gap-1">
            <button disabled={busy} onClick={() => send("suspect_ok")} title="Đã kiểm tra, giữ giờ như hệ thống tính" className={`${btn} border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>Giữ giờ</button>
            <button disabled={busy} onClick={() => setCutting(true)} title="Nhập giờ vào–ra được trả cho ngày này" className={`${btn} border-rose-300 text-rose-700 hover:bg-rose-50`}>Cắt giờ</button>
          </span>
        )}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </td>
    </tr>
  );
}
const span = (a: string | null, b: string | null) => (a || b ? `${a ?? "?"}–${b ?? "?"}` : "—");

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const shiftWindows = (d: DayLine) => (d.parts ?? []).filter((p) => p.shift_in && p.shift_out);
/** The day's shift as rostered, the BO Runner window marked: a 06:00 paid start
 *  under a 15:00 shift explains itself instead of needing a note on every row. */
const shiftText = (d: DayLine) => {
  const wins = shiftWindows(d);
  return wins.length ? wins.map((p) => `${p.shift_in}–${p.shift_out}${p.kind === "BO Runner" ? " BO" : ""}`).join(" · ") : d.shift;
};

/** Tính giờ with only the ODD end marked: where pay starts or stops away from the
 *  shift edge. Most days match their shift, so a mark is the thing to look at. */
function PaidSpan({ d }: { d: DayLine }) {
  if (!d.paid_from && !d.paid_to) return <>—</>;
  const wins = shiftWindows(d);
  const start = wins[0]?.shift_in ?? d.shift_in, end = wins.at(-1)?.shift_out ?? d.shift_out;
  const edge = (t: string | null, at: string | null, side: "in" | "out") => {
    if (!t) return "?";
    const off = at ? hm(t) - hm(at) : 0;
    if (!off) return t;
    const why = side === "in"
      ? `Bắt đầu tính ${off > 0 ? "sau" : "trước"} giờ vào ca (${at}) ${fmtHours(Math.abs(off))}`
      : off > 0 ? `Tính quá giờ ra ca (${at}) ${fmtHours(off)}` : `Kết thúc trước giờ ra ca (${at}) ${fmtHours(-off)}`;
    return <mark title={why} className="rounded bg-amber-100 px-0.5 font-semibold text-amber-900">{t}</mark>;
  };
  return <>{edge(d.paid_from, start, "in")}–{edge(d.paid_to, end, "out")}</>;
}

/** The days behind one driver's totals, loaded when the row is opened. */
function DriverDays({ month, driverId, total }: { month: string; driverId: string; total: DriverRow }) {
  const [days, setDays] = useState<DayLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/pay/team?month=${month}&driver=${driverId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (!j.ok) { setError(j.error ?? "Không tải được chi tiết."); return; }
        setDays(j.drivers?.find((d: { driver_id: string }) => d.driver_id === driverId)?.days ?? []);
      })
      .catch(() => live && setError("Không kết nối được máy chủ."));
    return () => { live = false; };
  }, [month, driverId]);
  if (error) return <p className="px-4 py-3 text-sm text-red-600">{error}</p>;
  if (!days) return <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Đang tải từng ngày…</p>;
  if (!days.length) return <p className="px-4 py-3 text-sm text-slate-500">Không có ngày làm trong kỳ.</p>;
  return (
    // No overflow wrapper: it would become the scroll container and break the
    // sticky header. Full width (a compact table left half the screen empty),
    // indented and bordered as its own card so the day columns read as their own
    // table, not as cells under the month columns above.
    <div className="py-2 pl-10 pr-3">
      <table className="w-full text-xs bg-white border border-slate-200 shadow-sm">
        {/* Sticky stack while a driver is open: month header (h-9 = 36px) → the
          driver's row (h-10 = 40px) → this header at 76px. */}
        <thead className="sticky top-[76px] z-[5] bg-slate-100 text-left text-xs text-slate-600">
          <tr>
            <th className="px-3 py-1 font-semibold">Ngày</th>
            <th className="px-3 py-1 font-semibold">Ca</th>
            <th className="px-3 py-1 font-semibold">Chấm công</th>
            <th className="px-3 py-1 font-semibold">Chuyến</th>
            <th className="px-2 py-1 font-semibold" title="Khoảng được tính giờ theo quy tắc">Tính giờ</th>
            <th className="px-2 py-1 text-right font-semibold">Giờ</th>
            <th className="px-2 py-1 text-right font-semibold">Chuyến · km</th>
            <th className="px-2 py-1 text-right font-semibold">Tiền (đ)</th>
            <th className="px-2 py-1 font-semibold">Ghi chú</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {days.map((d) => (
            <tr key={d.date} className={d.no_shift ? "bg-amber-50" : d.late_mins > LATE_FLAG || d.suspect.length ? "bg-rose-50" : ""}>
              <td className="px-3 py-1 whitespace-nowrap">{d.date.slice(8, 10)}/{d.date.slice(5, 7)} <span className="text-slate-600">{["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(`${d.date}T00:00:00Z`).getUTCDay()]}</span></td>
              <td className="px-3 py-1 whitespace-nowrap">{shiftText(d) || <span className="text-amber-700">Không ca</span>}</td>
              <td className="px-3 py-1 whitespace-nowrap">{span(d.tap_in, d.tap_out)}</td>
              <td className="px-3 py-1 whitespace-nowrap">{span(d.first_task, d.last_task)}</td>
              <td className="px-3 py-1 whitespace-nowrap text-slate-800"><PaidSpan d={d} /></td>
              <td className="px-3 py-1 text-right">{fmtHours(d.worked_mins)}</td>
              <td className="px-3 py-1 text-right whitespace-nowrap">{d.jobs} · {vnd.format(d.km)}</td>
              <td className="px-3 py-1 text-right font-medium text-slate-800" title={`${fmtVnd(d.hour_pay)} giờ + ${fmtVnd(d.km_pay)} km`}>{vnd.format(Math.round(d.hour_pay + d.km_pay))}</td>
              <td className="px-3 py-1 whitespace-nowrap">
                {([
                  d.corrected && ["Đã duyệt", "text-indigo-700", "Giờ theo cập nhật công đã duyệt"],
                  d.no_shift_rejected && ["Không duyệt", "text-slate-600", "Ngày làm không có ca — quản lý chọn không tính tiền giờ"],
                  d.pending && ["Chờ duyệt", "text-amber-800", "Tài xế đã gửi cập nhật công"],
                  ...d.suspect.map((x) => [x, "text-rose-700", ""]),
                  d.admin_done && ["Admin hoàn thành", "text-slate-600", "Admin hoàn thành điểm giao cuối — giờ hoàn thành không phải của tài xế"],
                  d.late_mins > LATE_FLAG && [`Vào trễ ${fmtHours(d.late_mins)}`, "text-rose-700", "Bắt đầu trễ hơn 45 phút so với giờ vào ca — kiểm tra lại ca"],
                  d.multiplier > 1 && [`Lễ ×${d.multiplier}`, "text-indigo-700", "Ngày lễ: giờ tính gấp ba"],
                ].filter(Boolean) as [string, string, string][]).map(([text, cls, why], i) => (
                  <span key={text}>{i > 0 && <span className="text-slate-500" aria-hidden> · </span>}<span className={cls} title={why || undefined}>{text}</span></span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
        {/* The payroll figures, not a re-sum of the rows: per-day đồng are rounded,
            and a foot that disagreed with the driver row by a few đồng would read
            as an error. Hours add up exactly either way. */}
        <tfoot className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-800 tabular-nums">
          <tr>
            <td className="px-3 py-1.5 whitespace-nowrap">Cộng · {total.days_worked} ngày</td>
            <td colSpan={4} />
            <td className="px-3 py-1.5 text-right">{fmtHours(total.worked_mins)}</td>
            <td className="px-3 py-1.5 text-right whitespace-nowrap">{total.jobs} · {vnd.format(total.km)}</td>
            <td className="px-3 py-1.5 text-right">{vnd.format(Math.round(total.total_pay))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function PayTeamPanel() {
  const [month, setMonth] = useState<string>(defaultMonth);
  const [open, setOpen] = useState<string | null>(null);
  const [pinned, setPinned] = useState(true);
  const [data, setData] = useState<PayTeamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/team?month=${m}`);
      const j = await res.json();
      if (!res.ok || !j.ok) { setError(j.error ?? "Không tải được bảng lương."); setData(null); return; }
      setData(j as PayTeamReport);
    } catch {
      setError("Không kết nối được máy chủ.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  /** CSV for the payroll conversation. Every figure is EXACT here — the screen
   *  rounds to millions to stay readable, this file is what a number gets paid
   *  from, and the two must not be confused. The per-rate columns travel too, so
   *  a disputed total can be re-derived without opening the dashboard. */
  const [exporting, setExporting] = useState(false);
  /** Free-text driver filter. Accent-insensitive, and it searches the staff code
   *  too ("pt1015", "quynh") because that is what payroll keys on. */
  const [q, setQ] = useState("");
  /** Set from the amber banner: show only the drivers who worked without a shift. */
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  /** Set from the rose banner: only drivers on the "Nghi vấn" list. */
  const [onlyLate, setOnlyLate] = useState(false);
  /** Which list fills the main area. ONE value, not a flag per list: three flags
   *  let "‹ Bảng lương" on one list land on another that was still open. */
  const [view, setView] = useState<PayView>("pay");

  /** Payroll's monthly shift file → /api/pay/shifts. Parsed HERE, in the
   *  browser, so the server never spends CPU on a spreadsheet. */
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  async function importShifts(file: File) {
    setImporting(true);
    setImportNote(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets["Details"] ?? wb.Sheets[wb.SheetNames[0]];
      const parsed = parsePayrollSheet(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }));
      if (parsed.error) { setImportNote(parsed.error); return; }
      const res = await fetch("/api/pay/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, rows: parsed.rows }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setImportNote(j.error ?? "Không nhập được ca."); return; }
      setImportNote(
        `Đã ghi ${j.imported} ca của ${j.drivers} tài xế vào Lịch ca.` +
        (j.too_old ? ` ${j.too_old} ca quá cũ, ngoài kỳ lưu dữ liệu.` : "") +
        (parsed.skipped ? ` Bỏ qua ${parsed.skipped} dòng thiếu ngày/giờ.` : "") +
        (j.unmatched.length ? ` Không khớp tài khoản (chưa tính giờ): ${j.unmatched.join(", ")}.` : ""),
      );
      await load(month);
    } catch {
      setImportNote("Không đọc được file. Có đúng file .xlsx chấm công bán thời gian không?");
    } finally {
      setImporting(false);
    }
  }

  async function exportCsv() {
    if (!data) return;
    setExporting(true);
    try {
      // The job lines are fetched on demand — the table view never needs them.
      const res = await fetch(`/api/pay/team?month=${data.month}&detail=1`);
      const j = await res.json();
      if (!res.ok || !j.ok) { setError(j.error ?? "Không tải được chi tiết chuyến."); return; }
      const jobs = j.jobs as DetailJob[];
      // Day lines for every driver: the shift (ca vào / ca ra) beside the taps and paid hours.
      const dres = await fetch(`/api/pay/team?month=${data.month}&driver=all`);
      const dj = await dres.json();
      if (!dres.ok || !dj.ok) { setError(dj.error ?? "Không tải được chi tiết ngày."); return; }
      // One row per SHIFT WINDOW: a split day is two rows, and a BO Runner's BO
      // hours are a row of their own at the BO rate. Trips, km and km pay sit on
      // the day's first row only, so summing any column gives the right total.
      const dayRows = (dj.drivers as (DriverRow & { days?: DayLine[] })[]).flatMap((d) => (d.days ?? []).flatMap((x) => {
        const parts = x.parts?.length ? x.parts
          : [{ shift_in: x.shift_in, shift_out: x.shift_out, kind: "Lái xe", paid_from: x.paid_from, paid_to: x.paid_to, minutes: x.worked_mins, hour_pay: x.hour_pay }];
        const note = [x.no_shift && "Không ca", x.corrected && "Cập nhật công", x.multiplier > 1 && `Lễ ×${x.multiplier}`,
          x.late_mins > LATE_FLAG && `Vào trễ ${x.late_mins} phút`, ...x.suspect].filter(Boolean).join("; ");
        return parts.map((p, i) => [
          d.driver_name, staffCode(d.driver_name), x.date, p.kind, p.shift_in ?? "", p.shift_out ?? "",
          x.tap_in ?? "", x.tap_out ?? "", x.first_task ?? "", x.last_task ?? "", p.paid_from ?? "", p.paid_to ?? "",
          p.minutes, p.hour_pay, i === 0 ? x.jobs : "", i === 0 ? x.km : "", i === 0 ? x.km_pay : "", note,
        ]);
      }));
      const dayHead = ["Tài xế", "Mã số nhân viên", "Ngày", "Loại giờ", "Ca vào", "Ca ra", "Chấm công vào", "Chấm công ra",
                       "Chuyến đầu", "Chuyến cuối", "Tính giờ từ", "Tính giờ đến", "Phút tính tiền", "Tiền giờ (đ)",
                       "Số chuyến", "Km", "Tiền km (đ)", "Ghi chú"];

      const head = ["Tài xế", "Số ngày", "Số chuyến", "Km tính tiền", "Km thực chạy", "Giờ chấm công (phút)",
                    "Tiền giờ (đ)", "Tiền km (đ)", "Tổng (đ)", "Tổng tiền / km thực (đ)",
                    "Ngày làm không có ca", "Chuyến chưa có km"];
      const rows: (string | number)[][] = data.drivers.map((d) => [
        // FULL name here, staff code and all, unlike the table on screen. This file
        // gets matched against attendance and leave in a spreadsheet, and the code
        // is what those are keyed on — two drivers share a display name today.
        d.driver_name, d.days_worked, d.jobs, d.km, d.real_km, d.worked_mins,
        d.hour_pay, d.km_pay, d.total_pay, realRate(d.total_pay - d.bo_pay, d.real_km) ?? "",
        d.no_shift_days, d.unpriced_jobs,
      ]);
      // An incomplete payroll must not leave this screen looking final.
      if (!data.coverage.ready) {
        rows.unshift([`CHƯA ĐỦ DỮ LIỆU — thiếu ${data.coverage.missing_days.length} ngày, ${data.totals.unpriced_jobs} chuyến chưa có km`]);
      }

      // Every paid job, one line each, so any driver's km can be checked trip by trip.
      const detailHead = ["Mã chuyến", "Mã tham chiếu", "Tài khoản giao nhận", "Mã số nhân viên", "Ngày",
                          "Giờ lấy", "Giờ giao", "Điểm đi", "Điểm đến", "Số km", "Tiền km (đ)"];
      const detail = jobs.map((x) => [
        x.job_id, x.reference_number ?? "", x.driver_name ?? "", staffCode(x.driver_name), x.trip_date,
        hhmm(x.pickup_completed_ts), hhmm(x.dropoff_completed_ts), x.pickup_name ?? "", x.dropoff_name ?? "",
        x.distance_km == null ? "" : Number(x.distance_km),
        x.distance_km == null ? "" : Math.round(Number(x.distance_km) * data.rates.per_km),
      ]);

      const csv = [head, ...rows, [], ["CHI TIẾT NGÀY"], dayHead, ...dayRows, [], ["CHI TIẾT CHUYẾN"], detailHead, ...detail]
        .map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
        .join("\n");
      // BOM so Excel opens Vietnamese diacritics correctly instead of mojibake.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `luong-pt-${data.month}_${data.from}_${data.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setExporting(false);
    }
  }

  const needle = foldName(q.trim());
  const shown = !data ? [] : data.drivers
    .filter((d) => (needle ? foldName(d.driver_name).includes(needle) : true))
    .filter((d) => (onlyFlagged && data.totals.no_shift_days > 0 ? d.no_shift_days > 0 : true))
    .filter((d) => (onlyLate && data.totals.suspect_days > 0 ? d.suspect_days > 0 : true));
  /** Days that still need a decision before payroll runs. Vào trễ is a hint
   *  about the roster, not a decision, so it does not hold payroll up. */
  const openDays = data ? data.totals.no_shift_days + data.totals.suspect_days : 0;

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Toolbar, one row: the month (with the period it really pays — "Tháng 11"
          is 15/10–14/11), the month's figures, then the tools. The figures were
          five 80px tiles of their own, a sixth of a laptop screen. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="size-11 sm:size-9 grid place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
            title="Tháng trước"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[120px] text-center leading-tight">
            <span className="block text-sm font-semibold text-slate-800">{monthLabel(month)}</span>
            {data && (
              <span className="block text-xs text-slate-600 tabular-nums">
                {data.from.split("-").reverse().join("/").slice(0, 5)} – {data.to.split("-").reverse().join("/")}
              </span>
            )}
          </span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= defaultMonth()}
            className="size-11 sm:size-9 grid place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            title="Tháng sau"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {data && data.drivers.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5">
          {[
              ["Tổng chi", fmtVnd(data.totals.total_pay), `${fmtVnd(data.totals.hour_pay)} giờ + ${fmtVnd(data.totals.km_pay)} km`],
              ["Tài xế PT", String(data.driver_count), ""],
              ["Giờ", fmtHours(data.totals.worked_mins), ""],
              ["Km tính tiền", fmtKm(data.totals.km), "Quãng đường lấy mẫu → giao mẫu của các chuyến được tính tiền"],
              // The fleet average, and the point of the two columns below: it is the
              // whole wage bill over every kilometre actually ridden, so it answers
              // "what do we pay per kilometre" rather than "what is the rate".
              ["đ/km thực", fmtRate(realRate(data.totals.total_pay - data.totals.bo_pay, data.totals.real_km)),
               `Tổng chi (giờ + km), trừ ${fmtVnd(data.totals.bo_pay)} giờ BO Runner, ÷ ${fmtKm(data.totals.real_km)} km thực chạy`],
            ].map(([label, value, hint]) => (
              <p key={label} className="whitespace-nowrap" title={hint || undefined}>
                <span className={`tabular-nums ${label === "Tổng chi" ? "text-lg font-bold text-slate-900" : "text-sm font-semibold text-slate-800"}`}>{value}</span>{" "}
                <span className="text-xs text-slate-600">{label}</span>
              </p>
            ))}
          </div>
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
        {/* Driver search. 80+ PT drivers is more than a screen, and the list is
            sorted by money owed, so finding one person means scrolling and
            reading. Typing beats scrolling; the code works as well as the name. */}
        <div className="relative min-w-0 flex-1 sm:flex-none sm:w-48">
          <Search className="size-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tài xế..."
            aria-label="Tìm tài xế"
            className="w-full min-h-11 sm:min-h-9 text-xs border border-slate-300 rounded-lg pl-7 pr-7 py-1.5 text-slate-700 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              aria-label="Xoá tìm kiếm"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={exportCsv}
          disabled={!data || data.drivers.length === 0 || exporting}
          className="flex items-center gap-1.5 min-h-11 sm:min-h-9 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg px-3 hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="size-3.5" />
          CSV
        </button>
        <label
          className={`flex items-center gap-1.5 min-h-11 sm:min-h-9 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg px-3 hover:bg-slate-50 cursor-pointer ${importing ? "opacity-40 pointer-events-none" : ""}`}
          title="File chấm công bán thời gian của phòng lương (…_Parttime Records.xlsx) — ghi ca vào Lịch ca tài xế"
        >
          {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          Nhập ca từ file
          <input
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importShifts(f); }}
          />
        </label>
        </div>
      </div>

      {importNote && (
        <p role="status" className="px-3 py-2 text-xs text-slate-700 bg-slate-50 border-b border-slate-200">{importNote}</p>
      )}

      {/* Status row: where the month stands, then the three lists that hold it
          up — each a button with its open count, or a tick once cleared. It is
          the only way into those lists (no tab row: the status and the tabs said
          the same thing twice), and "‹ Bảng lương" leads back. Red only for what
          blocks the numbers themselves — missing days, trips without km. */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-slate-200 shrink-0">
          {view !== "pay" && (
            <button
              type="button"
              onClick={() => setView("pay")}
              className="flex items-center gap-1 min-h-11 sm:min-h-9 rounded-lg border border-slate-300 pl-2 pr-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ChevronLeft className="size-3.5" aria-hidden /> Bảng lương
            </button>
          )}
          {data.drivers.length > 0 && (() => {
            const missing = data.coverage.missing_days.length > 0 || data.totals.unpriced_jobs > 0;
            if (missing) return (
              <p className="flex items-start gap-1.5 text-xs text-red-800">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Chưa đủ dữ liệu:</strong>{" "}
                  {[
                    data.coverage.missing_days.length > 0 &&
                      `thiếu ${data.coverage.missing_days.length}/${data.coverage.expected_days} ngày (${data.coverage.missing_days.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)).join(", ")})`,
                    data.totals.unpriced_jobs > 0 && `${data.totals.unpriced_jobs} chuyến chưa có km, đang tính 0đ`,
                  ].filter(Boolean).join(" · ")}
                </span>
              </p>
            );
            if (!data.coverage.period_closed) return (
              <p className="flex items-center gap-1.5 text-xs text-slate-600">
                <Clock className="size-3.5 shrink-0" /> Kỳ lương chưa kết thúc
              </p>
            );
            if (data.coverage.ready && openDays === 0) return (
              <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-700" /> Sẵn sàng chạy lương
              </p>
            );
            return <p className="text-xs text-slate-600">Còn việc trước khi chạy lương:</p>;
          })()}
          <nav aria-label="Việc cần xử lý trước khi chạy lương" className="flex flex-wrap items-center gap-1.5">
            {([
              ["noshift", "Không ca", data.totals.no_shift_days, "bg-amber-700"],
              ["suspect", "Nghi vấn", data.totals.suspect_days, "bg-rose-600"],
              ["corrections", "Cập nhật công", data.coverage.pending_corrections, "bg-amber-700"],
            ] as [PayView, string, number, string][]).map(([id, label, count, badge]) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                aria-label={count > 0 ? `${label}: còn ${count}` : `${label}: đã xử lý hết`}
                onClick={() => setView(view === id ? "pay" : id)}
                className={`flex items-center gap-1.5 whitespace-nowrap min-h-11 sm:min-h-9 rounded-lg border px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${
                  view === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
              >
                {label}
                {count > 0
                  ? <span className={`rounded-full ${badge} text-white text-xs leading-none px-1.5 py-0.5 tabular-nums`}>{count}</span>
                  : <Check className={`size-3.5 ${view === id ? "text-white" : "text-emerald-700"}`} aria-hidden />}
              </button>
            ))}
          </nav>
          {/* Driver filters, as toggles that stay in sight while on — a filter
              hidden inside a banner emptied the table with no visible cause. */}
          {view === "pay" && (data.totals.no_shift_days > 0 || data.totals.suspect_days > 0) && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-600">Chỉ hiện tài xế</span>
              {([
                ["có ngày không ca", data.totals.no_shift_days > 0, onlyFlagged, setOnlyFlagged],
                ["có ngày nghi vấn", data.totals.suspect_days > 0, onlyLate, setOnlyLate],
              ] as [string, boolean, boolean, (f: (v: boolean) => boolean) => void][]).filter(([, show]) => show).map(([label, , on, set]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set((v) => !v)}
                  className={`flex items-center gap-1 min-h-11 sm:min-h-9 rounded-lg border px-3 text-xs font-semibold ${
                    on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                >
                  {on && <Check className="size-3.5" aria-hidden />}
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* A list takes the table's place while open, rather than pushing the
          payroll off screen below it. */}
      {view === "suspect" && data ? (
        <div className="flex-1 min-h-0 overflow-auto">
          {(data.suspects ?? []).length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">Không có ngày nào nghi vấn kéo dài giờ trong kỳ này.</p>
          ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Ngày</th>
                <th className="text-left font-semibold px-2 py-2">Tài xế</th>
                <th className="text-left font-semibold px-2 py-2">Ca</th>
                <th className="text-left font-semibold px-2 py-2">Chuyến cuối xong</th>
                <th className="text-left font-semibold px-3 py-2">Lý do</th>
                <th className="text-left font-semibold px-3 py-2">Quyết định</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {(data.suspects ?? []).map((r) => (
                <SuspectRow key={`${r.driver_id}|${r.date}|${r.review?.verdict ?? ""}`} r={r} onChanged={() => load(data.month)} />
              ))}
            </tbody>
          </table>
          )}
        </div>
      ) : view === "noshift" && data ? (
        <div className="flex-1 min-h-0">
          <PayNoShiftPanel key={data.month} days={data.no_shift ?? []} onChanged={() => load(data.month)} />
        </div>
      ) : view === "corrections" && data ? (
        <div className="flex-1 min-h-0">
          <PayCorrectionsPanel
            month={data.month}
            drivers={data.drivers.map((d) => ({ driver_id: d.driver_id, driver_name: d.driver_name }))}
            onChanged={() => load(data.month)}
          />
        </div>
      ) : (
      <div
        className="flex-1 overflow-auto"
        // The open driver's row sticks under the header while its days are on
        // screen. A sticky cell is bound to the whole table, so unpin it here
        // once the days have scrolled past — or it would cover the next drivers.
        onScroll={(e) => {
          const top = e.currentTarget.getBoundingClientRect().top + 76;
          const days = e.currentTarget.querySelector("[data-days]");
          setPinned(!!days && days.getBoundingClientRect().bottom > top);
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 m-3 rounded-lg px-4 py-3">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : !data || data.drivers.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-16">
            Chưa có dữ liệu cho {monthLabel(month)}.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-16">
            {q ? `Không có tài xế nào khớp "${q}".` : onlyFlagged && data.totals.no_shift_days > 0 ? "Không có tài xế nào làm ngoài ca." : "Không có tài xế nào có ngày nghi vấn."}
          </p>
        ) : (
          // Full width, like the tiles and tabs above it. The flag columns sit
          // beside the name, so the row still reads from the left.
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-slate-600 text-xs">
              <tr className="h-9">
                <th className="text-left font-semibold px-3 py-2">Tài xế</th>
                {/* The to-do counts sit beside the name they belong to; the figures
                    follow. A word, not a glyph: screen readers got nothing from "⚠". */}
                <th className="text-center font-semibold px-2 py-2" title="Ngày có làm nhưng không có ca trong Lịch ca — không tính tiền giờ">Không ca</th>
                <th className="text-center font-semibold px-2 py-2" title="Ngày bắt đầu trễ hơn 45 phút so với giờ vào ca — thường là ca trong Lịch ca chưa đúng">Vào trễ</th>
                <th className="text-center font-semibold px-2 py-2 border-r border-slate-200" title="Ngày có dấu hiệu kéo dài giờ: chuyến cuối chậm bất thường, hoàn thành sau khi chấm công ra, hoặc mở geofence">Nghi vấn</th>
                <th className="text-right font-semibold px-2 py-2">Ngày</th>
                <th className="text-right font-semibold px-2 py-2">Giờ</th>
                <th className="text-right font-semibold px-2 py-2" title="Quãng đường lấy mẫu → giao mẫu của các chuyến được tính tiền">Km tính tiền</th>
                <th className="text-right font-semibold px-2 py-2" title="Quãng đường thực tế đã chạy, gồm cả đoạn di chuyển giữa các chuyến và chuyến không tính tiền (theo Hiệu Suất)">Km thực</th>
                <th className="text-right font-semibold px-3 py-2">Tổng (đ)</th>
                <th className="text-right font-semibold px-2 py-2" title="(Tiền giờ + tiền km, không tính giờ BO Runner) ÷ km thực chạy">đ/km thực</th>
              </tr>
            </thead>
                          {shown.map((d, i) => (
                <tbody key={d.driver_id}>
                <tr className={`h-10 border-b border-slate-100 ${open === d.driver_id ? `bg-slate-100 ${pinned ? "[&>td]:sticky [&>td]:top-9 [&>td]:z-10 [&>td]:bg-slate-100" : ""}` : ""}`}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => { setPinned(true); setOpen((o) => (o === d.driver_id ? null : d.driver_id)); }}
                      aria-expanded={open === d.driver_id}
                      aria-label={`Xem từng ngày của ${d.driver_name}`}
                      className="mr-1 inline-flex size-6 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800 align-middle"
                    >
                      <ChevronDown className={`size-4 transition-transform ${open === d.driver_id ? "" : "-rotate-90"}`} />
                    </button>
                    <span className="text-slate-500 text-xs mr-1.5">{i + 1}</span>
                    {/* The staff code and the FT/PT chip both stay: about a dozen
                        drivers hold a part-time and a full-time account under one
                        personal name, and pay is filed against the ACCOUNT. */}
                    <DriverName full={d.driver_name} className="font-medium text-slate-800" />
                    {d.bo_pay > 0 && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700" title="Có giờ BO Runner (35.000đ/giờ) — khung BO ghi ở cột Ca của từng ngày">BO Runner</span>
                    )}
                  </td>
                  <td className="text-center px-2 py-2 tabular-nums">
                    {d.no_shift_days > 0
                      ? <span className="text-amber-700 font-semibold">{d.no_shift_days}</span>
                      : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="text-center px-2 py-2 tabular-nums">
                    {d.late_days > 0
                      ? <span className="text-rose-700 font-semibold">{d.late_days}</span>
                      : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="text-center px-2 py-2 tabular-nums border-r border-slate-200">
                    {d.suspect_days > 0
                      ? <span className="text-rose-700 font-semibold">{d.suspect_days}</span>
                      : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="text-right px-2 py-2 text-slate-600">{d.days_worked}</td>
                  <td className="text-right px-2 py-2 text-slate-600 tabular-nums">{fmtHours(d.worked_mins)}</td>
                  <td className="text-right px-2 py-2 text-slate-600 tabular-nums">{fmtKm(d.km)}</td>
                  <td className="text-right px-2 py-2 text-slate-600 tabular-nums">{fmtKm(d.real_km)}</td>
                  <td
                    className="text-right px-3 py-2 font-semibold text-slate-800 tabular-nums"
                    title={`${fmtVnd(d.hour_pay)} giờ + ${fmtVnd(d.km_pay)} km = ${fmtVnd(d.total_pay)}`}
                  >
                    {vnd.format(Math.round(d.total_pay))}
                  </td>
                  <td
                    className="text-right px-2 py-2 text-slate-600 tabular-nums"
                    title={d.real_km > 0 ? `${fmtVnd(d.total_pay - d.bo_pay)}${d.bo_pay ? ` (không tính ${fmtVnd(d.bo_pay)} giờ BO)` : ""} ÷ ${fmtKm(d.real_km)} km thực` : "Chưa có dữ liệu km thực"}
                  >
                    {fmtRate(realRate(d.total_pay - d.bo_pay, d.real_km))}
                  </td>
                </tr>
                {open === d.driver_id && (
                  <tr data-days><td colSpan={10} className="bg-slate-50 p-0 border-b border-slate-200"><DriverDays month={month} driverId={d.driver_id} total={d} /></td></tr>
                )}
                </tbody>
              ))}
          </table>
        )}
      </div>
      )}

      {/* The rule and the column meanings, stated once where the numbers are —
          folded, because it is reference, not something to read every visit, and
          open-able by keyboard and touch where a title tooltip is not. */}
      {data && view === "pay" && (
        <details className="border-t border-slate-200 shrink-0">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-500">
            Cách tính lương và ý nghĩa các cột
          </summary>
          <dl className="max-h-56 overflow-auto px-3 pb-3 grid gap-x-4 gap-y-1.5 text-xs text-slate-700 sm:grid-cols-[max-content_minmax(0,72ch)]">
            <dt className="font-semibold">Tiền giờ</dt>
            <dd>{vnd.format(data.rates.per_hour)}đ/giờ theo Lịch ca: bắt đầu từ lúc chấm công vào (không có thì chuyến lấy mẫu đầu tiên), không sớm hơn giờ vào ca; kết thúc lúc chấm công ra hoặc chuyến cuối, lấy giờ trễ hơn, không quá hết ca trừ khi còn chuyến. Ngày lễ ×3.</dd>
            <dt className="font-semibold">BO Runner</dt>
            <dd>35.000đ/giờ — Anh Tú 6h–15h thứ 2–7, Mộng Hoa cả ca. Khung BO ghi ở cột Ca của từng ngày.</dd>
            <dt className="font-semibold">Tiền km</dt>
            <dd>{vnd.format(data.rates.per_km)}đ/km lấy mẫu → giao mẫu của mỗi chuyến đã hoàn thành.</dd>
            <dt className="font-semibold">Km tính tiền</dt>
            <dd>Quãng đường lấy mẫu → giao mẫu của các chuyến được tính tiền.</dd>
            <dt className="font-semibold">Km thực</dt>
            <dd>Quãng đường thực tế đã chạy, gồm cả đoạn di chuyển giữa các chuyến, đường về và chuyến không tính tiền (theo Hiệu Suất).</dd>
            <dt className="font-semibold">đ/km thực</dt>
            <dd>(Tiền giờ + tiền km, không tính giờ BO Runner) ÷ km thực. Đây là chi phí thật cho mỗi km, không so trực tiếp được với mức {vnd.format(data.rates.per_km)}đ/km.</dd>
            <dt className="font-semibold">Không ca</dt>
            <dd>Ngày có làm nhưng không có ca trong Lịch ca — không tính tiền giờ cho đến khi được duyệt.</dd>
            <dt className="font-semibold">Vào trễ</dt>
            <dd>Ngày bắt đầu trễ hơn 45 phút so với giờ vào ca — thường là ca trong Lịch ca chưa đúng.</dd>
            <dt className="font-semibold">Nghi vấn</dt>
            <dd>Ngày có dấu hiệu kéo dài giờ: chuyến cuối chậm bất thường, hoàn thành sau khi chấm công ra, hoặc mở geofence.</dd>
            <dt className="font-semibold">Giờ tô vàng</dt>
            <dd>Trong cột Tính giờ của từng ngày: đầu hoặc cuối khác giờ ca. Rê chuột lên để xem lệch bao nhiêu.</dd>
          </dl>
        </details>
      )}
    </div>
  );
}
