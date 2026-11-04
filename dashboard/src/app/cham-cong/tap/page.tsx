"use client";

/**
 * /cham-cong/tap — one-button chấm công, PILOT (see /api/cham-cong/tap).
 *
 * The real flow a driver would use: Nhận Việc login, one button, place and position
 * decided by the server. Each tap also shows where its time went, so the pilot
 * measures what a driver actually waits. Going live: this body replaces the Chấm
 * Công tab, minus the timing panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Type = "check-in" | "check-out";
type Next =
  | { action: "complete"; job_id: number; type: Type }
  | { action: "create"; type: Type }
  | { action: "wait"; type: Type; until: string };
interface Task { job_id: number; type: Type; done: boolean; time: string | null; place: string | null }
interface State { driver_name: string; next: Next; tasks: Task[]; timings: Record<string, number> }
interface Tap { at: string; label: string; status: number; gps: number; roundTrip: number; timings: Record<string, number>; message: string; detail: string }
interface Fix { lat: number; lon: number; accuracy_m: number }

/** Why the server said what it said, for the pilot: refusal reason, distances, Cartrack's view. */
function detailOf(d: { reason?: string; accuracy_m?: number; cartrack_m?: number | null; position_age_s?: number | null; distance_m?: number | null; place?: string } | null): string {
  if (!d) return "";
  return [
    d.reason,
    d.distance_m != null ? `${d.distance_m}m${d.place ? ` tới ${d.place}` : ""}` : null,
    d.accuracy_m != null ? `GPS ±${d.accuracy_m}m` : null,
    d.cartrack_m != null ? `Cartrack lệch ${d.cartrack_m}m (vị trí ${d.position_age_s}s trước)` : "Cartrack: không đối chiếu",
  ].filter(Boolean).join(" · ");
}

// A fix the page already holds is used if it is this recent; otherwise the tap waits
// for a new one. The server never trusts the page's clock — this is only so the
// driver does not wait for GPS on every tap.
const FIX_FRESH_MS = 20_000;
const GPS = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };

function freshFix(): Promise<Fix> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy }), reject, GPS));
}

const GPS_DENIED = "Trang chưa được phép dùng vị trí. Vui lòng cho phép vị trí trong cài đặt trình duyệt, rồi thử lại.";
const GPS_FAILED = "Chưa lấy được vị trí điện thoại, vui lòng bật định vị rồi thử lại.";

const word = (t: Type) => (t === "check-in" ? "vào ca" : "ra ca");
const hm = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

function label(n: Next): string {
  if (n.action === "create") return n.type === "check-in" ? "Vào Ca" : "Ra Ca";
  if (n.action === "complete") return `Hoàn thành ${word(n.type)}`;
  return `${n.type === "check-in" ? "Vào ca" : "Ra ca"} sau ${hm(n.until)}`;
}

// Server steps in the order they happen; anything else the server sends is listed after.
const STEPS: [string, string][] = [
  ["read", "Đọc song song (chậm nhất)"],
  ["tasks", "· Chấm công hôm nay"],
  ["position", "· Vị trí Cartrack"],
  ["places", "· Điểm được phép"],
  ["config", "  · Config"],
  ["route", "  · Chuyến hôm nay"],
  ["shift", "· Ca hôm nay"],
  ["coords", "Toạ độ điểm khách (không ở chi nhánh)"],
  ["lock", "Khoá chống bấm 2 lần"],
  ["create", "Tạo task"],
  ["complete", "Hoàn thành task"],
  ["record", "· Ghi id task (cùng lúc)"],
  ["total", "Tổng trên máy chủ"],
];

function Timings({ tap }: { tap: Tap }) {
  const rows = STEPS.filter(([k]) => tap.timings[k] != null);
  const network = tap.timings.total != null ? tap.roundTrip - tap.timings.total : null;
  return (
    <table className="w-full text-sm">
      <tbody>
        <tr><td className="py-0.5 text-gray-600">Lấy vị trí điện thoại</td><td className="py-0.5 text-right tabular-nums">{tap.gps} ms</td></tr>
        {rows.map(([k, name]) => (
          <tr key={k} className={k === "total" ? "font-semibold border-t" : ""}>
            <td className="py-0.5 whitespace-pre text-gray-600">{name}</td>
            <td className="py-0.5 text-right tabular-nums">{tap.timings[k]} ms</td>
          </tr>
        ))}
        {network != null && (
          <tr><td className="py-0.5 text-gray-600">Mạng + khởi động</td><td className="py-0.5 text-right tabular-nums">{network} ms</td></tr>
        )}
        <tr className="font-bold border-t">
          <td className="py-1">Tài xế chờ</td>
          <td className="py-1 text-right tabular-nums">{((tap.gps + tap.roundTrip) / 1000).toFixed(2)} s</td>
        </tr>
      </tbody>
    </table>
  );
}

async function fetchState() {
  const res = await fetch("/api/cham-cong/tap", { cache: "no-store" }).catch(() => null);
  return { status: res?.status ?? 0, ok: !!res?.ok, data: await res?.json().catch(() => null) ?? null };
}

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/driver-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, pin }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (data?.ok) onDone(); else setError(data?.error ?? "Đăng nhập không thành công, vui lòng thử lại.");
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-gray-600">Đăng nhập bằng số điện thoại và mã PIN của app Cartrack.</p>
      <input className="w-full border rounded-lg px-3 py-3 text-lg" inputMode="tel" autoComplete="tel" placeholder="Số điện thoại"
        value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="w-full border rounded-lg px-3 py-3 text-lg" type="password" inputMode="numeric" placeholder="Mã PIN"
        value={pin} onChange={(e) => setPin(e.target.value)} />
      {error && <p className="text-red-600">{error}</p>}
      <button disabled={busy || !phone || !pin} className="w-full rounded-lg bg-blue-600 text-white py-3 text-lg font-semibold disabled:opacity-50">
        {busy ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}

export default function ChamCongTapPage() {
  const [view, setView] = useState<"loading" | "login" | "forbidden" | "error" | "ready">("loading");
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const latest = useRef<{ fix: Fix; at: number } | null>(null);

  const apply = useCallback(({ status, ok, data }: { status: number; ok: boolean; data: State & { error?: string } | null }) => {
    if (status === 401) return setView("login");
    if (status === 403) { setError(data?.error ?? null); return setView("forbidden"); }
    if (!ok || !data?.next) { setError(data?.error ?? "Không tải được, vui lòng thử lại."); return setView("error"); }
    setState(data); setView("ready");
  }, []);
  const load = useCallback(() => fetchState().then(apply), [apply]);

  useEffect(() => { fetchState().then(apply); }, [apply]);

  // Keep a fix warm while the page is open, so a tap rarely waits for GPS.
  useEffect(() => {
    if (view !== "ready" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        latest.current = { fix: { lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy }, at: Date.now() };
        setGpsNote(`Định vị điện thoại: ±${Math.round(p.coords.accuracy)}m`);
      },
      (e) => setGpsNote(e.code === e.PERMISSION_DENIED ? GPS_DENIED : GPS_FAILED),
      GPS,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [view]);

  async function tap() {
    if (!state || busy || state.next.action === "wait") return;
    setBusy(true); setNotice(null);
    const g = performance.now();
    let fix: Fix;
    try {
      const held = latest.current;
      fix = held && Date.now() - held.at < FIX_FRESH_MS ? held.fix : await freshFix();
    } catch (e) {
      setBusy(false);
      return setNotice({ ok: false, text: (e as GeolocationPositionError)?.code === 1 ? GPS_DENIED : GPS_FAILED });
    }
    const gps = Math.round(performance.now() - g);
    const t = performance.now();
    const res = await fetch("/api/cham-cong/tap", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expect: state.next, fix }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    const roundTrip = Math.round(performance.now() - t);
    if (res?.status === 401) { setBusy(false); return setView("login"); }
    const text: string = data?.message ?? data?.error ?? "Không kết nối được, vui lòng thử lại.";
    setTaps((list) => [{ at: new Date().toISOString(), label: label(state.next), status: res?.status ?? 0, gps, roundTrip, timings: data?.timings ?? {}, message: text, detail: detailOf(data) }, ...list].slice(0, 10));
    setNotice({ ok: !!data?.ok && data?.completed !== false, text });
    if (data?.ok) {
      // Hold the confirmation in place of the button, so a second tap hits nothing.
      setTimeout(() => { setNotice(null); setBusy(false); void load(); }, 5000);
    } else {
      if (data?.next && state) setState({ ...state, next: data.next, tasks: data.tasks ?? state.tasks });
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/driver-auth", { method: "DELETE" }).catch(() => null);
    setState(null); setTaps([]); setView("login");
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">Chấm công</h1>
          <span className="text-xs rounded bg-amber-100 text-amber-800 px-2 py-0.5">Thử nghiệm</span>
        </header>

        {view === "loading" && <p className="text-gray-500">Đang tải…</p>}
        {view === "login" && <Login onDone={() => { setView("loading"); void load(); }} />}
        {view === "forbidden" && (
          <div className="space-y-3">
            <p className="text-gray-700">{error ?? "Tài khoản chưa được mở."}</p>
            <button onClick={logout} className="text-blue-600 underline">Đăng nhập tài khoản khác</button>
          </div>
        )}
        {view === "error" && (
          <div className="space-y-3">
            <p className="text-red-600">{error}</p>
            <button onClick={() => { setView("loading"); void load(); }} className="rounded-lg border px-4 py-2">Thử lại</button>
          </div>
        )}

        {view === "ready" && state && (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{state.driver_name}</span>
              <button onClick={logout} className="text-gray-500 underline">Đăng xuất</button>
            </div>

            {notice?.ok ? (
              <div className="rounded-2xl bg-green-600 text-white text-center py-10 px-4 text-xl font-semibold">{notice.text}</div>
            ) : (
              <button onClick={tap} disabled={busy || state.next.action === "wait"}
                className={`w-full rounded-2xl py-10 text-2xl font-bold text-white disabled:opacity-60 ${state.next.action === "wait" ? "bg-gray-400" : state.next.type === "check-in" ? "bg-blue-600" : "bg-orange-600"}`}>
                {busy ? "Đang xử lý…" : label(state.next)}
              </button>
            )}
            {gpsNote && <p className="text-xs text-gray-500">{gpsNote}</p>}
            {notice && !notice.ok && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 space-y-2">
                <p>{notice.text}</p>
                <button onClick={() => { setNotice(null); void load(); }} className="rounded border border-red-300 px-3 py-1">Thử lại</button>
              </div>
            )}

            <section className="rounded-lg bg-white border p-3">
              <h2 className="font-semibold mb-2">Chấm công hôm nay</h2>
              {state.tasks.length === 0 ? <p className="text-gray-500 text-sm">Chưa có.</p> : (
                <ul className="text-sm space-y-1">
                  {state.tasks.map((t) => (
                    <li key={t.job_id} className="flex justify-between">
                      <span>{t.type === "check-in" ? "Vào ca" : "Ra ca"} · {t.place ?? "—"}</span>
                      <span className={t.done ? "text-green-700" : "text-amber-700"}>{t.time ?? "—"} {t.done ? "✓" : "(chưa xong)"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {taps.length > 0 && (
              <section className="rounded-lg bg-white border p-3 space-y-3">
                <h2 className="font-semibold">Thời gian chờ (thử nghiệm)</h2>
                <div>
                  <p className="text-sm text-gray-500">{taps[0].label} · HTTP {taps[0].status} · {hm(taps[0].at)}</p>
                  {taps[0].detail && <p className="text-sm text-gray-500 mb-1">{taps[0].detail}</p>}
                  <Timings tap={taps[0]} />
                </div>
                {taps.length > 1 && (
                  <ul className="text-sm text-gray-600 border-t pt-2">
                    {taps.slice(1).map((t) => (
                      <li key={t.at} className="flex justify-between">
                        <span>{hm(t.at)} · {t.label} · {t.status}</span>
                        <span className="tabular-nums">{((t.gps + t.roundTrip) / 1000).toFixed(2)} s</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
