"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { LocationField } from "./schedule-list-panel";
import type { ClientBotGroup } from "@/lib/client-bots";

type Bot = { id: string; name: string; legacy: boolean; configured: boolean };
type Client = { id: string; name: string };
type GroupDraft = ClientBotGroup & { previous?: { bot: string; chat_id: string } };
type BotDraft = { id?: string; name: string; token: string; legacy?: boolean };
type Action = "remind" | "cancel" | "request" | "guide";

const ACTIONS: { key: Action; label: string; hint: string }[] = [
  { key: "remind", label: "Nhắc lịch cố định", hint: "Nhắc trước giờ lấy mẫu cố định" },
  { key: "cancel", label: "Huỷ khi \"không có mẫu\"", hint: "Khách báo không có mẫu → huỷ chuyến cố định hôm nay" },
  { key: "request", label: "Đặt chuyến bằng từ khoá", hint: "Tag bot + từ khoá → tạo chuyến khách → D001" },
  { key: "guide", label: "Hướng dẫn hằng ngày", hint: "Gửi cách dùng bot, T2–T7" },
];
const NEW_GROUP: Omit<GroupDraft, "bot"> = { chat_id: "", customer_id: "", label: "", remind: true, cancel: true, request: false, guide: false, guide_time: "07:30" };

const INPUT = "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs focus-visible:outline-2 focus-visible:outline-indigo-600";
const LABEL = "block text-[10px] font-bold uppercase tracking-wide text-slate-400";
const FORM = "grid gap-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 sm:grid-cols-2";

/** Master Setup → "Bot khách hàng": the bots, which client Zalo groups each sits in, and what it does there. */
export function ClientBotsPanel() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [groups, setGroups] = useState<ClientBotGroup[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [keywords, setKeywords] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [botDraft, setBotDraft] = useState<BotDraft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true); setError("");
    fetch("/api/client-bots", { cache: "no-store", signal: ac.signal })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Không tải được danh sách bot"); return d; })
      .then(d => { setBots(d.bots); setGroups(d.groups); setClients(d.clients); setKeywords(d.keywords.join(", ")); })
      .catch(e => { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [reload]);

  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? id;
  const groupLabel = (g: ClientBotGroup) => g.label || clientName(g.customer_id);

  const call = async (url: string, method: "POST" | "PUT" | "DELETE", body: object, done: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      toast.success(done);
      setGroupDraft(null); setBotDraft(null);
      setReload(n => n + 1);
    } catch (e) {
      toast.error(`Không lưu được: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const saveGroup = (g: GroupDraft) => call("/api/client-bots", "POST", g, "Đã lưu");
  const removeGroup = (g: ClientBotGroup, bot: Bot) => {
    if (confirm(`Xoá ${groupLabel(g)} khỏi ${bot.name}?`)) void call("/api/client-bots", "DELETE", { bot: g.bot, chat_id: g.chat_id }, "Đã xoá");
  };
  const removeBot = (bot: Bot) => {
    if (confirm(`Xoá ${bot.name}? Bot sẽ ngừng nhận tin nhắn.`)) void call("/api/client-bots/bot", "DELETE", { id: bot.id }, "Đã xoá bot");
  };

  return <section aria-label="Bot khách hàng" className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
      <div>
        <h2 className="text-sm font-semibold">Bot khách hàng</h2>
        <p className="mt-1 text-xs text-slate-600">Bot nào ở nhóm Zalo của khách nào, và làm gì ở đó. Lấy Chat ID: thêm bot vào nhóm rồi tag bot và nhắn <b>/id</b>.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setReload(n => n + 1)}><RefreshCw aria-hidden="true" className="size-4" strokeWidth={1.75} />Tải lại</Button>
        <Button variant="outline" size="sm" disabled={loading || !!error} onClick={() => { setGroupDraft(null); setBotDraft({ name: "", token: "" }); }}><Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />Thêm bot</Button>
        <Button size="sm" disabled={loading || !!error || !bots.length} onClick={() => { setBotDraft(null); setGroupDraft({ ...NEW_GROUP, bot: bots[0].id }); }}><Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />Thêm nhóm</Button>
      </div>
    </header>
    <div aria-busy={loading} className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
      {botDraft && <BotForm draft={botDraft} busy={busy} onChange={setBotDraft} onCancel={() => setBotDraft(null)}
        onSave={() => call("/api/client-bots/bot", "POST", botDraft, botDraft.id ? "Đã lưu bot" : "Đã thêm bot và kết nối webhook")} />}
      {groupDraft && <GroupForm draft={groupDraft} bots={bots} clients={clients} busy={busy} onChange={setGroupDraft} onSave={() => saveGroup(groupDraft)} onCancel={() => setGroupDraft(null)} />}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p>
        : loading ? <p role="status" className="text-sm text-slate-600">Đang tải…</p>
        : <>
          <form className="rounded-lg border border-slate-200 p-3" onSubmit={e => { e.preventDefault(); void call("/api/client-bots", "PUT", { keywords: keywords.split(",") }, "Đã lưu từ khoá"); }}>
            <label htmlFor="client-bot-keywords" className="text-sm font-semibold">Từ khoá đặt chuyến <span className="font-normal text-slate-600">— dùng chung cho mọi nhóm, cách nhau bằng dấu phẩy</span></label>
            <div className="mt-2 flex gap-2">
              <input id="client-bot-keywords" value={keywords} onChange={e => setKeywords(e.target.value)} className={INPUT} />
              <Button type="submit" size="sm" disabled={busy || !keywords.trim()}>Lưu</Button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">3 từ khoá đầu hiện trong tin gợi ý hằng ngày. Tin báo &quot;không có mẫu&quot; không bao giờ tạo chuyến.</p>
          </form>
          {bots.map(bot => {
            const rows = groups.filter(g => g.bot === bot.id);
            return <div key={bot.id} className="rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold">{bot.name}</h3>
                <div className="flex items-center gap-1">
                  <span className={`text-xs ${bot.configured ? "text-emerald-700" : "text-red-700"}`}>
                    {!bot.configured ? "Chưa có token — bot không gửi được" : bot.legacy ? "Token + webhook cấu hình sẵn" : "Đã kết nối"}
                  </span>
                  <Button variant="ghost" size="sm" aria-label={`Sửa ${bot.name}`} disabled={busy} onClick={() => { setGroupDraft(null); setBotDraft({ id: bot.id, name: bot.name, token: "", legacy: bot.legacy }); }}><Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} /></Button>
                  {!bot.legacy && !rows.length && <Button variant="ghost" size="sm" aria-label={`Xoá ${bot.name}`} disabled={busy} onClick={() => removeBot(bot)}><Trash2 aria-hidden="true" className="size-4 text-red-600" strokeWidth={1.75} /></Button>}
                </div>
              </div>
              {!rows.length ? <p className="p-3 text-xs text-slate-600">Chưa ở nhóm khách hàng nào.</p> : <ul>{rows.map(g => <li key={g.chat_id} className="space-y-2 border-t border-slate-200 p-3 first:border-t-0">
                <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{groupLabel(g)}</div>
                  <div className="break-all font-mono text-[11px] text-slate-500">{g.chat_id}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" aria-label="Sửa nhóm" disabled={busy} onClick={() => { setBotDraft(null); setGroupDraft({ ...g, previous: { bot: g.bot, chat_id: g.chat_id } }); }}><Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} /></Button>
                  <Button variant="ghost" size="sm" aria-label="Xoá nhóm" disabled={busy} onClick={() => removeGroup(g, bot)}><Trash2 aria-hidden="true" className="size-4 text-red-600" strokeWidth={1.75} /></Button>
                </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {ACTIONS.map(a => <label key={a.key} title={a.hint} className="flex items-center gap-1.5 text-xs text-slate-700">
                    <Switch aria-label={`${a.label} — ${groupLabel(g)}`} checked={g[a.key]} disabled={busy} onCheckedChange={on => saveGroup({ ...g, [a.key]: on })} />{a.label}
                  </label>)}
                  {g.guide && <label className="flex items-center gap-1.5 text-xs text-slate-700">lúc
                    <input key={g.guide_time} type="time" defaultValue={g.guide_time} disabled={busy} aria-label={`Giờ gửi hướng dẫn — ${groupLabel(g)}`}
                      onBlur={e => { if (e.target.value && e.target.value !== g.guide_time) void saveGroup({ ...g, guide_time: e.target.value }); }}
                      className="h-7 rounded-md border border-slate-300 px-1 text-xs" />
                  </label>}
                </div>
              </li>)}</ul>}
            </div>;
          })}
        </>}
    </div>
    <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">Tắt hết thì bot vẫn ở nhóm nhưng im lặng. Tag bot + &quot;hướng dẫn&quot; trong nhóm để xem cách dùng bất cứ lúc nào.</p>
  </section>;
}

function BotForm({ draft, busy, onChange, onSave, onCancel }: {
  draft: BotDraft; busy: boolean; onChange: (d: BotDraft) => void; onSave: () => void; onCancel: () => void;
}) {
  const ready = draft.name.trim() && (draft.id || draft.token.trim());
  return <form className={FORM} onSubmit={e => { e.preventDefault(); if (ready) onSave(); }}>
    <label className="space-y-0.5"><span className={LABEL}>Tên bot (đúng như trên Zalo)</span>
      <input value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} placeholder="Bot Giao nhận mẫu" className={INPUT} />
    </label>
    {!draft.legacy && <label className="space-y-0.5"><span className={LABEL}>Token bot</span>
      <input type="password" autoComplete="off" value={draft.token} onChange={e => onChange({ ...draft, token: e.target.value })}
        placeholder={draft.id ? "Để trống = giữ token cũ" : "Dán token từ Zalo Bot Creator"} className={`${INPUT} font-mono`} />
    </label>}
    <p className="text-[11px] text-slate-500 sm:col-span-2">
      {draft.legacy ? "Bot này dùng token và webhook cấu hình sẵn — chỉ đổi tên hiển thị trong tin nhắn."
        : "Khi lưu token, hệ thống kiểm tra với Zalo và tự đăng ký webhook. Tên dùng để tag trong tin nhắn hướng dẫn."}
    </p>
    <div className="flex justify-end gap-2 sm:col-span-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>Huỷ</Button>
      <Button type="submit" size="sm" disabled={busy || !ready}>{draft.token.trim() ? "Lưu và kết nối" : "Lưu"}</Button>
    </div>
  </form>;
}

function GroupForm({ draft, bots, clients, busy, onChange, onSave, onCancel }: {
  draft: GroupDraft; bots: Bot[]; clients: Client[]; busy: boolean;
  onChange: (d: GroupDraft) => void; onSave: () => void; onCancel: () => void;
}) {
  const set = (patch: Partial<GroupDraft>) => onChange({ ...draft, ...patch });
  const ready = draft.chat_id.trim() && clients.some(c => c.id === draft.customer_id);
  return <form className={FORM} onSubmit={e => { e.preventDefault(); if (ready) onSave(); }}>
    <label className="space-y-0.5"><span className={LABEL}>Bot</span>
      <select value={draft.bot} onChange={e => set({ bot: e.target.value })} className={INPUT}>
        {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
    <label className="space-y-0.5"><span className={LABEL}>Chat ID nhóm</span>
      <input value={draft.chat_id} onChange={e => set({ chat_id: e.target.value })} placeholder="zgr-…" className={`${INPUT} font-mono`} />
    </label>
    <LocationField key={draft.previous?.chat_id ?? "new"} label="Khách hàng" id={draft.customer_id} name={clients.find(c => c.id === draft.customer_id)?.name ?? ""} options={clients} onChange={id => set({ customer_id: id })} />
    <label className="space-y-0.5"><span className={LABEL}>Tên nhóm (tuỳ chọn)</span>
      <input value={draft.label} onChange={e => set({ label: e.target.value })} placeholder="Để trống = tên khách hàng" className={INPUT} />
    </label>
    {ACTIONS.map(a => <label key={a.key} className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={draft[a.key]} onChange={e => set({ [a.key]: e.target.checked })} />
      <span><b className="font-medium">{a.label}</b> — {a.hint}</span>
    </label>)}
    {draft.guide && <label className="flex items-center gap-2 text-xs">Gửi hướng dẫn lúc
      <input type="time" value={draft.guide_time} onChange={e => set({ guide_time: e.target.value })} className="h-7 rounded-md border border-slate-300 px-1 text-xs" />
    </label>}
    <div className="flex justify-end gap-2 sm:col-span-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>Huỷ</Button>
      <Button type="submit" size="sm" disabled={busy || !ready}>Lưu</Button>
    </div>
  </form>;
}
