/**
 * Batches Cartrack delivered to D001 that Labcenter has not received.
 *
 * Cartrack is the start: a job whose D001 drop-off is completed carries its batch
 * codes as item tracking numbers. Labcenter is the check: if one of those codes
 * is still "created"/"transferred" (not "completed") 30 min after the drop-off,
 * the bag is physically at the lab and nobody has scanned it in.
 *
 * Cost: rides the assign cycle's own timeline (no Cartrack call), two small
 * Labcenter list calls every CHECK_EVERY_MS, and a Redis write only when the list
 * changes. The open list is ~20 rows over two weeks (measured 2026-11-11), so it
 * is never per-code lookups.
 *
 * Today's timeline only covers today, so a row Cartrack confirmed is carried
 * forward until Labcenter completes it — an evening delivery must not vanish at
 * midnight. A batch with no Cartrack D001 drop-off is never listed.
 */
import { receptionistFetch } from "./labcenter";
import { getBatchArrivals, setCycleSnapshot } from "./smart-log-kv";
import { parseVnTimestamp } from "./time";
import { isD001 } from "./unmapped-row";
import type { Job } from "./types";

export const GRACE_MS = 30 * 60_000;
const CHECK_EVERY_MS = 10 * 60_000;
const LOOKBACK_MS = 14 * 24 * 60 * 60_000;
const BATCH_RE = /^B\d{15}$/;

export interface LisBatch {
  batch_code: string;
  status?: string;
  source_location?: string;
  destination_location?: string;
  total_sample?: number;
  transferred_at?: string | null;
}

export interface StuckBatch {
  code: string;
  /** "D038" — the branch that made the batch. */
  branch: string;
  /** Labcenter status right now: "created" or "transferred". */
  status: string;
  samples: number | null;
  /** Cartrack D001 drop-off completion, VN "YYYY-MM-DD HH:MM:SS". */
  delivered_at: string;
  /** Labcenter transfer time, ISO UTC. */
  transferred_at: string | null;
  job_id: number | null;
  driver: string | null;
}

type Delivery = Pick<StuckBatch, "delivered_at" | "job_id" | "driver">;

/** Every batch code whose job completed a drop-off at D001, with when. */
export function deliveriesAtD001(jobs: Job[]): Map<string, Delivery> {
  const out = new Map<string, Delivery>();
  for (const j of jobs) {
    const stop = (j.stops ?? []).find((s) => s.stop_type_id !== 1 && !!s.customer_id && isD001(s.customer_id) && !!s.activity_completed_ts);
    if (!stop) continue;
    for (const code of j.item_tracking_numbers ?? []) {
      if (!BATCH_RE.test(code)) continue;
      const prev = out.get(code);
      if (!prev || stop.activity_completed_ts! < prev.delivered_at!) {
        out.set(code, { delivered_at: stop.activity_completed_ts!, job_id: j.job_id, driver: j.driver?.first_name || null });
      }
    }
  }
  return out;
}

export function findStuckBatches(jobs: Job[], open: LisBatch[], previous: StuckBatch[], now: number): StuckBatch[] {
  const delivered = deliveriesAtD001(jobs);
  const carried = new Map(previous.map((p) => [p.code, p as Delivery]));
  const rows: StuckBatch[] = [];
  for (const b of open) {
    if (b.destination_location !== "001" || !BATCH_RE.test(b.batch_code)) continue;
    if (b.status !== "created" && b.status !== "transferred") continue;
    const d = delivered.get(b.batch_code) ?? carried.get(b.batch_code);
    if (!d || now - parseVnTimestamp(d.delivered_at).getTime() < GRACE_MS) continue;
    rows.push({
      code: b.batch_code, branch: `D${b.source_location ?? b.batch_code.slice(1, 4)}`, status: b.status,
      samples: b.total_sample ?? null, delivered_at: d.delivered_at,
      transferred_at: b.transferred_at ?? null, job_id: d.job_id, driver: d.driver,
    });
  }
  return rows.sort((a, b) => a.delivered_at.localeCompare(b.delivered_at));
}

/** Not-yet-received batches over the lookback window; null when Labcenter did not answer. */
async function openLisBatches(now: number): Promise<LisBatch[] | null> {
  const lists = await Promise.all(["created", "transferred"].map(async (status) => {
    const rows: LisBatch[] = [];
    for (let page = 1; page <= 10; page++) {
      const p = new URLSearchParams({ batch_code: "", status, created_at_from: new Date(now - LOOKBACK_MS).toISOString(),
        created_at_to: new Date(now).toISOString(), page: String(page), per_page: "100", order_direction: "desc" });
      const res = await receptionistFetch(`https://api.labcenter.vn/spc-lis/api/v1/batch?${p}`, { signal: AbortSignal.timeout(8000) });
      if (!res?.ok) return null;
      const data = (await res.json().catch(() => null))?.data;
      if (!Array.isArray(data)) return null;
      rows.push(...data);
      // ponytail: Labcenter's pagination.lastPage reads 1 even with more pages, so length decides.
      if (data.length < 100) break;
    }
    return rows;
  }));
  return lists.every(Boolean) ? lists.flat() as LisBatch[] : null;
}

let lastRun = 0;
let memo: StuckBatch[] | null = null;
let memoJson = "";

/** Called by the assign cycle with today's timeline. In-process gate, so a quiet run costs no Redis. */
export async function maybeCheckBatchArrivals(jobs: Job[], now = Date.now()): Promise<void> {
  if (now - lastRun < CHECK_EVERY_MS) return;
  lastRun = now;
  try {
    const open = await openLisBatches(now);
    if (!open) { console.error("[batch-arrival] Labcenter batch list unavailable"); return; }
    const rows = findStuckBatches(jobs, open, memo ?? await getBatchArrivals(), now);
    const json = JSON.stringify(rows);
    if (json !== memoJson) await setCycleSnapshot({ batchArrivals: rows });
    memo = rows; memoJson = json;
  } catch (e) {
    console.error("[batch-arrival]", e);
  }
}
