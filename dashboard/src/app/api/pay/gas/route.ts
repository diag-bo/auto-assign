/**
 * Lương → "Phụ cấp xăng": one month's gasoline allowance (lib/gas-allowance.ts).
 *
 * GET  ?month=YYYY-MM          prices read from PVOil's own news page
 * POST {month, changes:[...]}  prices typed by the admin, for when PVOil refuses
 *
 * A calculator: nothing is stored, every read is worked out again. km come from
 * tat_legs, which keeps history from the 15th two months back
 * (cartrackHistoryCutoff) — the month is flagged `partial` when it reaches past that.
 * Like /api/pay/team this carries no auth of its own — it follows the dashboard's posture.
 */
import { NextRequest, NextResponse } from "next/server";
import { sbRpc, supabaseConfigured } from "@/lib/supabase-rest";
import { cartrackHistoryCutoff } from "@/lib/time";
import {
  BASE_PRICE_VND, KM_PER_LITRE, PAY_THRESHOLD, allowanceRows, averagePrice, monthBounds,
  parsePvoilDates, parsePvoilTable, pricePeriods, verdict, type PriceChange,
} from "@/lib/gas-allowance";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "sin1";

const PVOIL = "https://www.pvoil.com.vn";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function pvoilText(path: string): Promise<string> {
  const res = await fetch(`${PVOIL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`PVOil trả về HTTP ${res.status}`);
  return res.text();
}

/** The month's changes plus the last one before it (the opening price). */
async function pvoilChanges(month: string): Promise<PriceChange[]> {
  const [start, end] = monthBounds(month);
  const dates = parsePvoilDates(await pvoilText("/tin-gia-xang-dau")).sort();
  // A picker date is the day the change was announced; "24:00 ngày X" lands on X+1,
  // so take a day of slack on each side and let the parsed times decide.
  const inside = dates.filter((d) => d >= start.slice(0, 10) && d <= end.slice(0, 10));
  const before = dates.filter((d) => d < start.slice(0, 10)).slice(-2);
  const wanted = [...before, ...inside];
  if (!wanted.length) throw new Error("PVOil không có bảng giá nào cho tháng này");
  const tables = await Promise.all(wanted.map((d) => pvoilText(`/api/oilprice/load-view?date=${d}`)));
  const changes = tables.map(parsePvoilTable).filter((c): c is PriceChange => !!c);
  if (changes.length < wanted.length) throw new Error("Không đọc được giá E10 RON 95-III trên PVOil");
  return changes;
}

async function answer(month: string, changes: PriceChange[], source: "pvoil" | "manual", pvoilError?: string) {
  const periods = pricePeriods(month, changes);
  const avg = averagePrice(periods);
  const [start, end] = monthBounds(month);
  const lastDay = new Date(Date.parse(`${end}:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const km = await sbRpc<{ driver_id: string; name: string; km: number }[]>("gas_km_by_driver", { p_from: start.slice(0, 10), p_to: lastDay });
  const v = avg == null ? null : verdict(avg);
  const rows = v ? allowanceRows(km.map((r) => ({ ...r, km: Number(r.km) })), v) : [];
  return NextResponse.json({
    month, source, pvoil_error: pvoilError ?? null, changes, periods, verdict: v,
    base: BASE_PRICE_VND, km_per_litre: KM_PER_LITRE, threshold: PAY_THRESHOLD,
    partial: start.slice(0, 10) < cartrackHistoryCutoff(), rows,
  });
}

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "month phải có dạng YYYY-MM" }, { status: 400 });
  let changes: PriceChange[] = [];
  let error: string | undefined;
  try { changes = await pvoilChanges(month); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return answer(month, changes, "pvoil", error);
}

export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  const body = await req.json().catch(() => null) as { month?: string; changes?: unknown } | null;
  const month = body?.month ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "month phải có dạng YYYY-MM" }, { status: 400 });
  const changes = Array.isArray(body?.changes) ? body.changes.flatMap((c) => {
    const { at, price } = (c ?? {}) as { at?: unknown; price?: unknown };
    return typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) && typeof price === "number" && price > 0 && price < 100_000
      ? [{ at, price }] : [];
  }) : [];
  if (!changes.length) return NextResponse.json({ error: "Chưa có giá nào hợp lệ" }, { status: 400 });
  return answer(month, changes, "manual");
}
