import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { handleClientBotUpdate } from "@/lib/client-bot-actions";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// Bot Trợ Lý Diag (An Sinh) — registered before bots were managed from the dashboard.
// Its webhook secret is derived from the token (sha256 hex, first 32), so the bot needs
// one env var, ZALO_ANSINH_BOT_TOKEN. What it does per group: client-bot-actions.
export async function POST(req: NextRequest) {
  const token = process.env.ZALO_ANSINH_BOT_TOKEN;
  const secret = token && createHash("sha256").update(token).digest("hex").slice(0, 32);
  if (!secret || req.headers.get("x-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  await handleClientBotUpdate("an_sinh", await req.json().catch(() => null));
  return NextResponse.json({ ok: true });
}
