import { parseVnTimestamp } from "./time";

/**
 * What the one chấm-công button does next, from today's tasks alone.
 *
 * Cancelled tasks (status 3, 7) are filtered out by the caller. "Latest" is the
 * highest job id — Cartrack ids only grow, where timestamps can be blank.
 */

/** A punch of the opposite type this soon after the last one is a double tap or a
 *  mistake, not a shift: in at 07:02, out at 07:03 pays nobody anything real. */
export const PUNCH_GAP_MIN = 10;

export interface PunchTask {
  job_id: number;
  type: "check-in" | "check-out";
  done: boolean;
  /** VN "YYYY-MM-DD HH:MM:SS": the later of creation and completion. */
  at: string | null;
}

export type NextPunch =
  | { action: "complete"; job_id: number; type: PunchTask["type"] }
  | { action: "create"; type: PunchTask["type"] }
  | { action: "wait"; type: PunchTask["type"]; until: string };

export function nextPunch(tasks: PunchTask[], now: Date): NextPunch {
  const last = tasks.reduce<PunchTask | null>((a, t) => (!a || t.job_id > a.job_id ? t : a), null);
  if (!last) return { action: "create", type: "check-in" };
  if (!last.done) return { action: "complete", job_id: last.job_id, type: last.type };
  const type = last.type === "check-in" ? "check-out" : "check-in";
  // An unreadable time does not block: NaN never compares as "too soon".
  const until = parseVnTimestamp(last.at).getTime() + PUNCH_GAP_MIN * 60_000;
  if (now.getTime() < until) return { action: "wait", type, until: new Date(until).toISOString() };
  return { action: "create", type };
}

/** Does the next punch the page showed still hold? A mismatch means another tap (or
 *  điều phối) got there first — the double-tap guard. */
export const sameNext = (a: NextPunch, b: NextPunch): boolean =>
  a.action === b.action && a.type === b.type && (a.action !== "complete" || (b.action === "complete" && a.job_id === b.job_id));
