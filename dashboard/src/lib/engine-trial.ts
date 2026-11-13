import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Job } from "./types";
import type { LeaveEntry } from "./leave-config";
import { sbInsert } from "./supabase-rest";

/**
 * Engine skip TRIAL — log only, nothing here changes what a cycle does (2026-11-13).
 *
 * The question: if a cycle stopped right after its fetch whenever the fetched picture
 * matched the previous cycle's, what would it have missed? Every armed cron cycle
 * records the fingerprint of what it fetched and every WRITE it then made (Cartrack
 * REST non-GET, Cartrack RPC calls that are not reads, Zalo messages, Supabase and
 * Labcenter writes, emails). A row with fp_same and write_count > 0 is work a skip
 * would have dropped — usually a clock event (a parked job's release time, a shift
 * start, a late alert) that the fingerprint cannot see. Rows: Supabase
 * engine_skip_trial. Delete this module and the table once the trial is read.
 *
 * Writes are counted per CYCLE, not per instance: an AsyncLocalStorage scope follows
 * the cycle's own requests, so a booking served by the same instance at the same
 * moment is not counted into it.
 */

export interface Trial {
  fp: string | null;
  unassigned: number;
  routed: number;
  writes: Record<string, number>;
}

const als = new AsyncLocalStorage<Trial>();
// Previous fingerprint, per instance. A cold instance has none, so its first cycle
// records prev_known = false rather than a false "changed".
let lastFp: string | null = null;

// Everything else on fleetweb is a write (assign, park, reject, create, optimise...).
const READ_RPC = /^(ct_login|delivery_get_|delivery_drivers_list|delivery_jobs_list|delivery_timeline_route_list)/;

/** What a request is, if it is a write worth counting; null for reads and Redis. */
export function classifyRequest(url: string, method: string, body: unknown): string | null {
  let host: string;
  try { host = new URL(url).host; } catch { return null; }
  const m = method.toUpperCase();
  if (host.startsWith("fleetweb-vn.")) {
    let rpc = "?";
    try { rpc = typeof body === "string" ? JSON.parse(body).method ?? "?" : "?"; } catch { /* not JSON */ }
    return READ_RPC.test(rpc) ? null : `rpc:${rpc}`;
  }
  if (m === "GET" || m === "HEAD") return null;
  if (host.startsWith("fleetapi-vn.")) return `rest:${m}`;
  if (host.includes("zaloplatforms")) return "zalo";
  if (host.endsWith(".supabase.co")) return "supabase";
  if (host.includes("labcenter")) return "labcenter";
  if (host.includes("resend")) return "email";
  return null; // Upstash (always POST, even for reads), map providers, ...
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const trial = als.getStore();
    if (trial) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const kind = classifyRequest(url, method, init?.body);
      if (kind) trial.writes[kind] = (trial.writes[kind] ?? 0) + 1;
    }
    return orig(input as RequestInfo, init);
  }) as typeof fetch;
}

/** Run one cycle inside a trial scope. */
export async function inTrial<T>(fn: () => Promise<T>): Promise<{ result: T; trial: Trial }> {
  install();
  const trial: Trial = { fp: null, unassigned: 0, routed: 0, writes: {} };
  const result = await als.run(trial, fn);
  return { result, trial };
}

const jobKey = (j: Job) => [
  j.job_id, j.job_status_id ?? null, j.delivery_driver_id ?? null, j.scheduled_delivery_ts ?? null,
  j.send_to_driver_at ?? null, j.labels ?? null, j.last_assigned_plan_id ?? null,
  (j.stops ?? []).map((s) => [s.stop_id ?? null, s.stop_type_id ?? null, s.stop_status_id ?? null,
    s.customer_id ?? null, s.note ?? null, s.delivery_windows ?? null]),
];

/** The fetched picture, minus what moves on its own (GPS, ETAs). */
export function fingerprint(unassigned: Job[], routed: Job[], configStamp: string, leave: LeaveEntry[]): string {
  const byId = (a: Job, b: Job) => a.job_id - b.job_id;
  return createHash("sha1")
    .update(JSON.stringify([
      [...unassigned].sort(byId).map(jobKey),
      [...routed].sort(byId).map(jobKey),
      configStamp,
      leave,
    ]))
    .digest("hex");
}

/** Called by the cycle right after its fetch. No-op outside a trial scope. */
export function noteFingerprint(unassigned: Job[], routed: Job[], configStamp: string, leave: LeaveEntry[]): void {
  const trial = als.getStore();
  if (!trial || trial.fp) return; // first fetch of the cycle is the one a skip would test
  trial.fp = fingerprint(unassigned, routed, configStamp, leave);
  trial.unassigned = unassigned.length;
  trial.routed = routed.length;
}

export async function saveTrial(trial: Trial, env: string, cpuMs: number | null, wallMs: number): Promise<void> {
  const prev = lastFp;
  if (trial.fp) lastFp = trial.fp;
  const writeCount = Object.values(trial.writes).reduce((a, b) => a + b, 0);
  await sbInsert("engine_skip_trial", [{
    env,
    fp: trial.fp,
    fp_same: trial.fp && prev ? trial.fp === prev : null,
    prev_known: !!prev,
    unassigned: trial.unassigned,
    routed: trial.routed,
    write_count: writeCount,
    writes: trial.writes,
    cpu_ms: cpuMs,
    wall_ms: wallMs,
  }]);
}
