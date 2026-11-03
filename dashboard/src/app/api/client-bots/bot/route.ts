import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { clientBotGroups, clientBots, LEGACY_BOTS } from "@/lib/client-bots";
import { sbDelete, sbInsert, sbPatch } from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// ── /api/client-bots/bot — add / rename / re-token / remove a client bot ─────
// POST {id?, name, token?}: a token (required for a new bot) is checked with Zalo's
//   getMe, then the bot's webhook is pointed at /api/zalo/bot/<id> with a fresh secret.
// DELETE {id}: only a bot with no groups left. The two legacy bots are rename-only.

// The movable production address, not SELF_URL: a webhook must survive the domain
// moving between Vercel accounts, which is exactly what this address is for.
const WEBHOOK_BASE = "https://diag-logistics.vercel.app";

async function zalo(token: string, method: string, body: object = {}): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok && out?.ok === true, description: out?.description ?? (res.ok ? undefined : `HTTP ${res.status}`) };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/^@/, "") : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const existingId = typeof body?.id === "string" ? body.id : "";
  if (!name) return NextResponse.json({ error: "Thiếu tên bot" }, { status: 400 });
  if (!existingId && !token) return NextResponse.json({ error: "Bot mới cần token" }, { status: 400 });
  if (LEGACY_BOTS.includes(existingId) && token) {
    return NextResponse.json({ error: "Bot này dùng token cấu hình sẵn — chỉ đổi được tên" }, { status: 400 });
  }
  try {
    const bots = await clientBots();
    if (existingId && !bots.some(b => b.id === existingId)) return NextResponse.json({ error: "Không tìm thấy bot" }, { status: 404 });
    const id = existingId || `bot_${randomUUID().slice(0, 8)}`;
    const values: Record<string, unknown> = { name };
    if (token) {
      const me = await zalo(token, "getMe");
      if (!me.ok) return NextResponse.json({ error: `Zalo không nhận token này (${me.description ?? "getMe lỗi"})` }, { status: 400 });
      const secret = randomBytes(24).toString("hex");
      const hook = await zalo(token, "setWebhook", { url: `${WEBHOOK_BASE}/api/zalo/bot/${id}?key=${secret}`, secret_token: secret });
      if (!hook.ok) return NextResponse.json({ error: `Không đăng ký được webhook (${hook.description ?? "setWebhook lỗi"})` }, { status: 502 });
      Object.assign(values, { token, webhook_secret: secret });
    }
    if (existingId) await sbPatch("client_bots", `id=eq.${encodeURIComponent(id)}`, values);
    else await sbInsert("client_bots", [{ id, ...values }]);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || LEGACY_BOTS.includes(id)) return NextResponse.json({ error: "Không xoá được bot này" }, { status: 400 });
  try {
    if ((await clientBotGroups()).some(g => g.bot === id)) {
      return NextResponse.json({ error: "Bot vẫn còn ở nhóm khách hàng — xoá các nhóm trước" }, { status: 409 });
    }
    const bot = (await clientBots()).find(b => b.id === id);
    if (bot?.token) await zalo(bot.token, "deleteWebhook").catch(() => {}); // best effort: the route 401s it anyway
    await sbDelete("client_bots", `id=eq.${encodeURIComponent(id)}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
