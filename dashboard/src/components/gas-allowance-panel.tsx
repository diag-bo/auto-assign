"use client";

/**
 * Lương → "Phụ cấp xăng". Result first: the month, whether it is paid, the four
 * numbers, then drivers on the left and the month's saved prices on the right.
 * Prices are Petrolimex's, imported on open (lib/gas-allowance.ts); a change the
 * import could not price is flagged and typed in the price list, once.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Plus, Search, Trash2, XCircle } from "lucide-react";
import { PETROLIMEX_RELEASES } from "@/lib/gas-allowance";

interface Price { at: string; price: number; source: string }
interface Period { price: number; from: string; to: string; hours: number }
interface Row { driver_id: string; name: string; kind: "FT" | "PT"; km: number; litres: number; reference_vnd: number; base_vnd: number; allowance_vnd: number }
interface Report {
  month: string; prices: Price[]; periods: Period[]; missing: { at: string; url?: string }[]; import_error: string | null;
  verdict: { average: number; variance: number; paid: boolean; perKm: number } | null;
  base: number; km_per_litre: number; threshold: number; partial: boolean; rows: Row[];
}

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const one = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
const when = (at: string) => `${at.slice(8, 10)}/${at.slice(5, 7)} ${at.slice(11, 16)}`;
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const lastMonth = () => shift(new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7), -1);
const millions = (n: number) => `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tr đ`;

export function GasAllowancePanel() {
  const [month, setMonth] = useState(lastMonth);
  const [data, setData] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"FT" | "PT">("FT");
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/pay/gas?month=${month}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => (["FT", "PT"] as const).map((k) => {
    const rows = (data?.rows ?? []).filter((r) => r.kind === k);
    return { kind: k, count: rows.length, km: rows.reduce((t, r) => t + r.km, 0), pay: rows.reduce((t, r) => t + r.allowance_vnd, 0) };
  }), [data]);
  const shown = useMemo(() => {
    const q = query.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return (data?.rows ?? []).filter((r) => r.kind === kind &&
      (!q || r.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().includes(q)));
  }, [data, kind, query]);

  const savePrice = async (method: "POST" | "DELETE", at: string, price?: number) => {
    setError(null);
    const res = await fetch("/api/pay/gas/prices", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at, price }) });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`); return false; }
    await load(); return true;
  };

  /** The month's legs arrive 5 days at a time — the whole month is too big for one response. */
  const exportXlsx = async () => {
    if (!data?.verdict) return;
    const [y, m] = data.month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const trips: { columns: string[]; rows: unknown[][] } = { columns: [], rows: [] };
    try {
      for (let d = 1; d <= days; d += 5) {
        setExporting(`Đang tải chuyến ${d}–${Math.min(d + 4, days)}/${m}…`);
        const day = (n: number) => `${data.month}-${String(n).padStart(2, "0")}`;
        const res = await fetch(`/api/pay/gas/legs?from=${day(d)}&to=${day(Math.min(d + 4, days))}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        trips.columns = body.columns; trips.rows.push(...body.rows);
      }
      setExporting("Đang tạo file Excel…");
      const { gasWorkbook, gasFileName } = await import("@/lib/gas-allowance-xlsx");
      XLSX.writeFile(gasWorkbook({ month: data.month, base: data.base, average: data.verdict.average, periods: data.periods, rows: data.rows, trips }),
        gasFileName(data.month), { compression: true, bookSST: true });
    } catch (e) { setError(`Xuất Excel lỗi: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setExporting(null); }
  };

  const v = data?.verdict;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto pb-2">
      {/* Month, verdict, export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Tháng trước" onClick={() => setMonth((m) => shift(m, -1))}
            className="grid size-9 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"><ChevronLeft className="size-4" /></button>
          <h2 className="min-w-32 text-center text-base font-semibold text-slate-900 tabular-nums">Tháng {Number(month.slice(5))}/{month.slice(0, 4)}</h2>
          <button type="button" aria-label="Tháng sau" onClick={() => setMonth((m) => shift(m, 1))}
            className="grid size-9 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"><ChevronRight className="size-4" /></button>
        </div>
        {busy && <Loader2 className="size-4 text-slate-500 motion-safe:animate-spin" aria-label="Đang tải" />}
        {v && data && (
          <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${v.paid ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
            {v.paid ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
            {v.paid ? "Được trả" : "Không trả"} · {pct(v.variance)} so với giá cơ bản{!v.paid && ` (cần từ ${pct(data.threshold)})`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {exporting && <span role="status" className="text-xs text-slate-600">{exporting}</span>}
          <button type="button" onClick={() => void exportXlsx()} disabled={!v || busy || !!exporting}
            className="flex items-center gap-1.5 min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {exporting ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />} Xuất Excel
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {data && data.missing.length > 0 && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Petrolimex đổi giá {data.missing.map((m, i) => <span key={m.at}>{i > 0 && ", "}
            {m.url ? <a href={m.url} target="_blank" rel="noopener noreferrer" className="underline">{when(m.at)}</a> : when(m.at)}</span>)} nhưng chưa có số tự động — xem thông cáo và nhập giá ở bảng giá bên phải. Kết quả tháng này chưa đúng đến khi nhập.</span>
        </p>
      )}
      {data?.partial && <p className="text-xs text-amber-800">Tháng này đã quá thời hạn lưu chuyến (từ ngày 15 của hai tháng trước) — km có thể thiếu.</p>}

      {data && !v && (
        <p className="rounded-md border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-600">
          Chưa có giá xăng đang áp dụng ngày 01/{month.slice(5)} — thêm giá ở bảng giá bên dưới.
        </p>
      )}

      {v && data && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            ["Giá TB tháng", `${vnd(v.average)} đ/lít`],
            ["Phụ cấp mỗi km", v.paid ? `${one(v.perKm)} đ` : "0 đ"],
            [`Toàn thời gian · ${totals[0].count}`, millions(totals[0].pay)],
            [`Bán thời gian · ${totals[1].count}`, millions(totals[1].pay)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-100 px-3 py-2">
              <div className="text-xs text-slate-600">{label}</div>
              <div className="text-base font-semibold tabular-nums text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {/* Drivers */}
          <section aria-label="Tài xế" className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Loại tài xế" className="flex rounded-lg border border-slate-300 p-0.5">
                {(["FT", "PT"] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                    className={`min-h-8 rounded-md px-3 text-xs font-semibold ${kind === k ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
                    {k === "FT" ? "Toàn thời gian" : "Bán thời gian"} <span className="tabular-nums opacity-75">{totals[k === "FT" ? 0 : 1].count}</span>
                  </button>
                ))}
              </div>
              <label className="relative ml-auto">
                <span className="sr-only">Tìm tài xế</span>
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên hoặc mã"
                  className="min-h-8 w-44 rounded-lg border border-slate-300 pl-7 pr-2 text-xs" />
              </label>
            </div>
            <div className="max-h-[52vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="py-1.5 pr-2 text-left font-semibold">Tài xế</th>
                    <th className="px-2 text-right font-semibold">Km</th>
                    <th className="px-2 text-right font-semibold">Lít</th>
                    <th className="pl-2 text-right font-semibold">Phụ cấp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {shown.map((r) => (
                    <tr key={r.driver_id}>
                      <td className="py-1 pr-2">{r.name.replace(/^[FP] - [A-Z] - /, "")}</td>
                      <td className="px-2 text-right">{one(r.km)}</td>
                      <td className="px-2 text-right">{one(r.litres)}</td>
                      <td className="pl-2 text-right font-semibold">{vnd(r.allowance_vnd)}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Không có tài xế phù hợp.</td></tr>}
                </tbody>
                {!query && shown.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-white font-semibold tabular-nums">
                    <tr className="border-t border-slate-200">
                      <td className="py-1.5 pr-2">Cộng</td>
                      <td className="px-2 text-right">{one(totals[kind === "FT" ? 0 : 1].km)}</td>
                      <td />
                      <td className="pl-2 text-right">{vnd(totals[kind === "FT" ? 0 : 1].pay)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <PriceList prices={data.prices} month={month} importError={data.import_error} onSave={savePrice} />
        </div>
      )}
      {busy && !data && <p className="py-16 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 size-5 motion-safe:animate-spin" />Đang tải…</p>}
    </div>
  );
}

/** The month's saved prices, plus one line to add or correct a price. */
function PriceList({ prices, month, importError, onSave }: {
  prices: Price[]; month: string; importError: string | null;
  onSave: (method: "POST" | "DELETE", at: string, price?: number) => Promise<boolean>;
}) {
  const [at, setAt] = useState(`${month}-01T15:00`);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setAt(`${month}-01T15:00`); }, [month]);
  const add = async () => {
    setSaving(true);
    if (await onSave("POST", at, Number(price))) setPrice("");
    setSaving(false);
  };
  return (
    <section aria-label="Giá xăng trong tháng" className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-sm text-slate-900">Giá E10 RON 95-III</strong>
        <a href={`${PETROLIMEX_RELEASES}.html`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-800 underline">
          Petrolimex <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
      <table className="w-full">
        <thead className="text-slate-600"><tr className="border-b border-slate-200">
          <th className="py-1 text-left font-semibold">Từ</th><th className="text-right font-semibold">đ/lít</th><th className="w-8"><span className="sr-only">Xoá</span></th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {prices.map((p, i) => (
            <tr key={p.at}>
              <td className="py-1">{when(p.at)}{i === 0 && p.at < `${month}-01T00:01` && <span className="ml-1 text-slate-500">(đầu tháng)</span>}
                {p.source === "manual" && <span className="ml-1 rounded bg-sky-50 px-1 text-sky-800">nhập tay</span>}</td>
              <td className="text-right">{vnd(p.price)}</td>
              <td className="text-right">{p.source === "manual" && (
                <button type="button" aria-label={`Xoá giá nhập tay ${when(p.at)}`} onClick={() => void onSave("DELETE", p.at)}
                  className="grid size-7 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-red-700"><Trash2 className="size-3.5" /></button>)}</td>
            </tr>
          ))}
          {prices.length === 0 && <tr><td colSpan={3} className="py-3 text-slate-500">Chưa có giá nào cho tháng này.</td></tr>}
        </tbody>
      </table>
      <form className="mt-2 flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input type="datetime-local" aria-label="Áp dụng từ" value={at} onChange={(e) => setAt(e.target.value)} required
          className="min-h-8 rounded border border-slate-300 px-1.5" />
        <input type="number" aria-label="Giá (đ/lít)" placeholder="đ/lít" value={price} onChange={(e) => setPrice(e.target.value)} min={1000} max={99999} step={10} required
          className="min-h-8 w-20 rounded border border-slate-300 px-1.5 tabular-nums" />
        <button type="submit" disabled={saving}
          className="flex items-center gap-1 min-h-8 rounded-lg border border-slate-300 px-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Plus className="size-3.5" aria-hidden /> Lưu
        </button>
      </form>
      <p className="mt-1.5 text-slate-500">Giá Petrolimex (Vùng 1) tự cập nhật khi mở trang. Giá nhập tay thay giá tự động cùng thời điểm.</p>
      {importError && <p className="mt-1 text-slate-500">Lần này không tự cập nhật được ({importError}); dùng giá đã lưu.</p>}
    </section>
  );
}
