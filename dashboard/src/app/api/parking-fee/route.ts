/**
 * Tiền gửi xe — /cham-cong's "Gửi Xe" tab. Driver id from the signed nv_session
 * cookie ONLY. Rules in lib/parking-fee.ts.
 *
 * Filed per PERSON: someone holding both a DC and a PT account files under the
 * DC one, and the trips of both count as visits (personAccounts).
 *
 * GET ?month=YYYY-MM → open payroll months, the places (master_clients with a
 *   parking fee), the person's visits per place in that period, and their
 *   current declaration.
 * POST {month, lines} → re-checks every line against the visits (never the
 *   browser's numbers) and refuses the whole submission while any line is
 *   invalid; otherwise stores it, withdrawing the previous pending declaration
 *   for that month.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySession, NV_COOKIE } from "@/lib/driver-session";
import { sbInsert, sbPatch, sbSelect, sbSelectAll, supabaseConfigured } from "@/lib/supabase-rest";
import { badLines, checkLines, countVisits, toPlaces, openPayMonths, payrollPeriod,
  type ClientRow, type ParkingLineInput, type ParkingPlace } from "@/lib/parking-fee";
import { personAccounts } from "@/lib/pay-days";
import { vnDate } from "@/lib/time";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

const EXPIRED = { ok: false, expired: true, error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." };
const TABLE = "parking_fee_declarations";

async function placesAndVisits(driverIds: string[], month: string) {
  const rows = await sbSelectAll<ClientRow>("master_clients",
    "select=customer_id,customer_name,address_line_1,parking_fee_vnd&parking_fee_vnd=not.is.null&is_active=eq.true",
    "customer_id.asc");
  const places = toPlaces(rows);
  const { from, to } = payrollPeriod(month);
  const ids = places.map((p) => p.id);
  const legs = ids.length === 0 ? [] : await sbSelectAll<{ from_customer_id: string | null; to_customer_id: string | null }>("tat_legs",
    `select=from_customer_id,to_customer_id&driver_id=in.(${driverIds.join(",")})` +
    `&trip_date=gte.${from}&trip_date=lte.${to}&to_customer_id=in.(${ids.join(",")})`, "id.asc");
  return { places, visits: countVisits(legs), period: { from, to } };
}

function pickMonth(raw: unknown, today: string): string | null {
  const open = openPayMonths(today);
  if (raw == null || raw === "") return open[0];
  return typeof raw === "string" && open.includes(raw) ? raw : null;
}

export async function GET(req: NextRequest) {
  const s = verifySession(req.cookies.get(NV_COOKIE)?.value);
  if (!s) return NextResponse.json(EXPIRED, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ ok: false, error: "Hệ thống lưu trữ chưa được cấu hình." }, { status: 503 });
  const today = vnDate();
  const month = pickMonth(req.nextUrl.searchParams.get("month"), today);
  if (!month) return NextResponse.json({ ok: false, error: "Kỳ lương này đã đóng." }, { status: 400 });
  try {
    const who = await personAccounts(s);
    const [{ places, visits, period }, current] = await Promise.all([
      placesAndVisits(who.ids, month),
      sbSelect(TABLE, `select=id,lines,claimed_vnd,status,created_at&driver_id=eq.${encodeURIComponent(who.owner.driver_id)}` +
        `&pay_month=eq.${month}&status=neq.withdrawn&order=id.desc&limit=1`),
    ]);
    return NextResponse.json({
      ok: true, month, months: openPayMonths(today), period,
      places, visits: Object.fromEntries(visits), current: current[0] ?? null,
    });
  } catch (e) {
    console.error("[parking-fee] read:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Không tải được dữ liệu. Thử lại sau." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const s = verifySession(req.cookies.get(NV_COOKIE)?.value);
  if (!s) return NextResponse.json(EXPIRED, { status: 401 });
  if (!supabaseConfigured()) return NextResponse.json({ ok: false, error: "Hệ thống lưu trữ chưa được cấu hình." }, { status: 503 });
  const body = await req.json().catch(() => null) as { month?: unknown; lines?: unknown } | null;
  const month = pickMonth(body?.month, vnDate());
  if (!month) return NextResponse.json({ ok: false, error: "Kỳ lương này đã đóng." }, { status: 400 });

  try {
    const who = await personAccounts(s);
    const { places, visits } = await placesAndVisits(who.ids, month);
    const byId = new Map<string, ParkingPlace>(places.map((p) => [p.id, p]));
    const bad = badLines(body?.lines, byId);
    if (bad) return NextResponse.json({ ok: false, error: bad }, { status: 400 });
    const check = checkLines(body!.lines as ParkingLineInput[], byId, visits);
    if (!check.valid) {
      return NextResponse.json({ ok: false, check, error: "Có điểm không hợp lệ. Vui lòng kiểm tra lại." }, { status: 400 });
    }

    await sbPatch(TABLE, `driver_id=eq.${encodeURIComponent(who.owner.driver_id)}&pay_month=eq.${month}&status=eq.pending`, { status: "withdrawn" });
    await sbInsert(TABLE, [{
      driver_id: who.owner.driver_id, driver_name: who.owner.driver_name, pay_month: month,
      lines: check.lines, claimed_vnd: check.claimed_vnd, allowed_vnd: check.claimed_vnd, exceeds: false,
    }]);
    return NextResponse.json({ ok: true, check });
  } catch (e) {
    console.error("[parking-fee] write:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Không gửi được. Thử lại sau." }, { status: 502 });
  }
}
