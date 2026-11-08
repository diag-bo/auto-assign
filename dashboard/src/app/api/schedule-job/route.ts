import { NextRequest, NextResponse } from "next/server";
import type { Env } from "@/lib/cartrack";
import { runScheduleJobCycle } from "@/lib/schedule-job";
import { saveLastRun } from "@/lib/schedule-job-kv";
import { getRedis } from "@/lib/tat-archive";
import { vnDate } from "@/lib/time";

export const runtime = "nodejs";
export const preferredRegion = "sin1";
export const maxDuration = 300;

/**
 * POST /api/schedule-job
 *   ?env=prod|uat (default prod)
 *   ?mode=retry — re-runs only ERROR rows from the last saved run
 *
 * Triggered daily by Vercel Cron at 05:00 Asia/Ho_Chi_Minh.
 * Also callable manually from the dashboard.
 */
export async function POST(req: NextRequest) {
  const env = (req.nextUrl.searchParams.get("env") ?? "prod") as Env;
  const mode = req.nextUrl.searchParams.get("mode");
  const isRetry = mode === "retry";

  // Vercel Cron sets this header; we accept either it OR no header (manual call).
  const fromVercelCron = req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  const trigger: "cron" | "manual" | "retry" = isRetry
    ? "retry"
    : fromVercelCron
      ? "cron"
      : "manual";

  // Vercel Cron fires this on EVERY account the project is deployed to, all at
  // 05:00, and the create path's "already exists?" check is not atomic — two at
  // once can both create the same job. The first account in wins the day; the rest
  // stop here. A winner that fails is re-run by morning-recovery (05:05+, locked).
  if (fromVercelCron) {
    const redis = getRedis();
    const won = redis ? await redis.set(`schedule_job:cron:${env}:${vnDate()}`, "1", { nx: true, ex: 172_800 }).catch(() => "OK") : "OK";
    if (won !== "OK") return NextResponse.json({ success: true, trigger, skipped: "already run today by another deployment" });
  }

  // Data refresh piggybacks the existing cron-job.org dispatch run.

  try {
    const { date, weekday, results } = await runScheduleJobCycle(env);

    const record = {
      ts: new Date().toISOString(),
      date,
      weekday,
      trigger,
      results,
    };

    await saveLastRun(record, env);

    const counts = {
      ok: record.results.filter((r) => r.status === "OK").length,
      skipped: record.results.filter((r) => r.status === "SKIPPED").length,
      error: record.results.filter((r) => r.status === "ERROR").length,
    };

    return NextResponse.json({
      success: true,
      trigger,
      date,
      weekday,
      counts,
      results: record.results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}

// GET is allowed for Vercel Cron compatibility (some configurations use GET).
export async function GET(req: NextRequest) {
  return POST(req);
}
