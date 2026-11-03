import { NextResponse } from "next/server";
import { sbSelectAll } from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

/**
 * Every driver account in master_drivers, flattened for the dashboard's Tài xế
 * tab and its CSV export. On demand only — the tab fetches it when opened.
 *
 * Login tokens and the Zalo bot token are never selected: this answers "who are
 * our drivers", and the dashboard has no auth of its own (same posture as
 * /api/pay/team).
 */
type Row = {
  driver_id: string; first_name: string | null; last_name: string | null; is_active: boolean | null;
  email: string | null; phone_code: string | null; phone_number: string | null; phone_number_update: string | null;
  shift_time_start: string | null; shift_time_end: string | null;
  start_location_customer_id: string | null; end_location_customer_id: string | null;
  driver_zalo_id: string | null; registration: string | null; device_description: string | null; device_os: string | null;
  last_login_ts: string | null; create_ts: string | null; roster: Record<string, string> | null;
};

const hhmm = (t: string | null) => (t ?? "").slice(0, 5);

export async function GET() {
  try {
    const [drivers, clients] = await Promise.all([
      sbSelectAll<Row>("master_drivers",
        "select=driver_id,first_name,last_name,is_active,email,phone_code,phone_number,phone_number_update,shift_time_start,shift_time_end,start_location_customer_id,end_location_customer_id,driver_zalo_id,registration,device_description,device_os,last_login_ts,create_ts,roster",
        "driver_id.asc"),
      sbSelectAll<{ customer_id: string; customer_name: string | null }>("master_clients", "select=customer_id,customer_name", "customer_id.asc"),
    ]);
    const place = new Map(clients.map((c) => [c.customer_id, c.customer_name ?? ""]));
    const rows = drivers.map((d) => {
      const cartrackName = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
      const code = d.roster?.employee_code || cartrackName.match(/\b(DC|PT)\d{3,}\b/)?.[0] || "";
      return {
        driver_id: d.driver_id,
        employee_code: code,
        type: code.startsWith("PT") ? "PT" : code.startsWith("DC") ? "FT" : "",
        full_name: d.roster?.employee_full_name || d.last_name || "",
        cartrack_name: cartrackName,
        is_active: d.is_active !== false,
        phone: d.phone_number ? `${d.phone_code ? `+${d.phone_code} ` : ""}${d.phone_number}` : "",
        phone_update: d.phone_number_update ?? "",
        email: d.email ?? "",
        shift: d.shift_time_start || d.shift_time_end ? `${hhmm(d.shift_time_start)}–${hhmm(d.shift_time_end)}` : "",
        start_location: d.start_location_customer_id ? place.get(d.start_location_customer_id) || d.start_location_customer_id : "",
        end_location: d.end_location_customer_id ? place.get(d.end_location_customer_id) || d.end_location_customer_id : "",
        zalo_id: d.driver_zalo_id ?? "",
        registration: d.registration ?? "",
        device: [d.device_description, d.device_os].filter(Boolean).join(" · "),
        last_login: d.last_login_ts ?? "",
        created: d.create_ts ?? "",
      };
    }).sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.employee_code.localeCompare(b.employee_code) || a.full_name.localeCompare(b.full_name, "vi"));
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
