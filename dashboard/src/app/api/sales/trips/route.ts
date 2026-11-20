import { NextRequest, NextResponse } from "next/server";
import { DELIVERY_BASE, labcenterFetch } from "@/lib/labcenter";
import { repClients, salesUser } from "@/lib/sales-session";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// Labcenter's own UTC format; a bare "+" in a query string reads as a space.
const lcTime = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "+00:00";

// GET /api/sales/trips — the signed-in rep's trips that can still be cancelled
// (Labcenter "open" / "assigned", Cartrack-owned), created in the last 48 h.
// Read on demand when the Huỷ tab opens: one delivery-admin call filtered by status
// server-side (~50 KB, where the unfiltered day is ~500 KB), then one Supabase read
// of who owns those client codes (master clients, synced from Labcenter each morning).
export async function GET(req: NextRequest) {
  const user = salesUser(req);
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const now = Date.now();
  const qs = new URLSearchParams({
    from_created_at: lcTime(now - 48 * 3600_000),
    to_created_at: lcTime(now + 3600_000),
    page: "1",
    perPage: "500",
  });
  qs.append("status[]", "open");
  qs.append("status[]", "assigned");

  try {
    const res = await labcenterFetch(`${DELIVERY_BASE}/api/delivery-requests?${qs}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Labcenter delivery-requests ${res.status}`);
    type Row = {
      code: string; status: string; delivery_integration_code: string | null;
      from_client_code: string | null; from_name: string | null; to_name: string | null;
      created_at: string | null; expected_delivery_at: string | null;
    };
    const rows = (((await res.json())?.data ?? []) as Row[])
      .filter((r) => r.delivery_integration_code === "cartrack_vn" && r.from_client_code);

    const codes = [...new Set(rows.map((r) => r.from_client_code!))];
    const owned = new Set(
      codes.length ? (await repClients(user.email, `client_code=in.(${codes.map(encodeURIComponent).join(",")})`)).map((c) => c.client_code) : [],
    );

    const trips = rows
      .filter((r) => owned.has(r.from_client_code!))
      .map((r) => ({
        code: r.code,
        status: r.status,
        from_name: r.from_name,
        to_name: r.to_name,
        created_at: r.created_at,
        expected_delivery_at: r.expected_delivery_at,
      }))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    return NextResponse.json({ trips });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
