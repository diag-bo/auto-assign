/**
 * POST /api/admin/kqvt-direct?env= { job_id } — the Điều chỉnh panel's "Đổi thành giao
 * tận nơi": a one-stop KQ/VT collect job becomes PSC → client (lib/kqvt.ts convertToDirect).
 */
import { NextRequest, NextResponse } from "next/server";
import type { Env } from "@/lib/cartrack";
import { convertToDirect } from "@/lib/kqvt";
import { acquireCreateLock, pushRunLog } from "@/lib/smart-log-kv";
import { vnTimestamp } from "@/lib/time";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const env = (req.nextUrl.searchParams.get("env") ?? "prod") as Env;
  const jobId = Number((await req.json().catch(() => null))?.job_id);
  if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Job ID không hợp lệ" }, { status: 400 });
  // A double click would make two direct jobs before the first cancel lands.
  if (!(await acquireCreateLock(`kqvt-direct:${jobId}`).catch(() => false))) {
    return NextResponse.json({ error: "Đang đổi job này, đợi một lát." }, { status: 409 });
  }
  try {
    const r = await convertToDirect(jobId, env);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await pushRunLog([{ ts: vnTimestamp(), level: "INFO", msg: `Job ${jobId} → Job ${r.jobId} - KQ/VT đổi thành giao tận nơi | ${r.client}` }]).catch(() => {});
    return NextResponse.json({ ok: true, new_job_id: r.jobId });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
