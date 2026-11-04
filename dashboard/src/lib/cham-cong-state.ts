import { parseLiveTs } from "./cham-cong-geo";

/**
 * What the one chấm-công button does next, from today's tasks alone.
 *
 * The FIRST tap of the day is the check-in; every tap after it is a check-out, and
 * the last one is the one that counts. So a driver never has to know which way the
 * button points: a forgotten check-out is fixed by tapping again later, and an extra
 * tap just moves the end. Payroll reads a day exactly that way — the earliest
 * check-in opens it, the latest check-out closes it (workedMinutes in pay.ts).
 *
 * Cancelled tasks (status 3, 7) are filtered out by the caller. "Latest" is the
 * highest job id — Cartrack ids only grow, where timestamps can be blank.
 */

/** A tap this soon after the last one is a double tap, not a shift end: in at
 *  07:02, out at 07:03 pays nobody anything real. */
export const PUNCH_GAP_MIN = 10;

export interface PunchTask {
  job_id: number;
  type: "check-in" | "check-out";
  done: boolean;
  /** The later of creation and completion, as Cartrack sends it:
   *  "2026-11-04 19:25:51.163837+07" (parseLiveTs). */
  at: string | null;
}

export type NextPunch =
  | { action: "complete"; job_id: number; type: PunchTask["type"] }
  | { action: "create"; type: PunchTask["type"] }
  | { action: "wait"; type: PunchTask["type"]; until: string };

/**
 * The middle of the driver's working day, epoch ms: from the earliest shift start to
 * the latest shift end. A FIRST tap after it is a check-out (supervisor, 2026-11-03):
 * a driver who forgot to tap in is ending their day, not starting it — and for
 * Mộng Hoa (no trips) or Anh Tú's BO morning, the tap is the only evidence there is.
 * Null with no shift: then the first tap is simply the check-in.
 */
export function shiftMidpoint(windows: { start: string; end: string }[], date: string): number | null {
  const at = (hhmm: string) => Date.parse(`${date}T${hhmm.slice(0, 5)}:00+07:00`);
  const starts = windows.map((w) => at(w.start)).filter(Number.isFinite);
  const ends = windows.map((w) => at(w.end)).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  const from = Math.min(...starts), to = Math.max(...ends);
  return to > from ? from + (to - from) / 2 : null;
}

export function nextPunch(tasks: PunchTask[], now: Date, midpoint: number | null = null): NextPunch {
  const last = tasks.reduce<PunchTask | null>((a, t) => (!a || t.job_id > a.job_id ? t : a), null);
  const firstIsOut = midpoint !== null && now.getTime() >= midpoint;
  if (!last) return { action: "create", type: firstIsOut ? "check-out" : "check-in" };
  // A task left open (a failed completion, or one made before one-tap) is finished first.
  if (!last.done) return { action: "complete", job_id: last.job_id, type: last.type };
  const type = tasks.some((t) => t.type === "check-in") || firstIsOut ? "check-out" : "check-in";
  // An unreadable time does not block: NaN never compares as "too soon". (Reading
  // Cartrack's "+07" stamps with parseVnTimestamp made EVERY time unreadable, so the
  // gap never held — a 05:42 check-in took a 05:43 check-out, 2026-11-04.)
  const until = parseLiveTs(last.at) + PUNCH_GAP_MIN * 60_000;
  if (now.getTime() < until) return { action: "wait", type, until: new Date(until).toISOString() };
  return { action: "create", type };
}

/** Does the next punch the page showed still hold? A mismatch means another tap (or
 *  điều phối) got there first — the double-tap guard. */
export const sameNext = (a: NextPunch, b: NextPunch): boolean =>
  a.action === b.action && a.type === b.type && (a.action !== "complete" || (b.action === "complete" && a.job_id === b.job_id));
