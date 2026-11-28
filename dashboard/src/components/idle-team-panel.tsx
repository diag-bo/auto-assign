"use client";

/**
 * "Thời gian chết" — idle time by choice, every driver, one month: the share of
 * working time spent idle when there was work to go to. Rules: lib/idle.ts.
 * Click a driver for the day-by-day list of what was counted.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { DriverName } from "./driver-name";

interface IdleEvent { kind: "first" | "ride" | "stay"; at: string; mins: number; excused: number; place: string | null; due?: string }
interface DayDetail { date: string; shifts: { start: string; end: string }[]; events: IdleEvent[]; idle_mins: number; work_mins: number | null }
interface DriverRow {
  driver_id: string; driver_name: string; days: number; no_shift_days: number;
  idle_mins: number; work_mins: number; idle_pct: number | null;
  ride_mins: number; stay_mins: number; first_mins: number; detail?: DayDetail[];
}
interface Report {
  ok: boolean; month: string; facts_from: string | null; error?: string;
  totals: { idle_mins: number; work_mins: number; idle_pct: number | null };
  drivers: DriverRow[];
}

const KIND: Record<IdleEvent["kind"], string> = { ride: "Chạy chậm", stay: "Ở lâu tại điểm", first: "Trễ điểm đầu" };
const monthLabel = (m: string) => `Tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;
const vnMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()).slice(0, 7);
function shiftMonth(m: string, delta: number) {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
const hm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}` : `${mins}p`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pctTone = (p: number | null) => (p == null ? "text-slate-400" : p <= 5 ? "text-green-600" : p <= 10 ? "text-amber-600" : "text-red-600");

export function IdleTeamPanel() {
  const [month, setMonth] = useState(vnMonth);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail[] | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true); setError(null); setOpen(null);
    try {
      const res = await fetch(`/api/idle/team?month=${m}`);
      const j = await res.json();
      if (!res.ok || !j.ok) { setError(j.error ?? "Không tải được báo cáo."); setData(null); return; }
      setData(j as Report);
    } catch { setError("Không kết nối được máy chủ."); setData(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(month); }, [month, load]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    try {
      const j = await (await fetch(`/api/idle/team?month=${month}&driver=${id}`)).json();
      setDetail(j.ok ? (j.drivers[0]?.detail ?? []) : []);
    } catch { setDetail([]); }
  }

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title="Tháng trước" aria-label="Tháng trước">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold text-slate-800 min-w-[120px] text-center">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= vnMonth()} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40" title="Tháng sau" aria-label="Tháng sau">
            <ChevronRight className="size-4" />
          </button>
        </div>
        {data?.totals.idle_pct != null && (
          <span className="text-xs text-slate-600">
            Cả đội: <b className={pctTone(data.totals.idle_pct)}>{data.totals.idle_pct}%</b> · {hm(data.totals.idle_mins)} / {hm(data.totals.work_mins)}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="size-6 animate-spin" /></div>
        ) : error ? (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 m-3 rounded-lg px-4 py-3">
            <AlertCircle className="size-4 mt-0.5 shrink-0" /><span>{error}</span>
          </div>
        ) : !data || data.drivers.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-16">Chưa có dữ liệu cho {monthLabel(month)}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-600 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Tài xế</th>
                <th className="text-right font-semibold px-2 py-2">% giờ làm</th>
                <th className="text-right font-semibold px-2 py-2">Thời gian chết</th>
                <th className="text-right font-semibold px-2 py-2 hidden sm:table-cell">Chạy chậm</th>
                <th className="text-right font-semibold px-2 py-2 hidden sm:table-cell">Ở lâu</th>
                <th className="text-right font-semibold px-3 py-2 hidden sm:table-cell">Trễ điểm đầu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.drivers.map((d) => (
                <Fragment key={d.driver_id}>
                  <tr onClick={() => toggle(d.driver_id)} className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-2">
                      <DriverName full={d.driver_name} className="font-medium text-slate-800" />
                      <span className="block text-[10px] text-slate-400">
                        {d.days} ngày{d.no_shift_days > 0 ? ` · ${d.no_shift_days} ngày không ca (không tính)` : ""}
                      </span>
                    </td>
                    <td className={`text-right px-2 py-2 font-semibold ${pctTone(d.idle_pct)}`}>{d.idle_pct == null ? "—" : `${d.idle_pct}%`}</td>
                    <td className="text-right px-2 py-2 text-slate-700">{hm(d.idle_mins)}</td>
                    <td className="text-right px-2 py-2 text-slate-600 hidden sm:table-cell">{hm(d.ride_mins)}</td>
                    <td className="text-right px-2 py-2 text-slate-600 hidden sm:table-cell">{hm(d.stay_mins)}</td>
                    <td className="text-right px-3 py-2 text-slate-600 hidden sm:table-cell">{hm(d.first_mins)}</td>
                  </tr>
                  {open === d.driver_id && (
                    <tr><td colSpan={6} className="bg-slate-50 px-3 py-2">
                      {detail == null ? <Loader2 className="size-4 animate-spin text-slate-400" /> : (
                        <div className="space-y-2">
                          {detail.filter((x) => x.events.length > 0).map((x) => (
                            <div key={x.date}>
                              <p className="text-xs font-semibold text-slate-700">
                                {dayLabel(x.date)} · {hm(x.idle_mins)}
                                <span className="font-normal text-slate-400">
                                  {" "}· ca {x.shifts.length ? x.shifts.map((s) => `${s.start}–${s.end}`).join(", ") : "không có"}
                                </span>
                              </p>
                              <ul className="text-xs text-slate-600">
                                {x.events.map((e, i) => (
                                  <li key={i} className="flex gap-2">
                                    <span className="w-11 shrink-0 text-slate-400">{clock(e.at)}</span>
                                    <span className="w-28 shrink-0">{KIND[e.kind]}</span>
                                    <span className="flex-1 truncate">{e.place ?? "—"}{e.due ? ` (hẹn tới ${clock(e.due)})` : ""}</span>
                                    <span className="shrink-0 font-medium">
                                      {hm(e.mins - e.excused)}{e.excused > 0 ? <span className="text-slate-400 font-normal"> (trừ {e.excused}p nghỉ trưa)</span> : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                          {detail.every((x) => x.events.length === 0) && <p className="text-xs text-slate-400">Không có thời gian chết.</p>}
                        </div>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <p className="text-[11px] text-slate-400 px-3 py-2 border-t border-slate-200 shrink-0">
          Tính khi có việc mà tài xế chưa đi: chạy quá mục tiêu chặng hơn 15 phút; điểm có giờ hẹn thì trễ giờ hẹn là tính
          ngay; ở một điểm quá 20 phút khi việc kế tiếp đã sẵn sàng (trừ PSC trung chuyển D004/D007/D009/D015 và điểm
          3PL); trễ điểm đầu tiên so với giờ vào ca + thời gian chạy từ nơi chấm công, hoặc từ PSC trong config nếu không
          chấm công. Trừ một lần nghỉ trưa tới 60 phút
          (11:00–14:00). % = thời gian chết ÷ giờ ca, ca kéo dài nếu về muộn.
          {data.facts_from && data.facts_from > `${month}-01` ? ` Ở lâu, giờ hẹn và điểm đầu chỉ có từ ${dayLabel(data.facts_from)}.` : ""}
        </p>
      )}
    </div>
  );
}
