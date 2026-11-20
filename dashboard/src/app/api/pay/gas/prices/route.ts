/**
 * Phụ cấp xăng: a typed price change. POST {at, price} saves it as 'manual',
 * which wins over a Petrolimex import at the same time; DELETE {at} removes a
 * typed one (imports are never deleted from here — type over them instead).
 */
import { NextRequest, NextResponse } from "next/server";
import { sbDelete, sbUpsert, supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

async function body(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { at?: unknown; price?: unknown } | null;
  return { at: typeof b?.at === "string" && AT.test(b.at) ? b.at : null, price: typeof b?.price === "number" ? b.price : NaN };
}

export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  const { at, price } = await body(req);
  if (!at || !Number.isInteger(price) || price <= 0 || price >= 100_000) {
    return NextResponse.json({ error: "Cần thời điểm và giá (đ/lít) hợp lệ" }, { status: 400 });
  }
  await sbUpsert("gas_prices", [{ at, price, source: "manual", updated_at: new Date().toISOString() }], "at,source");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  const { at } = await body(req);
  if (!at) return NextResponse.json({ error: "Cần thời điểm" }, { status: 400 });
  await sbDelete("gas_prices", `at=eq.${at}:00&source=eq.manual`);
  return NextResponse.json({ ok: true });
}
