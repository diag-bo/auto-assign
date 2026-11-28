"use client";

/**
 * "Thời gian chết" — idle time by choice, every driver, one month: the share of
 * working time spent idle when there was work to go to. Rules: lib/idle.ts.
 * Open a driver for the day-by-day list of what was counted, each line carrying
 * the evidence it was judged on (and, for a slow ride, the road on Google Maps).
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, MapPinned } from "lucide-react";
import { DriverName } from "./driver-name";
import { placeName } from "@/lib/display-names";

interface IdleEvent {
  kind: "first" | "ride" | "stay"; at: string; mins: number; excused: number; place: string | null;
  due?: string; from?: string | null; took?: number; expected?: number; arrived?: string; map?: string;
}
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

const KIND: Record<IdleEvent["kind"], string> = { ride: "Chạy chậm", stay: "Ở lâu", first: "Trễ điểm đầu" };
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
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
const pctTone = (p: number | null) => (p == null ? "text-slate-400" : p <= 5 ? "text-green-700" : p <= 10 ? "text-amber-700" : "text-red-700");
const place = (name: string | null | undefined) => placeName(name) || "—";

/** The evidence an event was judged on, in the supervisor's terms. */
function Evidence({ e }: { e: IdleEvent }) {
  if (e.kind === "ride") {
    return (
      <>
        <span className="font-medium text-slate-800">{place(e.from)} <span className="text-slate-400">→</span> {place(e.place)}</span>
        <span className="text-slate-500">
          {e.took != null && e.expected != null && <> · chạy {e.took}p, mục tiêu {e.expected}p, <b className="font-semibold text-slate-700">chậm {e.took - e.expected}p</b></>}
          {e.due && e.arrived && <> · hạn {clock(e.due)}, đến {clock(e.arrived)}</>}
        </span>
        {e.map && (
          <a href={e.map} target="_blank" rel="noopener noreferrer"
            className="ml-1.5 inline-flex items-center gap-0.5 rounded text-blue-700 hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            aria-label={`Xem chặng ${place(e.from)} → ${place(e.place)} trên Google Maps`}>
            <MapPinned className="size-3.5" aria-hidden />Bản đồ
          </a>
        )}
      </>
    );
  }
  if (e.kind === "stay") {
    return (
      <>
        <span className="font-medium text-slate-800">{place(e.place)}</span>
        <span className="text-slate-500"> · ở {e.took}p khi việc kế đã sẵn sàng (tối đa 20p)</span>
      </>
    );
  }
  return (
    <>
      <span className="font-medium text-slate-800">{place(e.place)}</span>
      <span className="text-slate-500">
        {e.arrived && <> · đến {clock(e.arrived)}</>}
        {e.due && <>, hạn {clock(e.due)}</>}
        {e.expected != null && <> (vào ca + {e.expected}p chạy)</>}
      </span>
    </>
  );
}

function DayEvents({ days }: { days: DayDetail[] | null }) {
  if (days == null) {
    return <div className="space-y-2 py-1" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-4 rounded bg-slate-200 motion-safe:animate-pulse" />)}</div>;
  }
  const shown = days.filter((d) => d.events.length > 0);
  if (shown.length === 0) return <p className="text-xs text-slate-500 py-1">Không có thời gian chết trong tháng.</p>;
  return (
    <div className="space-y-3 py-1">
      {shown.map((d) => (
        <section key={d.date} aria-label={`Ngày ${dayLabel(d.date)}`}>
          <h4 className="text-xs font-semibold text-slate-800 tabular-nums">
            {weekday(d.date)} {dayLabel(d.date)} · {hm(d.idle_mins)}
            <span className="font-normal text-slate-500">
              {" "}· ca {d.shifts.length ? d.shifts.map((s) => `${s.start}–${s.end}`).join(", ") : "không có (không tính %)"}
            </span>
          </h4>
          <ul className="mt-1 divide-y divide-slate-200/70">
            {d.events.map((e, i) => (
              <li key={i} className="grid grid-cols-[2.75rem_1fr_auto] sm:grid-cols-[2.75rem_6rem_1fr_auto] gap-x-2 py-1 text-xs leading-5">
                <span className="text-slate-500 tabular-nums">{clock(e.at)}</span>
                <span className="hidden sm:block font-medium text-slate-700">{KIND[e.kind]}</span>
                <span className="min-w-0">
                  <span className="sm:hidden font-medium text-slate-700">{KIND[e.kind]} · </span>
                  <Evidence e={e} />
                </span>
                <span className="text-right tabular-nums">
                  <span className="font-semibold text-slate-900">+{hm(e.mins - e.excused)}</span>
                  {e.excused > 0 && <span className="block text-[11px] text-slate-500">trừ {e.excused}p nghỉ trưa</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

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

  const num = "text-right px-2 py-2 tabular-nums";
  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="Tháng trước">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold text-slate-800 min-w-[120px] text-center">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= vnMonth()} className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="Tháng sau">
            <ChevronRight className="size-4" />
          </button>
        </div>
        {data?.totals.idle_pct != null && (
          <p className="text-xs text-slate-600 tabular-nums">
            Cả đội <b className={pctTone(data.totals.idle_pct)}>{data.totals.idle_pct}%</b> · {hm(data.totals.idle_mins)} trên {hm(data.totals.work_mins)} giờ ca
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-3 space-y-3" aria-busy="true" aria-label="Đang tải">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-8 rounded bg-slate-100 motion-safe:animate-pulse" />)}
          </div>
        ) : error ? (
          <div role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 m-3 rounded-lg px-4 py-3">
            <AlertCircle className="size-4 mt-0.5 shrink-0" /><span>{error}</span>
          </div>
        ) : !data || data.drivers.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-16">Chưa có chặng nào được lưu cho {monthLabel(month)}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 text-xs whitespace-nowrap">
              <tr>
                <th scope="col" className="text-left font-semibold px-3 py-2">Tài xế</th>
                <th scope="col" className="text-right font-semibold px-2 py-2">% giờ ca</th>
                <th scope="col" className="text-right font-semibold px-2 py-2">Thời gian chết</th>
                <th scope="col" className="text-right font-semibold px-2 py-2 hidden md:table-cell">Chạy chậm</th>
                <th scope="col" className="text-right font-semibold px-2 py-2 hidden md:table-cell">Ở lâu</th>
                <th scope="col" className="text-right font-semibold px-3 py-2 hidden md:table-cell">Trễ điểm đầu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.drivers.map((d) => {
                const isOpen = open === d.driver_id;
                return (
                  <Fragment key={d.driver_id}>
                    <tr className={isOpen ? "bg-slate-50" : "hover:bg-slate-50"}>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => toggle(d.driver_id)}
                          aria-expanded={isOpen}
                          aria-controls={`idle-${d.driver_id}`}
                          className="flex w-full items-center gap-1.5 text-left rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        >
                          <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${isOpen ? "" : "-rotate-90"}`} aria-hidden />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5"><DriverName full={d.driver_name} className="font-medium text-slate-800 truncate" /></span>
                            <span className="block text-[11px] text-slate-500 tabular-nums">
                              {d.days} ngày{d.no_shift_days > 0 ? ` · ${d.no_shift_days} ngày không có ca` : ""}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className={`${num} font-semibold ${pctTone(d.idle_pct)}`}>{d.idle_pct == null ? "—" : `${d.idle_pct}%`}</td>
                      <td className={`${num} text-slate-800`}>{hm(d.idle_mins)}</td>
                      <td className={`${num} text-slate-600 hidden md:table-cell`}>{d.ride_mins ? hm(d.ride_mins) : "—"}</td>
                      <td className={`${num} text-slate-600 hidden md:table-cell`}>{d.stay_mins ? hm(d.stay_mins) : "—"}</td>
                      <td className={`${num} pr-3 text-slate-600 hidden md:table-cell`}>{d.first_mins ? hm(d.first_mins) : "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr id={`idle-${d.driver_id}`}>
                        <td colSpan={6} className="bg-slate-50 px-3 pb-3 pt-0"><DayEvents days={detail} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="text-[11px] leading-4 text-slate-500 px-3 py-2 border-t border-slate-200 shrink-0">
          {(data.facts_from == null || data.facts_from > `${month}-01`) && (
            <p className="text-amber-800 mb-1">
              {data.facts_from == null
                ? "Tháng này mới có Chạy chậm: Ở lâu, giờ hẹn và Trễ điểm đầu chưa có dữ liệu."
                : `Ở lâu, giờ hẹn và Trễ điểm đầu chỉ có từ ${dayLabel(data.facts_from)}; trước đó chỉ có Chạy chậm.`}
            </p>
          )}
          <details>
            <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-800 w-fit rounded focus-visible:outline-2 focus-visible:outline-blue-600">Cách tính</summary>
            <p className="mt-1">
              Chỉ tính khi có việc mà tài xế chưa đi. Chạy chậm: quá mục tiêu chặng hơn 15p, điểm có giờ hẹn thì trễ hạn là
              tính. Ở lâu: quá 20p tại một điểm khi việc kế đã sẵn sàng (trừ PSC trung chuyển D004/D007/D009/D015 và điểm
              3PL). Trễ điểm đầu: so với giờ vào ca + thời gian chạy từ nơi chấm công, hoặc từ PSC trong config. Trừ một lần
              nghỉ trưa tới 60p (11:00–14:00). % = thời gian chết ÷ giờ ca, ca kéo dài nếu về muộn.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
