import { NextRequest, NextResponse } from "next/server";
import { clientBotGroups, clientBots, clientBotToken, LEGACY_BOTS, requestKeywords } from "@/lib/client-bots";
import { masterChoices } from "@/lib/master-choices";
import { sbDelete, sbPatch, sbUpsert } from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// ── /api/client-bots — Master Setup → "Bot khách hàng" ──────────────────────
// GET: the bots (never their tokens), every client group, the shared request
//      keywords and the client list to pick from.
// POST: save one group ({bot, chat_id, customer_id, label, remind, cancel, request,
//       guide, guide_time, previous?}); `previous` = the {bot, chat_id} it was loaded
//       as, so a moved group drops its old line.
// PUT: {keywords: string[]} — the one list every group's trip request matches.
// DELETE: {bot, chat_id}. Bots themselves: /api/client-bots/bot.

export async function GET() {
  try {
    const [rows, groups, keywords, { locations }] = await Promise.all([clientBots(), clientBotGroups(), requestKeywords(), masterChoices()]);
    const bots = rows.map(b => ({ id: b.id, name: b.name, legacy: LEGACY_BOTS.includes(b.id), configured: Boolean(clientBotToken(b)) }));
    return NextResponse.json({ bots, groups, keywords, clients: locations }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

const key = (v: unknown) => {
  const k = v as { bot?: unknown; chat_id?: unknown } | null;
  const chat = typeof k?.chat_id === "string" ? k.chat_id.trim() : "";
  return typeof k?.bot === "string" && k.bot && chat ? { bot: k.bot, chat_id: chat } : null;
};
const filterOf = (k: { bot: string; chat_id: string }) => `bot=eq.${encodeURIComponent(k.bot)}&chat_id=eq.${encodeURIComponent(k.chat_id)}`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const k = key(body);
  if (!k) return NextResponse.json({ error: "Thiếu bot hoặc Chat ID" }, { status: 400 });
  const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
  const guideTime = typeof body.guide_time === "string" ? body.guide_time.trim() : "07:30";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(guideTime)) return NextResponse.json({ error: "Giờ gửi hướng dẫn không hợp lệ" }, { status: 400 });
  try {
    const [bots, { locations }] = await Promise.all([clientBots(), masterChoices()]);
    if (!bots.some(b => b.id === k.bot)) return NextResponse.json({ error: "Không tìm thấy bot" }, { status: 400 });
    if (!locations.some(l => l.id === customerId)) return NextResponse.json({ error: "Khách hàng không có trong danh sách" }, { status: 400 });
    await sbUpsert("client_bot_groups", [{
      ...k, customer_id: customerId,
      label: typeof body.label === "string" ? body.label.trim() : "",
      remind: body.remind === true, cancel: body.cancel === true,
      request: body.request === true, guide: body.guide === true, guide_time: guideTime,
      updated_at: new Date().toISOString(),
    }], "bot,chat_id");
    const prev = key(body.previous);
    if (prev && (prev.bot !== k.bot || prev.chat_id !== k.chat_id)) await sbDelete("client_bot_groups", filterOf(prev));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const keywords = Array.isArray(body?.keywords)
    ? [...new Set(body.keywords.filter((s: unknown): s is string => typeof s === "string").map((s: string) => s.trim()).filter(Boolean))] as string[]
    : null;
  if (!keywords?.length) return NextResponse.json({ error: "Cần ít nhất một từ khoá" }, { status: 400 });
  try {
    await sbPatch("client_bot_settings", "id=eq.1", { request_keywords: keywords });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const k = key(await req.json().catch(() => null));
  if (!k) return NextResponse.json({ error: "Thiếu bot hoặc Chat ID" }, { status: 400 });
  try {
    await sbDelete("client_bot_groups", filterOf(k));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
