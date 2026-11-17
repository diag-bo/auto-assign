"use client";

/**
 * "Tăng ca": MISA overtime requests waiting for approval, each checked against
 * Cartrack trips (full-time account, and the PT twin's in the same hours), MISA's
 * clock-ins, the shift, Lịch Chủ nhật and leave. Review only — approving still
 * happens in MISA.
 *
 * Reading MISA means a browser login on the server (~30 s), so the answer is kept
 * for the life of the page: switching tabs does not read it again, "Tải lại" does.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, Loader2, RefreshCw, XCircle } from "lucide-react";

type Level = "ok" | "warn" | "bad";
type Status = Level | "unchecked";
interface Req {
  id: number; code: string; name: string; date: string; from: string; to: string; hours: number;
  kindLabel: string; shiftName: string | null; reason: string; appliedAt: string; approver: string;
  verdict: { status: Status; checks: { level: Level; text: string }[]; coveredMins: number | null; claimedMins: number; workFrom: string | null; workTo: string | null };
}
interface Report { fetched_at: string; requests: Req[] }

let cached: Report | null = null;

const STATUS: Record<Status, { label: string; Icon: typeof CheckCircle2; cls: string }> = {
  bad: { label: "Không khớp", Icon: XCircle, cls: "text-red-700 bg-red-50 border-red-200" },
  warn: { label: "Cần xem", Icon: AlertTriangle, cls: "text-amber-800 bg-amber-50 border-amber-200" },
  unchecked: { label: "Chưa kiểm được", Icon: CircleDashed, cls: "text-slate-700 bg-slate-50 border-slate-200" },
  ok: { label: "Khớp", Icon: CheckCircle2, cls: "text-emerald-800 bg-emerald-50 border-emerald-200" },
};
const ORDER: Status[] = ["bad", "warn", "unchecked", "ok"];
const CHECK_ICON: Record<Level, { Icon: typeof CheckCircle2; cls: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-emerald-600" },
  warn: { Icon: AlertTriangle, cls: "text-amber-600" },
  bad: { Icon: XCircle, cls: "text-red-600" },
};
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dayLabel = (d: string) => `${WEEKDAY[new Date(`${d}T12:00:00+07:00`).getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
const hrs = (m: number) => `${Math.round(m / 6) / 10}`.replace(".", ",");

export function OvertimeReviewPanel() {
  const [data, setData] = useState<Report | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Status>("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/overtime", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      cached = body as Report; setData(cached);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!cached) void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { bad: 0, warn: 0, unchecked: 0, ok: 0 };
    for (const r of data?.requests ?? []) c[r.verdict.status]++;
    return c;
  }, [data]);
  const rows = useMemo(() => (data?.requests ?? [])
    .filter((r) => filter === "all" || r.verdict.status === filter)
    .sort((a, b) => ORDER.indexOf(a.verdict.status) - ORDER.indexOf(b.verdict.status)
      || a.name.localeCompare(b.name, "vi") || a.date.localeCompare(b.date)), [data, filter]);

  const chip = (key: "all" | Status, label: string, n: number) => (
    <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}
      className={`min-h-11 sm:min-h-9 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap ${filter === key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-slate-200 shrink-0">
        <div className="leading-tight mr-1">
          <p className="text-sm font-semibold text-slate-800">Tăng ca chờ duyệt</p>
          <p className="text-xs text-slate-600">Kiểm theo Cartrack, chấm công MISA, Lịch CN · duyệt trong MISA</p>
        </div>
        {data && <div className="flex flex-wrap items-center gap-1">
          {chip("all", "Tất cả", data.requests.length)}
          {ORDER.map((s) => chip(s, STATUS[s].label, counts[s]))}
        </div>}
        <div className="ml-auto flex items-center gap-2">
          {data && <span className="text-xs text-slate-600 tabular-nums">
            Đọc lúc {new Date(data.fetched_at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}
          </span>}
          <button onClick={() => void load()} disabled={loading}
            className="flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            Tải lại
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <p role="alert" className="m-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}
        {loading && !data && (
          <p className="flex items-center gap-2 p-6 text-sm text-slate-600">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Đang đăng nhập MISA và đọc đơn (khoảng 30 giây)…
          </p>
        )}
        {data && !rows.length && <p className="p-6 text-sm text-slate-600">Không có đơn nào{filter !== "all" ? " ở mục này" : " chờ duyệt"}.</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const s = STATUS[r.verdict.status];
            const v = r.verdict;
            return (
              <li key={r.id} className="px-3 py-2.5 grid gap-2 md:grid-cols-[minmax(0,15rem)_minmax(0,13rem)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{r.name} <span className="text-xs font-normal text-slate-600">{r.code}</span></p>
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${s.cls}`}>
                    <s.Icon className="size-3.5" aria-hidden="true" /> {s.label}
                  </span>
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-slate-800 tabular-nums">{dayLabel(r.date)} · {r.from}–{r.to}</p>
                  <p className="text-xs text-slate-600">
                    {hrs(v.claimedMins)} giờ · {r.kindLabel || "—"}
                    {v.coveredMins != null && v.coveredMins < v.claimedMins - 15 && <> · <span className="font-semibold text-amber-800">có việc {hrs(v.coveredMins)} giờ</span></>}
                  </p>
                  {r.shiftName && <p className="text-xs text-slate-500 truncate" title={r.shiftName}>{r.shiftName}</p>}
                </div>
                <div className="min-w-0">
                  <ul className="space-y-0.5">
                    {v.checks.map((c, i) => {
                      const ci = CHECK_ICON[c.level];
                      return <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                        <ci.Icon className={`size-3.5 mt-px shrink-0 ${ci.cls}`} aria-label={c.level === "ok" ? "khớp" : c.level === "warn" ? "cần xem" : "không khớp"} />
                        <span>{c.text}</span>
                      </li>;
                    })}
                  </ul>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.reason && <>“{r.reason}” · </>}nộp {r.appliedAt.slice(8, 10)}/{r.appliedAt.slice(5, 7)} {r.appliedAt.slice(11)} · duyệt: {r.approver || "—"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
