import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

/**
 * "Cần tạo config" — the to-dos, gaps and overlaps of the current config parse.
 *
 * Fetched when the Config tab opens and after a config save, NOT on the 90-second
 * status poll: the lists are ~150 KB, change only on a re-parse, and are looked at
 * about once a week.
 */
export async function GET() {
  const config = await loadConfig();
  if (!config) return NextResponse.json({ error: "config unavailable" }, { status: 503 });
  return NextResponse.json({
    unfinished: config.unfinished, gaps: config.gaps, overlaps: config.overlaps,
    branchRules: config.branchRules, parsedAt: config.parsedAt,
  });
}
