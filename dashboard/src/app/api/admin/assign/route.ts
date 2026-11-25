import { NextRequest, NextResponse } from "next/server";
import { assignJob, getJobDetailsFast, type Env } from "@/lib/cartrack";
import { JOB_STATUS } from "@/lib/job-filters";
import { loadDrivers } from "@/lib/config";
import { pushRunLog } from "@/lib/smart-log-kv";
import { vnTimestamp } from "@/lib/time";

/**
 * POST /api/admin/assign
 * Manually assign a failed job to a driver.
 * Body: { job_id: number, driver_id: string, env?: "prod" | "uat" }
 *
 * The job is re-read live first: the Cần xử lý row the button sat on can be minutes
 * old, and the RPC assign puts a cancelled job straight back on a driver's route
 * (job 34509625, 27/10: cancelled 15:22, assigned from here 15:24, driver sent to a
 * client who had called it off).
 */
export async function POST(req: NextRequest) {
  try {
    const reqBody = await req.json();
    const { job_id, driver_id, env = "prod", by = "" } = reqBody as {
      job_id?: number;
      driver_id?: string;
      env?: Env;
      by?: string;
    };

    if (!job_id || !driver_id) {
      return NextResponse.json(
        { error: "job_id và driver_id là bắt buộc" },
        { status: 400 }
      );
    }

    const job = (await getJobDetailsFast(job_id, env).catch(() => null))?.data;
    if (!job?.job_id) {
      return NextResponse.json({ error: "Không đọc được chuyến từ Cartrack, vui lòng thử lại" }, { status: 502 });
    }
    if ([3, 5, 7].includes(job.job_status_id)) {
      return NextResponse.json(
        { error: `Chuyến ${JOB_STATUS[job.job_status_id].toLowerCase()} — không thể gán` },
        { status: 409 }
      );
    }

    const { status, body } = await assignJob(driver_id, job_id, env);

    if (status !== 200) {
      return NextResponse.json(
        {
          error: `Không thể gán job. Trạng thái: ${status}`,
          details: body,
        },
        { status }
      );
    }

    // Cartrack records this exactly like an engine assign (an API call, no name), so
    // without this line a hand-assign is indistinguishable from the engine's
    // (job 34544397, 25/11: no way to tell who gave it to Minh Trung).
    if (env === "prod") {
      const driverName = (await loadDrivers().catch(() => [])).find((d) => d.driver_id === driver_id)?.name ?? driver_id;
      const stop = (t: number) => job.stops?.find((s: { stop_type_id?: number }) => s.stop_type_id === t)?.customer_name ?? "—";
      const who = String(by).trim().slice(0, 60) || "?";
      await pushRunLog([{
        ts: vnTimestamp(),
        level: "OK",
        msg: `Job ${job_id} - Gán thủ công cho ${driverName} (bởi ${who}) | ${stop(1)} → ${stop(2)}`,
      }]).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: `Job ${job_id} đã gán cho tài xế ${driver_id}`,
      job_id,
      driver_id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
