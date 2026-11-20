/**
 * Lương → "Phụ cấp xăng": one month's gasoline allowance (lib/gas-allowance.ts).
 *
 * GET ?month=YYYY-MM — prices come from Supabase `gas_prices`. Each read first
 * imports any Petrolimex change not yet saved: the change TIME from Petrolimex's
 * own release list, the FIGURE from giaxanghomnay.com (Petrolimex publishes its
 * prices only as pictures). A release with no figure comes back as `missing`, for
 * someone to type from the release. Import failures never block the read.
 * km come from tat_legs (RPC gas_km_by_driver), which keeps history from the
 * 15th two months back — `partial` when the month reaches past that.
 * Like /api/pay/team this carries no auth of its own — it follows the dashboard's posture.
 */
import { NextRequest, NextResponse } from "next/server";
import { sbInsert, sbRpc, sbSelect, supabaseConfigured } from "@/lib/supabase-rest";
import { cartrackHistoryCutoff } from "@/lib/time";
import {
  BASE_PRICE_VND, GIAXANG_HISTORY, KM_PER_LITRE, PAY_THRESHOLD, PETROLIMEX_RELEASES, allowanceRows, averagePrice,
  effectivePrices, importable, monthBounds, monthChanges, parseGiaxanghomnay, parsePetrolimexReleases,
  petrolimexChanges, pricePeriods, verdict,
} from "@/lib/gas-allowance";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "sin1";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
type Saved = { at: string; price: number; source: string };

const text = async (url: string) => {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} trả về HTTP ${res.status}`);
  return res.text();
};
const loadSaved = async (): Promise<Saved[]> =>
  (await sbSelect<Saved>("gas_prices", "select=at,price,source&order=at")).map((r) => ({ ...r, at: r.at.slice(0, 16) }));

/** Saves new Petrolimex changes; returns releases still lacking a figure. */
async function importPetrolimex(saved: Saved[]) {
  const [p1, p2, agg] = await Promise.all([text(`${PETROLIMEX_RELEASES}.html`), text(`${PETROLIMEX_RELEASES}/2.html`), text(GIAXANG_HISTORY)]);
  const { found, missing } = petrolimexChanges([...parsePetrolimexReleases(p1), ...parsePetrolimexReleases(p2)], parseGiaxanghomnay(agg));
  const held = effectivePrices(saved);
  const fresh = importable(held, found);
  if (fresh.length) await sbInsert("gas_prices", fresh.map((c) => ({ at: c.at, price: c.price, source: "petrolimex" })));
  const unpriced = new Set(importable([...held, ...fresh], missing.map((m) => ({ at: m.at, price: 0 }))).map((m) => m.at));
  return { added: fresh, missing: missing.filter((m) => unpriced.has(m.at)) };
}

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "month phải có dạng YYYY-MM" }, { status: 400 });
  const [start, end] = monthBounds(month);

  let saved = await loadSaved();
  let importError: string | null = null, missing: { at: string; url?: string }[] = [];
  try {
    const r = await importPetrolimex(saved);
    if (r.added.length) saved = await loadSaved();
    // Only a release that moves this month's prices matters: after the price in
    // force on the 1st, before the month ends.
    const opening = effectivePrices(saved).filter((p) => p.at <= start).at(-1)?.at ?? "";
    missing = r.missing.filter((m) => m.at > opening && m.at < end);
  } catch (e) { importError = e instanceof Error ? e.message : String(e); }

  const all = effectivePrices(saved);
  const prices = monthChanges(month, all) as (typeof all)[number][];
  const avg = averagePrice(pricePeriods(month, prices));
  const lastDay = new Date(Date.parse(`${end}:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const km = await sbRpc<{ driver_id: string; name: string; km: number }[]>("gas_km_by_driver", { p_from: start.slice(0, 10), p_to: lastDay });
  const v = avg == null ? null : verdict(avg);
  return NextResponse.json({
    month, prices, periods: pricePeriods(month, prices), latest: all.at(-1) ?? null, missing, import_error: importError,
    verdict: v, base: BASE_PRICE_VND, km_per_litre: KM_PER_LITRE, threshold: PAY_THRESHOLD,
    partial: start.slice(0, 10) < cartrackHistoryCutoff(),
    rows: v ? allowanceRows(km.map((r) => ({ ...r, km: Number(r.km) })), v) : [],
  });
}
