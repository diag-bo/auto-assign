/**
 * "Thời gian chết" — idle time BY CHOICE: minutes a driver could have been
 * moving and was not. Rules agreed with the supervisor, 2026-11-25:
 *
 *   RIDE   a ride (TAT leg, fair-start clock) running more than 15 min past its
 *          benchmark counts the minutes past the 15. To a stop with a delivery
 *          window the deadline is the LATER of the window's end and (driver free
 *          AND job ready) + benchmark, with no grace — leaving early to arrive on
 *          time is never idle, and a job handed over too late to make the window
 *          is not the driver's fault.
 *   FIRST  the first stop of the day, the same way: from max(shift start, job
 *          ready) + the ride from the check-in place, or — for a driver who did
 *          not tap in (full-timers) — from the PSC of their config rules
 *          (supervisor, 2026-11-28). No start point → no verdict.
 *   STAY   staying at a stop more than 20 min while the next job was already
 *          ready. Waiting for the stop's own window to open is not counted, nor
 *          are hub PSCs and 3PL branches, where waiting for a handover is the job.
 *   LUNCH  the largest single event starting 11:00–14:00 is excused up to 60 min,
 *          once a day.
 *
 * The report is idle ÷ working time, working time being the day's shift hours,
 * the last one stretched to the last arrival when they finish late.
 *
 * Computed on READ from raw stamps on tat_legs: changing a rule here applies to
 * every archived day, with no re-archive. Pure; scripts/idle.test.mts.
 */
import type { TatLeg } from "./tat";
import type { ShiftWindow } from "./pay";

export const RIDE_GRACE_MIN = 15;
export const STAY_LIMIT_MIN = 20;
export const LUNCH_FROM = "11:00";
export const LUNCH_TO = "14:00";
export const LUNCH_EXCUSE_MIN = 60;
/** Hub PSCs that consolidate provincial samples, and the 3PL branches. */
export const STAY_EXEMPT = /^BRA\s*-\s*D0(04|07|09|15|21|23|36)$/;

export type IdleLeg = Pick<TatLeg,
  "seq" | "from_name" | "to_name" | "departed_ts" | "arrived_ts" | "tat_mins" | "benchmark_mins" | "unscored" |
  "from_arrived_ts" | "from_ready_at" | "from_due_at" | "from_opens_at" | "to_ready_at" | "to_due_at" | "start_ts" | "start_bench_mins">;

export interface IdleEvent {
  kind: "first" | "ride" | "stay";
  /** When the idle stretch began — what the lunch window is judged on. */
  at: string;
  mins: number;
  /** Part of `mins` excused as the lunch break. */
  excused: number;
  place: string | null;
  seq: number;
  /** For a scheduled stop: the deadline it was judged against. */
  due?: string;
}

export interface IdleDay {
  events: IdleEvent[];
  idle_mins: number;
  /** Null when the driver had no shift that day. */
  work_mins: number | null;
}

const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const mins = (ms: number) => Math.floor(ms / 60_000);
const iso = (ms: number) => new Date(ms).toISOString();
const vnHm = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(11, 16);
const at = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+07:00`);
const latest = (...xs: number[]) => Math.max(...xs.filter(Number.isFinite));

export function idleDay(legs: IdleLeg[], shifts: ShiftWindow[], date: string): IdleDay {
  const sorted = [...legs].sort((a, b) => a.seq - b.seq);
  const windows = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
  const events: IdleEvent[] = [];
  const push = (e: Omit<IdleEvent, "excused">) => { if (e.mins > 0) events.push({ ...e, excused: 0 }); };

  // FIRST stop: the ride from the check-in place, from shift start or job ready.
  const first = sorted[0];
  if (first && first.start_bench_mins != null && windows.length > 0) {
    const arrived = t(first.from_arrived_ts);
    const go = latest(at(date, windows[0].start), t(first.from_ready_at));
    const deadline = latest(go + first.start_bench_mins * 60_000, t(first.from_due_at));
    if (Number.isFinite(arrived)) {
      push({ kind: "first", at: iso(deadline), mins: mins(arrived - deadline), place: first.from_name, seq: first.seq,
        ...(first.from_due_at ? { due: iso(deadline) } : {}) });
    }
  }

  for (const l of sorted) {
    const departed = t(l.departed_ts), arrived = t(l.arrived_ts);

    // STAY at the from stop, counted from when there was something to go to.
    const reached = t(l.from_arrived_ts);
    if (Number.isFinite(reached) && Number.isFinite(departed) && !STAY_EXEMPT.test(l.from_name ?? "")) {
      const waitFrom = latest(reached, t(l.to_ready_at), t(l.from_opens_at));
      push({ kind: "stay", at: iso(waitFrom), mins: mins(departed - waitFrom) - STAY_LIMIT_MIN, place: l.from_name, seq: l.seq });
    }

    // RIDE to the to stop.
    if (l.unscored || l.benchmark_mins == null || !Number.isFinite(arrived)) continue;
    if (l.to_due_at) {
      const deadline = latest(t(l.to_due_at), latest(departed, t(l.to_ready_at)) + l.benchmark_mins * 60_000);
      push({ kind: "ride", at: iso(departed), mins: mins(arrived - deadline), place: l.to_name, seq: l.seq, due: iso(deadline) });
    } else if (l.tat_mins != null) {
      push({ kind: "ride", at: iso(departed), mins: l.tat_mins - l.benchmark_mins - RIDE_GRACE_MIN, place: l.to_name, seq: l.seq });
    }
  }

  // LUNCH: the biggest event starting in the window, once.
  const lunch = events
    .filter((e) => { const hm = vnHm(t(e.at)); return hm >= LUNCH_FROM && hm < LUNCH_TO; })
    .sort((a, b) => b.mins - a.mins)[0];
  if (lunch) lunch.excused = Math.min(LUNCH_EXCUSE_MIN, lunch.mins);

  // WORK time: the shift, the last window stretched to a late finish.
  let work: number | null = null;
  if (windows.length > 0) {
    const lastArrival = latest(...sorted.map((l) => t(l.arrived_ts)), -Infinity);
    work = windows.reduce((sum, w, i) => {
      const end = i === windows.length - 1 ? latest(at(date, w.end), lastArrival) : at(date, w.end);
      return sum + Math.max(0, mins(end - at(date, w.start)));
    }, 0);
  }

  return {
    events: events.sort((a, b) => t(a.at) - t(b.at)),
    idle_mins: events.reduce((s, e) => s + e.mins - e.excused, 0),
    work_mins: work,
  };
}
