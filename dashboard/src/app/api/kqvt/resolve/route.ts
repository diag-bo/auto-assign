/**
 * "Cần xử lý" → KQ/VT chờ giao quá 24h → "Đã xử lý": the dispatcher has dealt with a
 * waiting Kết quả / Vật tư item by hand, so it leaves the waiting list (lib/kqvt.ts).
 * The warning and the hand-over attempts stop, and its Cartrack job is cancelled
 * (supervisor, 2026-11-19) — unless a driver has started it or it is already over, which
 * the answer says. A cancel Cartrack refuses keeps the item listed, to try again.
 */
import { NextRequest, NextResponse } from "next/server";
import { closeItems, dropPending, loadPending } from "@/lib/kqvt";
import { cancelJobFromTimeline, getJobDetails, jobVnDate } from "@/lib/cartrack";
import { pushRunLog } from "@/lib/smart-log-kv";
import { vnTimestamp } from "@/lib/time";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

export async function POST(req: NextRequest) {
  const jobId = Number((await req.json().catch(() => null))?.job_id);
  // Negative = a multi-leg item still travelling, with no job yet (lib/kqvt.ts).
  if (!Number.isInteger(jobId) || jobId === 0) {
    return NextResponse.json({ error: "Job không hợp lệ" }, { status: 400 });
  }
  try {
    const entry = (await loadPending()).find((e) => e.job_id === jobId);
    // Cancel first: a refused cancel must leave the item on the list.
    let cartrack: "cancelled" | "started" | "over" | "none" = "none";
    // Only a job on the waiting list: this route never cancels an arbitrary job id.
    if (jobId > 0 && entry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job: any = (await getJobDetails(jobId, "prod").catch(() => null))?.data;
      if (!job) cartrack = "over"; // deleted, or unreadable: nothing to cancel we can see
      else if ([5, 7].includes(job.job_status_id)) cartrack = "over";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else if ((job.stops ?? []).some((s: any) => s.stop_status_id !== 1)) cartrack = "started";
      else if (await cancelJobFromTimeline(jobId, jobVnDate(job), "prod").catch(() => false)) cartrack = "cancelled";
      else return NextResponse.json({ error: "Cartrack không huỷ được job — thử lại." }, { status: 502 });
    }
    await dropPending(jobId);
    if (entry) {
      await closeItems(entry, { state: "xong", job: jobId > 0 ? jobId : undefined });
      await pushRunLog([{ ts: vnTimestamp(), level: "INFO", msg: `Job ${jobId} - KQ/VT đánh dấu đã xử lý${cartrack === "cancelled" ? ", đã huỷ job" : ""} | ${entry.psc_name} → ${entry.client_name}` }]).catch(() => {});
    }
    // Already gone (another tab, or the engine dropped it) is still a success.
    return NextResponse.json({ ok: true, found: !!entry, cartrack });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
