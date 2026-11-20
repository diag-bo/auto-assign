"use client";

/**
 * Lương → "Phụ cấp xăng": a month's gasoline allowance for every full-time and
 * part-time account. Prices are read from PVOil on open; when PVOil refuses, or
 * a price needs correcting, the table is editable and "Tính lại" recomputes with
 * the typed prices. Nothing is saved — run it for the previous month before the 20th.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertCircle, Bookmark, CheckCircle2, Download, ExternalLink, Loader2, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { PVOIL_BOOKMARKLET, monthChanges, parsePvoilTables } from "@/lib/gas-allowance";

interface Change { at: string; price: number }
interface Period { price: number; from: string; to: string; hours: number }
interface Row { driver_id: string; name: string; kind: "FT" | "PT"; km: number; litres: number; reference_vnd: number; base_vnd: number; allowance_vnd: number }
interface Report {
  month: string; source: "pvoil" | "manual"; pvoil_error: string | null; changes: Change[]; periods: Period[];
  verdict: { average: number; variance: number; paid: boolean; perKm: number } | null;
  base: number; km_per_litre: number; threshold: number; partial: boolean; rows: Row[];
}

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const km1 = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
const pct = (n: number) => `${(n * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
const lastMonth = () => {
  const [y, m] = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const KIND: Record<Row["kind"], string> = { FT: "Giao Nhận Mẫu", PT: "Giao Nhận Mẫu Part-time" };

export function GasAllowancePanel() {
  const [month, setMonth] = useState(lastMonth);
  const [data, setData] = useState<Report | null>(null);
  const [draft, setDraft] = useState<Change[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState(false);

  const run = useCallback(async (changes?: Change[]) => {
    setBusy(true); setError(null);
    if (!changes) setPasted(false);
    try {
      const res = changes
        ? await fetch("/api/pay/gas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, changes }) })
        : await fetch(`/api/pay/gas?month=${month}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // PVOil refused: start the list with the opening-price row the month needs.
      setData(body); setDraft(body.changes.length ? body.changes : [{ at: `${month}-01T00:00`, price: 0 }]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [month]);
  useEffect(() => { void run(); }, [run]);

  const groups = useMemo(() => (["FT", "PT"] as const).map((k) => {
    const rows = (data?.rows ?? []).filter((r) => r.kind === k);
    return { kind: k, rows, km: rows.reduce((t, r) => t + r.km, 0), pay: rows.reduce((t, r) => t + r.allowance_vnd, 0) };
  }), [data]);
  const total = groups.reduce((t, g) => t + g.pay, 0);
  const edited = JSON.stringify(draft) !== JSON.stringify(data?.changes ?? []);

  /** The month's legs arrive 5 days at a time — the whole month is too big for one response. */
  const [exporting, setExporting] = useState<string | null>(null);
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
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Tháng
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="min-h-11 sm:min-h-9 rounded-lg border border-slate-300 px-2 text-sm" />
        </label>
        <button type="button" onClick={() => void run()} disabled={busy}
          className="flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {busy ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />} Tải lại giá PVOil
        </button>
        <button type="button" onClick={() => void exportXlsx()} disabled={!v || busy || !!exporting} aria-busy={!!exporting || undefined}
          className="flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {exporting ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />} Xuất Excel
        </button>
        {exporting && <span role="status" className="text-xs text-slate-600">{exporting}</span>}
        <span className="text-xs text-slate-500">Tính cho tháng trước, trước ngày 20 hằng tháng.</span>
      </div>

      {error && <p role="alert" className="flex items-center gap-1.5 text-sm text-red-800"><AlertCircle className="size-4 shrink-0" /> {error}</p>}
      {data?.pvoil_error && data.source === "pvoil" && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Máy chủ không đọc được giá PVOil ({data.pvoil_error}). Lấy giá bằng dấu trang &ldquo;Lấy giá PVOil&rdquo; bên dưới.
        </p>
      )}
      <PvoilPaste onPrices={(all) => {
        const changes = monthChanges(month, all);
        if (!changes.length) { setError("Nội dung đã dán không có giá cho tháng này."); return; }
        setPasted(true); setDraft(changes); void run(changes);
      }} onError={setError} />
      {data?.partial && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Tháng này đã quá thời hạn lưu chuyến (từ ngày 15 của hai tháng trước), nên km có thể thiếu.
        </p>
      )}

      {v && data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Giá tham chiếu TB", `${vnd(v.average)} đ/lít`],
            ["Giá cơ bản", `${vnd(data.base)} đ/lít`],
            ["Chênh lệch", `${pct(v.variance)} · ${vnd(v.average - data.base)} đ`],
            ["Tổng phụ cấp", `${vnd(total)} đ`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-sm font-semibold tabular-nums text-slate-900">{value}</div>
            </div>
          ))}
          <p role="status" className={`col-span-2 sm:col-span-4 flex items-center gap-1.5 text-sm font-semibold ${v.paid ? "text-emerald-800" : "text-red-800"}`}>
            {v.paid ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
            {v.paid
              ? `Được trả phụ cấp: ${vnd(v.perKm)} đ/km (chênh lệch từ ${pct(data.threshold)} trở lên)`
              : `Không trả phụ cấp tháng này: chênh lệch dưới ${pct(data.threshold)}`}
          </p>
        </div>
      )}

      {data && (
        <section aria-label="Giá xăng trong tháng" className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <strong className="text-slate-800">Giá Xăng E10 RON 95-III</strong>
            <span>{data.source === "pvoil" && !data.pvoil_error ? "· từ pvoil.com.vn" : pasted && !edited ? "· dán từ PVOil" : "· nhập tay"}</span>
            <span>· giá áp dụng tính theo số giờ trong tháng</span>
          </div>
          <table className="text-sm">
            <thead className="text-xs text-slate-600"><tr>
              <th className="px-2 py-1 text-left font-semibold">Áp dụng từ</th>
              <th className="px-2 py-1 text-left font-semibold">Giá (đ/lít)</th>
              <th className="sr-only">Xoá</th>
            </tr></thead>
            <tbody>
              {draft.map((c, i) => (
                <tr key={i}>
                  <td className="px-2 py-1"><input type="datetime-local" aria-label="Áp dụng từ" value={c.at}
                    onChange={(e) => setDraft((d) => d.map((x, j) => j === i ? { ...x, at: e.target.value } : x))}
                    className="min-h-9 rounded border border-slate-300 px-2 text-sm" /></td>
                  <td className="px-2 py-1"><input type="number" aria-label="Giá (đ/lít)" value={c.price || ""} min={1} step={10}
                    onChange={(e) => setDraft((d) => d.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))}
                    className="min-h-9 w-28 rounded border border-slate-300 px-2 text-sm tabular-nums" /></td>
                  <td className="px-1"><button type="button" aria-label="Xoá dòng giá" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                    className="grid size-9 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-red-700"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setDraft((d) => [...d, { at: `${month}-01T15:00`, price: d.at(-1)?.price ?? data.base }])}
              className="flex items-center gap-1 min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Plus className="size-3.5" aria-hidden /> Thêm lần điều chỉnh
            </button>
            <button type="button" disabled={busy || !draft.length || (!edited && data.source === "manual")} onClick={() => void run(draft)}
              className="min-h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              Tính lại với giá này
            </button>
          </div>
        </section>
      )}

      {v && groups.map((g) => g.rows.length > 0 && (
        <table key={g.kind} className="w-full border border-slate-200 bg-white text-xs shadow-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-2 py-1.5 font-semibold">{KIND[g.kind]} ({g.rows.length})</th>
              <th className="px-2 py-1.5 text-right font-semibold">Km</th>
              <th className="px-2 py-1.5 text-right font-semibold">Xăng cần (lít)</th>
              <th className="px-2 py-1.5 text-right font-semibold">Tiền xăng tham chiếu</th>
              <th className="px-2 py-1.5 text-right font-semibold">Tiền xăng cơ bản</th>
              <th className="px-2 py-1.5 text-right font-semibold">Phụ cấp chênh lệch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {g.rows.map((r) => (
              <tr key={r.driver_id}>
                <td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1 text-right">{km1(r.km)}</td>
                <td className="px-2 py-1 text-right">{km1(r.litres)}</td>
                <td className="px-2 py-1 text-right">{vnd(r.reference_vnd)}</td>
                <td className="px-2 py-1 text-right">{vnd(r.base_vnd)}</td>
                <td className="px-2 py-1 text-right font-semibold">{vnd(r.allowance_vnd)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-2 py-1">Cộng</td>
              <td className="px-2 py-1 text-right">{km1(g.km)}</td>
              <td colSpan={3} />
              <td className="px-2 py-1 text-right">{vnd(g.pay)}</td>
            </tr>
          </tbody>
        </table>
      ))}
      {busy && !data && <p className="py-16 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 size-5 motion-safe:animate-spin" />Đang đọc giá PVOil và km…</p>}
    </div>
  );
}

/**
 * The bookmark lives here: drag it to the bookmarks bar once, click it on
 * PVOil's price page, paste what it copied. React refuses a javascript: href,
 * so it is set on the element directly.
 */
function PvoilPaste({ onPrices, onError }: { onPrices: (c: Change[]) => void; onError: (e: string | null) => void }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { link.current?.setAttribute("href", PVOIL_BOOKMARKLET); }, []);
  const read = (text: string) => {
    const changes = parsePvoilTables(text);
    if (!changes.length) { onError("Không thấy bảng giá Xăng E10 RON 95-III trong nội dung vừa dán."); return; }
    onError(null); onPrices(changes);
  };
  return (
    <section aria-label="Lấy giá từ PVOil" className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <strong className="text-slate-800">Lấy giá từ PVOil</strong>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        <li className="flex flex-wrap items-center gap-2">
          <span>1. Kéo nút này lên thanh dấu trang (chỉ một lần):</span>
          <a ref={link} title="Kéo lên thanh dấu trang" onClick={(e) => { e.preventDefault(); onError("Kéo nút “Lấy giá PVOil” lên thanh dấu trang của Chrome, rồi bấm nó trên trang giá PVOil."); }}
            className="inline-flex cursor-grab items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 min-h-9 font-semibold text-sky-900">
            <Bookmark className="size-3.5" aria-hidden /> Lấy giá PVOil
          </a>
        </li>
        <li>
          2. Mở{" "}
          <a href="https://www.pvoil.com.vn/tin-gia-xang-dau" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-sky-800 underline">
            trang giá PVOil <ExternalLink className="size-3" aria-hidden />
          </a>{" "}
          rồi bấm dấu trang — giá của khoảng 75 ngày gần nhất được chép.
        </li>
        <li>
          <label htmlFor="pvoil-paste">3. Dán vào đây (Ctrl+V):</label>
          <textarea id="pvoil-paste" rows={2} placeholder="Dán nội dung đã chép…" value=""
            onChange={(e) => read(e.target.value)}
            onPaste={(e) => { e.preventDefault(); read(e.clipboardData.getData("text")); }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
        </li>
      </ol>
    </section>
  );
}
