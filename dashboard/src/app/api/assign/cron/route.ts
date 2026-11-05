import { NextRequest, NextResponse, after } from "next/server";
import { runArmedCycle } from "@/lib/run-cycle";
import {
  getArmState,
  acquireCycleLock,
  releaseCycleLock,
  setCronHeartbeat,
  primaryAlive,
  beatId,
} from "@/lib/smart-log-kv";
import { autoArmIfDue } from "@/lib/auto-arm";
import { maybeAlertHeldOff } from "@/lib/disarm-alert";
import { archiveSealedDays } from "@/lib/tat-archive";
import { restoreExpiredGeofences } from "@/lib/geofence-bypass";
import { maybeMorningSync } from "@/lib/morning-sync-trigger";
import { createMorningReads } from "@/lib/morning-reads";
import { recoverMorning } from "@/lib/morning-recovery";
import { maybeAutoUpdatePickupEtas } from "@/lib/pickup-setup-auto";
import { maybeSundayRosterPost } from "@/lib/sunday-roster-zalo";
import { PRIMARY_HOST } from "@/lib/self-url";
import { maybeClientBotGuides } from "@/lib/client-bot-actions";

// The cycle (Cartrack + Goong calls) can take a while; give it headroom.
export const maxDuration = 60;

/** Reject unless the caller presents the shared secret. If CRON_SECRET is unset,
 *  the endpoint stays open (same exposure as /api/assign today). */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  return auth === `Bearer ${secret}` || header === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Liveness: record every authorized ping so the dashboard can show the system
  // is alive even when nothing gets logged.
  const host = req.headers.get("host") ?? "";
  await setCronHeartbeat(beatId(host)).catch(() => {});

  // The engine follows the movable domain: a ping that arrived on it runs. A backup
  // ping on an account's own address idles while the domain is being pinged, and
  // runs the whole ping below when it is not (the holder was paused over a plan
  // limit, or the main cron job died).
  if (host !== PRIMARY_HOST && (await primaryAlive())) {
    return NextResponse.json({ ran: false, skipped: "standby" });
  }

  after(()=>maybeMorningSync().catch(e=>console.error("[cron] morning data sync:",e)));
  const reads = createMorningReads();
  const archive = async () => {
    const recovery = recoverMorning().catch((e) => console.error("[cron] morning recovery:", e));
    const res = await archiveSealedDays("prod", new Date(), reads).catch((e) => {
      console.error("[cron] archive failed:", e);
      return null;
    });
    if (res) console.log("[cron] TAT seal:", JSON.stringify(res));
    await recovery;
  };

  // Temporary geofence bypasses — before the arm check, so a disarmed engine never
  // leaves a driver's geofence open.
  after(async () => {
    const n = await restoreExpiredGeofences().catch((e) => { console.error("[cron] geofence restore:", e); return 0; });
    if (n) console.log(`[cron] geofence restored for ${n} driver(s)`);
  });
  after(() => maybeAutoUpdatePickupEtas().catch(e => console.error("[cron] pickup ETA update:", e)));
  // Sunday roster, all 13:00: Mon auto-save, Tue admin open-slots alert, Wed draft to drivers, Thu admin alert, Fri final.
  after(() => maybeSundayRosterPost().catch(e => console.error("[cron] sunday roster post:", e)));
  // Client bots' daily "how to use" message, Mon–Sat at each group's own time.
  after(() => maybeClientBotGuides().catch(e => console.error("[cron] client bot guide:", e)));

  // 1) Switch off? Inside 05:30–22:00 the engine should be running, so self-heal
  //    by auto-arming — unless someone turned it off by hand, which now holds
  //    until they turn it back on. A held engine emails a daily reminder instead.
  //    Outside the window (overnight) we leave it off.
  let arm = await getArmState();
  if (!arm) {
    const auto = await autoArmIfDue();
    if (!auto) {
      after(archive);
      return NextResponse.json({ ran: false, skipped: "disarmed" });
    }
    if (auto.kind === "held") {
      after(archive);
      after(() => maybeAlertHeldOff().catch(() => {}));
      return NextResponse.json({ ran: false, skipped: "held-off", by: auto.hold.by });
    }
    arm = auto.state; // freshly auto-armed — fall through and run a cycle now
  }

  // 2) One cycle at a time — skip if a previous ping (or the arm-time first run)
  //    is still running.
  const gotLock = await acquireCycleLock();
  if (!gotLock) {
    after(archive);
    return NextResponse.json({ ran: false, skipped: "locked" });
  }

  // Respond immediately so cron-job.org (30s max) doesn't time out.
  // The cycle continues in after() for up to maxDuration (60s).
  after(async () => {
    // Start both immediately. The archive's Supabase writes cannot delay the
    // assignment cycle, and both paths share the pre-rollover timeline promise.
    const archiveWork = archive();
    try {
      await runArmedCycle(arm, reads);
    } catch (e) {
      console.error("[cron] runArmedCycle failed:", e);
    } finally {
      await releaseCycleLock().catch(() => {});
    }
    await archiveWork;
  });

  return NextResponse.json({ ran: true, env: arm.env });
}
