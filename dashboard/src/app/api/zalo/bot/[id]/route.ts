import { NextRequest, NextResponse } from "next/server";
import { clientBots, LEGACY_BOTS } from "@/lib/client-bots";
import { handleClientBotUpdate } from "@/lib/client-bot-actions";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// POST /api/zalo/bot/<id> — the webhook "Bot khách hàng" registers for every bot added
// from the dashboard, with the secret set at registration.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (LEGACY_BOTS.includes(id)) return NextResponse.json({ ok: false }, { status: 404 });
  let secret: string | null | undefined;
  try {
    secret = (await clientBots()).find(b => b.id === id)?.webhook_secret;
  } catch (e) {
    // 200 so Zalo does not retry into an outage; the message is simply not handled.
    console.error(`[client-bot] ${id}: bots unreadable`, e);
    return NextResponse.json({ ok: true });
  }
  // Registered with both (secret_token and ?key=): which one Zalo sends is not documented.
  const presented = req.headers.get("x-bot-api-secret-token") ?? req.nextUrl.searchParams.get("key");
  if (!secret || presented !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  await handleClientBotUpdate(id, await req.json().catch(() => null));
  return NextResponse.json({ ok: true });
}
