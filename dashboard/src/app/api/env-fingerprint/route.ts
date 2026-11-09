import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** GET ?keys=A,B — what THIS deployment is running with, as fingerprints the env sync
 *  compares across the Vercel accounts (.github/scripts/vercel-env-sync.mjs). A value
 *  Vercel marks "sensitive" can't be read back from any account, so this is the only
 *  way to see that two accounts hold the same one. Never a value: HMAC keyed with
 *  CRON_SECRET, cut to 16 hex; null = not set here. CRON_SECRET only. */
export function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const keys = (req.nextUrl.searchParams.get("keys") ?? "").split(",").filter(Boolean).slice(0, 300);
  const fingerprints = Object.fromEntries(keys.map((k) => {
    const v = process.env[k];
    return [k, v === undefined ? null : createHmac("sha256", secret).update(v).digest("hex").slice(0, 16)];
  }));
  return NextResponse.json({ fingerprints }, { headers: { "Cache-Control": "no-store" } });
}
