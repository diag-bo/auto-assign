"use client";

/** Every driver account, searchable, with the whole list downloadable as CSV. */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Loader2, Search } from "lucide-react";

interface DriverRow {
  driver_id: string; employee_code: string; type: string; full_name: string; cartrack_name: string;
  is_active: boolean; phone: string; phone_update: string; email: string; shift: string;
  start_location: string; end_location: string; zalo_id: string; registration: string;
  device: string; last_login: string; created: string;
}

// Column order is the CSV's; the table shows the first ones that fit a screen.
const COLUMNS: [keyof DriverRow, string][] = [
  ["employee_code", "Mã NV"], ["full_name", "Họ tên"], ["type", "Loại"], ["is_active", "Trạng thái"],
  ["phone", "SĐT"], ["phone_update", "SĐT cập nhật"], ["shift", "Ca"], ["start_location", "Điểm bắt đầu"],
  ["end_location", "Điểm kết thúc"], ["email", "Email"], ["cartrack_name", "Tên Cartrack"], ["zalo_id", "Zalo ID"],
  ["registration", "Biển số"], ["device", "Thiết bị"], ["last_login", "Đăng nhập gần nhất"], ["created", "Ngày tạo"],
  ["driver_id", "Driver ID"],
];
const SHOWN = 9;

const cell = (r: DriverRow, k: keyof DriverRow) => (k === "is_active" ? (r.is_active ? "Hoạt động" : "Ngừng") : String(r[k] ?? ""));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

export function DriverListPanel() {
  const [rows, setRows] = useState<DriverRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  useEffect(() => {
    fetch("/api/driver-list", { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setRows(d.rows); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return (rows ?? []).filter((r) => (!activeOnly || r.is_active) &&
      (!q || fold([r.employee_code, r.full_name, r.cartrack_name, r.phone, r.phone_update, r.email].join(" ")).includes(q)));
  }, [rows, query, activeOnly]);

  const download = () => {
    const lines = [COLUMNS.map(([, h]) => h), ...shown.map((r) => COLUMNS.map(([k]) => cell(r, k)))]
      .map((line) => line.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","));
    // BOM so Excel opens Vietnamese diacritics correctly instead of mojibake.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
    a.download = `tai-xe-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 shrink-0">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">Tìm tài xế</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên, mã NV, SĐT, email…"
            className="w-full rounded border border-slate-300 py-1.5 pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="size-4 accent-indigo-600" />
          Chỉ đang hoạt động
        </label>
        <span className="text-xs text-slate-500">{rows ? `${shown.length} / ${rows.length} tài khoản` : ""}</span>
        <button type="button" onClick={download} disabled={!shown.length}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <Download aria-hidden="true" className="size-3.5" /> Tải CSV
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="m-3 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>Không tải được danh sách tài xế: {error}</span>
          </div>
        ) : !rows ? (
          <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 aria-label="Đang tải" className="size-6 animate-spin" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
              <tr>{COLUMNS.slice(0, SHOWN).map(([k, h]) => <th key={k} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r.driver_id} className={`hover:bg-slate-50 ${r.is_active ? "" : "text-slate-400"}`}>
                  {COLUMNS.slice(0, SHOWN).map(([k]) => <td key={k} className="px-3 py-1.5 align-top">{cell(r, k)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 shrink-0">
        File CSV có đủ {COLUMNS.length} cột (thêm email, tên Cartrack, Zalo ID, biển số, thiết bị, lần đăng nhập, Driver ID) và theo đúng bộ lọc đang chọn.
      </p>
    </div>
  );
}
