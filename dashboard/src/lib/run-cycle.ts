import { loadConfig } from "./config";
import { autoAssignCycle } from "./assign";
import { pushRunLog, type ArmState } from "./smart-log-kv";
import type { LogEntry } from "./types";
import { vnTimestamp } from "./time";
import type { Env } from "./cartrack";
import type { MorningReads } from "./morning-reads";
import { inTrial, saveTrial } from "./engine-trial";

/**
 * Run one assign cycle for the given armed state and persist its logs. Shared by
 * the cron ping and the arm-time first run so the two stay identical.
 */
export async function runArmedCycle(arm: ArmState, reads?: MorningReads): Promise<LogEntry[]> {
  let logs: LogEntry[];

  const config = await loadConfig();
  if (!config) {
    logs = [{ ts: vnTimestamp(), level: "ERROR", msg: "Failed to load config" }];
  } else {
    const cpu0 = process.cpuUsage(), t0 = Date.now();
    const { result, trial } = await inTrial(() => autoAssignCycle(config, arm.env as Env, false, undefined, reads));
    logs = result;
    const cpu = process.cpuUsage(cpu0);
    await saveTrial(trial, arm.env, Math.round((cpu.user + cpu.system) / 1000), Date.now() - t0)
      .catch((e) => console.error("[run-cycle] skip trial save failed:", e));
  }

  // Skip lines an early flush already stored (see assign.ts) — without this the
  // rollover's lines would appear twice in the dashboard log.
  const unflushed = logs.filter((l) => !l.pushed);
  if (unflushed.length) {
    await pushRunLog(unflushed).catch((e) => console.error("[run-cycle] pushRunLog failed:", e));
  }
  return logs;
}
