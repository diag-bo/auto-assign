"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, AlertCircle } from "lucide-react";
import { lineProblem, type ParkingPlace, type ParkingLine } from "@/lib/parking-fee";

interface Declaration { lines: ParkingLine[]; claimed_vnd: number; status: string; created_at: string }
interface Data {
  month: string; months: string[]; period: { from: string; to: string };
  places: ParkingPlace[]; visits: Record<string, number>; current: Declaration | null;
}
interface Row { key: number; place_id: string; amount: string; times: string }

const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
const dmy = (d: string) => d.split("-").reverse().join("/");
const STATUS: Record<string, string> = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối" };
const digits = (s: string) => s.replace(/\D/g, "");
let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, place_id: "", amount: "", times: "" });

/** Searchable place picker: name, address in small grey text, matched on both. */
function PlacePicker({ places, value, taken, onPick }: {
  places: ParkingPlace[]; value: string; taken: Set<string>; onPick: (p: ParkingPlace) => void;
}) {
  const picked = places.find((p) => p.id === value);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const f = fold(q.trim());
    return places.filter((p) => !taken.has(p.id) && (!f || fold(`${p.name} ${p.address}`).includes(f)));
  }, [places, q, taken]);

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Tìm tên hoặc địa chỉ..."
        value={open ? q : picked?.name ?? q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {!open && picked && <p className="mt-0.5 text-[11px] text-gray-400 truncate">{picked.address}</p>}
      {open && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {list.length === 0 && <li className="px-3 py-2 text-xs text-gray-400">Không tìm thấy</li>}
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(p); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                <span className="block text-sm text-gray-800">{p.name}</span>
                <span className="block text-[11px] leading-snug text-gray-400">{p.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Gửi Xe" tab of /cham-cong: the signed-in driver declares the parking they
 *  paid in a payroll period. Rules and the check: lib/parking-fee.ts. */
export function ParkingFeeTab({ onExpired }: { onExpired: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // The page re-creates its handler every render; a ref keeps load() stable.
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  const load = useCallback(async (month?: string) => {
    setLoadError("");
    const r = await fetch(`/api/parking-fee${month ? `?month=${month}` : ""}`, { cache: "no-store" });
    if (r.status === 401) return expiredRef.current();
    const j = await r.json().catch(() => null);
    if (!j?.ok) { setLoadError(j?.error ?? "Không tải được dữ liệu."); return; }
    setData(j);
    const cur = (j as Data).current;
    setRows(cur && cur.status === "pending"
      ? cur.lines.map((l) => ({ key: nextKey++, place_id: l.place_id, amount: String(l.amount_vnd), times: String(l.times) }))
      : [emptyRow()]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map((data?.places ?? []).map((p) => [p.id, p])), [data]);
  const taken = useMemo(() => new Set(rows.map((r) => r.place_id).filter(Boolean)), [rows]);

  // Live copy of the server's check (the server recomputes it on submit).
  const lines = rows.map((r) => {
    const p = byId.get(r.place_id);
    const amount = Number(r.amount) || 0, times = Number(r.times) || 0;
    const visits = p ? data?.visits[p.id] ?? 0 : 0;
    const filled = !!p && amount > 0 && times > 0;
    return { r, p, amount, times, visits, claimed: amount * times, problem: filled ? lineProblem(amount, times, p!.fee_vnd, visits) : null, filled };
  });
  const complete = lines.length > 0 && lines.every((l) => l.filled);
  const invalid = lines.some((l) => l.problem);
  const total = lines.reduce((s, l) => s + l.claimed, 0);

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit() {
    if (!data) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/parking-fee", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: data.month,
          lines: lines.map((l) => ({ place_id: l.r.place_id, amount_vnd: l.amount, times: l.times })),
        }),
      });
      if (r.status === 401) return expiredRef.current();
      const j = await r.json().catch(() => null);
      if (!j?.ok) { setMsg({ ok: false, text: j?.error ?? "Không gửi được. Thử lại sau." }); return; }
      setMsg({ ok: true, text: `Đã gửi ${vnd(j.check.claimed_vnd)} — chờ duyệt.` });
      load(data.month);
    } finally { setBusy(false); }
  }

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!data) return <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Đang tải...</p>;

  const monthLabel = (m: string) => { const { from, to } = data.month === m ? data.period : { from: "", to: "" }; return `Kỳ lương tháng ${Number(m.slice(5))}/${m.slice(0, 4)}${from ? ` (${dmy(from)} – ${dmy(to)})` : ""}`; };

  return (
    <div className="space-y-4">
      {data.months.length > 1 ? (
        <select value={data.month} onChange={(e) => load(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {data.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      ) : <p className="text-sm font-semibold text-gray-700">{monthLabel(data.month)}</p>}

      {data.current && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          Đã gửi {vnd(data.current.claimed_vnd)} lúc {new Date(data.current.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} ·{" "}
          <span className="font-semibold">{STATUS[data.current.status] ?? data.current.status}</span>
          {data.current.status === "pending" && ". Gửi lại sẽ thay bản trước."}
        </p>
      )}

      {lines.map((l, i) => (
        <div key={l.r.key} className={`border rounded-xl p-3 space-y-2 ${l.problem ? "border-red-300 bg-red-50/40" : "border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Điểm {i + 1}</span>
            {rows.length > 1 && (
              <button type="button" aria-label="Xoá điểm này" onClick={() => setRows((rs) => rs.filter((r) => r.key !== l.r.key))}
                className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Địa điểm gửi xe</label>
            <PlacePicker places={data.places} value={l.r.place_id} taken={taken}
              onPick={(p) => setRow(l.r.key, { place_id: p.id })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Số tiền gửi xe 1 lần</label>
              <input inputMode="numeric" value={l.r.amount ? Number(l.r.amount).toLocaleString("vi-VN") : ""}
                onChange={(e) => setRow(l.r.key, { amount: digits(e.target.value) })} placeholder="5.000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Số lần gửi xe</label>
              <input inputMode="numeric" value={l.r.times} onChange={(e) => setRow(l.r.key, { times: digits(e.target.value) })} placeholder="1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          {l.problem && (
            <p className="flex gap-1.5 text-xs text-red-700"><AlertCircle size={14} className="shrink-0 mt-0.5" />{l.problem}</p>
          )}
        </div>
      ))}

      <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])}
        className="w-full flex items-center justify-center gap-1.5 border border-dashed border-gray-300 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">
        <Plus size={14} /> Thêm điểm gửi xe
      </button>

      <div className="flex justify-between text-sm font-semibold text-gray-800 border-t border-gray-200 pt-3">
        <span>Tổng cần hoàn trả</span><span>{vnd(total)}</span>
      </div>

      <p className="text-[11px] text-gray-400">Chỉ khai các lần gửi xe tính đến hôm qua.</p>

      <button onClick={submit} disabled={!complete || invalid || busy}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {busy && <Loader2 size={16} className="animate-spin" />}
        Xác nhận tiền gửi xe cần hoàn trả trong kỳ lương
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
