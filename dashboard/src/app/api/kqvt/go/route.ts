/**
 * "Cần xử lý" → KQ/VT chờ giao quá 24h → "Giao ngay": stop waiting for a visit to the
 * client and send the items on their own, exactly as the client's "no samples" reply
 * does (lib/kqvt.ts kqvtGoDirect, for one item). Not collected → convertToDirect
 * (PSC → client, the client's driver); collected → deliverFromHolder (a job at the
 * client for the driver holding them).
 */
import { NextRequest, NextResponse } from "next/server";
import { convertToDirect, deliverFromHolder, loadPending } from "@/lib/kqvt";
import { acquireCreateLock, pushRunLog } from "@/lib/smart-log-kv";
import { vnTimestamp } from "@/lib/time";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const jobId = Number((await req.json().catch(() => null))?.job_id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "KQ/VT này chưa có job (đang đi kèm chuyến về) — chưa giao ngay được." }, { status: 400 });
  }
  // A double click would make two delivery jobs.
  if (!(await acquireCreateLock(`kqvt-direct:${jobId}`).catch(() => false))) {
    return NextResponse.json({ error: "Đang xử lý job này, đợi một lát." }, { status: 409 });
  }
  try {
    const e = (await loadPending()).find((x) => x.job_id === jobId);
    if (!e) return NextResponse.json({ error: "KQ/VT này không còn trong danh sách chờ." }, { status: 404 });
    if (e.direct) return NextResponse.json({ error: "Đã là chuyến giao tận nơi — kiểm tra tài xế trên Cartrack." }, { status: 409 });
    let line: string, newJob: number | null = null;
    if (e.holder) {
      line = await deliverFromHolder(e, "prod", "điều phối bấm giao ngay");
      if (!line.startsWith("Job")) return NextResponse.json({ error: line }, { status: 502 });
      newJob = Number(/^Job (\d+)/.exec(line)?.[1]) || null;
    } else {
      const r = await convertToDirect(jobId, "prod");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      newJob = r.jobId;
      line = `Job ${jobId} → Job ${r.jobId} - KQ/VT giao ngay tận nơi | ${r.client}`;
    }
    await pushRunLog([{ ts: vnTimestamp(), level: "INFO", msg: line }]).catch(() => {});
    return NextResponse.json({ ok: true, new_job_id: newJob });
  } catch (x) {
    return NextResponse.json({ error: String(x).slice(0, 200) }, { status: 502 });
  }
}
