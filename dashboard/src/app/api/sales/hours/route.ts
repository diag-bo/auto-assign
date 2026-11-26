import { NextRequest, NextResponse } from "next/server";
import { getAdminToken, listLocationsByClientCode, searchManagedClients } from "@/lib/labcenter";
import { cleanWeekHours, summarizeWeekHours } from "@/lib/location-hours";
import { salesByline, salesUser } from "@/lib/sales-session";
import { sbUpsert } from "@/lib/supabase-rest";
import { notifyAdminGroup } from "@/lib/zalo";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// ── PUT /api/sales/hours — a location's opening hours (Supabase only) ─────────
//
// Neither Labcenter nor Cartrack has a field for opening hours, so they live in
// `location_hours`. Information only: nothing assigns or books on them. Every
// field is optional, and an empty week clears what was there.

export async function PUT(req: NextRequest) {
  const user = salesUser(req);
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const body = await req.json();
    const { client_code, location_id, hours, customer_name } = body as {
      client_code?: string; location_id?: number; hours?: unknown; customer_name?: string;
    };
    const code = client_code?.trim();
    if (!code || typeof location_id !== "number") {
      return NextResponse.json({ error: "Thiếu khách hàng hoặc địa điểm" }, { status: 400 });
    }
    const cleaned = cleanWeekHours(hours);
    if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    // Same ownership rule as the location list: the rep's own client, and a
    // location that really belongs to it.
    const mine = await searchManagedClients(user.email, code).catch(() => []);
    if (!mine.some((c) => c.code === code)) {
      return NextResponse.json({ error: "Khách hàng này không thuộc quản lý của bạn" }, { status: 403 });
    }
    const token = await getAdminToken();
    if (!token) return NextResponse.json({ error: "Labcenter login failed" }, { status: 502 });
    const locations = await listLocationsByClientCode(code, token);
    if (!locations.some((l) => l.id === location_id)) {
      return NextResponse.json({ error: "Địa điểm không thuộc khách hàng này" }, { status: 403 });
    }

    await sbUpsert("location_hours", [{
      lc_location_id: location_id,
      client_code: code,
      hours: cleaned.hours,
      updated_at: new Date().toISOString(),
      updated_by: user.email,
    }], "lc_location_id");

    const summary = summarizeWeekHours(cleaned.hours);
    await notifyAdminGroup(
      `🕒 Sales cập nhật giờ làm việc\n${customer_name?.trim() || `Địa điểm #${location_id}`}\n${summary || "(đã xoá giờ làm việc)"}` + salesByline(req),
    ).catch(() => {});
    return NextResponse.json({ success: true, hours: cleaned.hours, summary });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
