import { resolveConfigDay } from "@/lib/config-day";
import { NextRequest, NextResponse } from "next/server";
import { editMasterConfig, weekdayOnly } from "@/lib/master-config-actions";
import { parseConfigRowSnapshot } from "@/lib/config-row-match";
import { invalidateConfigCache } from "@/lib/config";
import { timeToMins } from "@/lib/time";

/**
 * Close an uncovered hour by moving one end of a neighbouring rule.
 *
 * Only ONE end moves. The gap sits between two rules and either could close it;
 * writing both would leave them overlapping, which is the fault this system
 * already reports, so the choice stays with the person who knows who is working.
 *
 * Invalidates the config afterwards: the moment it lands it is a live rule, and
 * making someone press Refresh would leave the branch failing meanwhile.
 */
export async function POST(req: NextRequest) {
  const bad = (msg: string, code = 400) => NextResponse.json({ ok: false, error: msg }, { status: code });
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Body không hợp lệ");
    const configDay = resolveConfigDay(body.config_day);
    const { pickup_name, edge, value, expected_row } = body as {
      pickup_name?: string; edge?: string; value?: string; expected_row?: unknown;
    };

    if (!pickup_name?.trim()) return bad("Thiếu tên điểm lấy mẫu");
    const expected = parseConfigRowSnapshot(expected_row);
    if (!expected) return bad("Thiếu mã quy tắc — tải lại");
    if (edge !== "start" && edge !== "end") return bad("Chỉ sửa được giờ bắt đầu hoặc giờ kết thúc");
    const v = (value ?? "").trim();
    if (timeToMins(v) < 0) return bad(`Giờ không hợp lệ: ${v || "(trống)"}`);

    weekdayOnly(configDay);
    const result = await editMasterConfig({ expectPickup: pickup_name, expected }, { [edge]: v });
    await invalidateConfigCache();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // A changed rule or a Sunday attempt is the caller's to resolve, not a fault.
    return bad(e instanceof Error ? e.message : String(e), 409);
  }
}
