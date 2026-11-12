import { NextRequest, NextResponse } from "next/server";
import { sbSelectAll, sbUpsert } from "@/lib/supabase-rest";
import { sharedRedis } from "@/lib/redis";
import { MORNING_RUN_KEY, morningRunFailure } from "@/lib/morning-sync-trigger";

type Finding = { customer_id: string; kind: string; detail: string };
const key = (f: Finding) => `${f.customer_id}|${f.kind}|${f.detail}`;

// The dashboard asks this on every page open. It lives apart from /api/misa-sync (and
// outside its folder, which next.config bundles with Chromium) on
// purpose: that route pulls in the whole sync (config, Cartrack, Labcenter) and is
// pinned to its own region, so each call started a cold copy of all of it — ~0.7s of
// CPU to read a table that is usually empty. This one loads only the Supabase and Redis
// helpers (one GET for the run's status).
export async function GET() {
  // A failed run (MISA leave not written) belongs on the dashboard, not only in Redis.
  const run = sharedRedis()?.get<Parameters<typeof morningRunFailure>[0]>(MORNING_RUN_KEY).catch(() => null) ?? null;
  const [all, ignores] = await Promise.all([
    sbSelectAll<Finding & { client_code: string; name: string; created_at: string }>(
      "master_sync_issues", "select=client_code,customer_id,name,kind,detail,created_at", "client_code.asc,customer_id.asc,id.asc"),
    sbSelectAll<Finding>("master_sync_issue_ignores", "select=customer_id,kind,detail", "customer_id.asc,kind.asc,detail.asc"),
  ]);
  // An ignored finding stays hidden every morning until its wording changes.
  const ignored = new Set(ignores.map(key));
  const rows = all.filter((r) => !ignored.has(key(r)));
  return NextResponse.json({ sync_failure: morningRunFailure(await run), issues: rows, checked_at: all.reduce((a, r) => (r.created_at > a ? r.created_at : a), "") || null });
}

// "Bỏ qua" on one finding.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || ![b.customer_id, b.kind, b.detail].every((v) => typeof v === "string" && v && v.length <= 500))
    return NextResponse.json({ error: "Thiếu mục cần bỏ qua" }, { status: 400 });
  await sbUpsert("master_sync_issue_ignores", [{ customer_id: b.customer_id, kind: b.kind, detail: b.detail }], "customer_id,kind,detail");
  return NextResponse.json({ ok: true });
}
