import { NextRequest, NextResponse } from "next/server";
import { PROXY_DRIVER_ID, getJobsByStatusAndDate } from "@/lib/cartrack";
import { isSalesCancellable } from "@/lib/job-filters";
import { repClients, salesUser } from "@/lib/sales-session";
import { vnDate } from "@/lib/time";
import { codeLabel } from "@/lib/place-label";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// GET /api/sales/trips — the signed-in rep's trips that can still be cancelled, from
// Cartrack: today's unassigned + assigned jobs (by scheduled_delivery_ts, footgun 2)
// a rep may cancel (isSalesCancellable: client requests only, nothing started) whose
// PICKUP is one of the rep's clients (master_clients_read owner; every client for a
// SALES_ADMINS address). Read on demand
// when the Huỷ tab opens — two Cartrack pages (~300 KB) and one Supabase read.
export async function GET(req: NextRequest) {
  const user = salesUser(req);
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const today = vnDate();
    const [unassigned, assigned, mine] = await Promise.all([
      getJobsByStatusAndDate(2, today),
      getJobsByStatusAndDate(4, today),
      repClients(user.email, "client_code=not.is.null", "customer_id,client_code"),
    ]);
    const owned = new Set(mine.map((c) => c.customer_id));

    const trips = [...unassigned, ...assigned]
      .filter(isSalesCancellable)
      .flatMap((j) => {
        const pickup = j.stops?.find((s) => s.stop_type_id === 1);
        if (!pickup?.customer_id || !owned.has(pickup.customer_id)) return [];
        return [{
          code: j.reference_number,
          // Parked on the proxy = nobody has it yet.
          status: j.delivery_driver_id && j.delivery_driver_id !== PROXY_DRIVER_ID ? "assigned" : "open",
          from_name: pickup.customer_name ? codeLabel(pickup.customer_name) : null,
          to_name: codeLabel(j.stops?.find((s) => s.stop_type_id === 2)?.customer_name ?? "") || null,
          created_at: j.scheduled_delivery_ts ? `${j.scheduled_delivery_ts.replace(" ", "T")}+07:00` : null,
        }];
      })
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    return NextResponse.json({ trips });
  } catch (e) {
    console.error("[sales/trips]", e);
    return NextResponse.json({ error: "Không tải được danh sách chuyến, bấm Tải lại." }, { status: 502 });
  }
}
