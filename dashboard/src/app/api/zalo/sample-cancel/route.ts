import { NextRequest, NextResponse } from "next/server";
import { handleClientBotUpdate } from "@/lib/client-bot-actions";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// Bot Giao nhận mẫu's webhook — registered before bots were managed from the
// dashboard, so it keeps its env secret. What it does per group: client-bot-actions.
export async function POST(req: NextRequest) {
  const secret = process.env.ZALO_SAMPLE_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  await handleClientBotUpdate("giao_nhan_mau", await req.json().catch(() => null));
  return NextResponse.json({ ok: true });
}
