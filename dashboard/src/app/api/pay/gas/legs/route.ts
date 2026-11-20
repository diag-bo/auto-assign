/**
 * The "Trip Details" sheet of the Phụ cấp xăng export: TAT legs of full-time and
 * part-time accounts, at most 7 days per call. The browser builds the workbook
 * from several of these, because a whole month (~29k legs) is a 7–8 MB file and a
 * Vercel response stops at 4.5 MB. Columns are tat_legs' own, in its order, with
 * `driver_name` filled in and timestamps as VN wall clock.
 */
import { NextRequest, NextResponse } from "next/server";
import { sbSelect, sbSelectAll, supabaseConfigured } from "@/lib/supabase-rest";
import { TRIP_COLUMNS, accountKind } from "@/lib/gas-allowance";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "sin1";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TS_COLUMNS = new Set(["departed_ts", "arrived_ts", "archived_at", "available_at"]);
/** timestamptz → "YYYY-MM-DDTHH:MM:SS" in VN time, the way the sheet has always shown it. */
const vnWall = (v: unknown) => typeof v === "string" ? new Date(Date.parse(v) + 7 * 3_600_000).toISOString().slice(0, 19) : v;

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase chưa cấu hình" }, { status: 503 });
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || to < from || Date.parse(to) - Date.parse(from) > 6 * 86_400_000) {
    return NextResponse.json({ error: "from/to phải là YYYY-MM-DD, tối đa 7 ngày" }, { status: 400 });
  }
  const [legs, drivers] = await Promise.all([
    sbSelectAll<Record<string, unknown>>("tat_legs", `select=*&trip_date=gte.${from}&trip_date=lte.${to}`, "id"),
    sbSelect<{ driver_id: string; first_name: string | null; last_name: string | null }>("master_drivers", "select=driver_id,first_name,last_name"),
  ]);
  const name = new Map(drivers.map((d) => [d.driver_id, `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim()]));
  const rows = legs.flatMap((l) => {
    const driverName = name.get(String(l.driver_id)) ?? "";
    if (!accountKind(driverName)) return [];
    return [TRIP_COLUMNS.map((c) => c === "driver_name" ? driverName : TS_COLUMNS.has(c) ? vnWall(l[c]) : l[c] ?? null)];
  });
  return NextResponse.json({ columns: TRIP_COLUMNS, rows });
}
