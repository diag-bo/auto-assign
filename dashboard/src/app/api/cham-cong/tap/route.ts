import { NextRequest, NextResponse } from "next/server";
import { completeJobFast, createJob, deleteJob, getJobsDetailsFast, getLiveDrivers, getStopsByLabels, isDriverUnavailableError, type Env } from "@/lib/cartrack";
import { loadConfig, isValidDriverId } from "@/lib/config";
import { driverJobs } from "@/lib/day-snapshot";
import { DIAG_LOCATIONS } from "@/lib/diag-locations";
import { NV_COOKIE, verifySession } from "@/lib/driver-session";
import { CHAM_CONG_PREFIX } from "@/lib/job-filters";
import { acquireCreateLock, releaseCreateLock, getChamCongIds, setChamCongIds, addChamCongId } from "@/lib/smart-log-kv";
import { vnDate } from "@/lib/time";
import { agreesWithCartrack, browserFix, CHAM_CONG_RADIUS_M, parseLiveTs, pickPlace, placeCoords, positionOf, type LatLng, type Place } from "@/lib/cham-cong-geo";
import { PSC_ROUTES } from "@/lib/psc-routes-data";
import { nextPunch, sameNext, shiftMidpoint, type NextPunch, type PunchTask } from "@/lib/cham-cong-state";
import { sbSelect } from "@/lib/supabase-rest";
import { staffCode } from "@/lib/display-names";
import { BO_RUNNERS } from "@/lib/pay";

/**
 * /api/cham-cong/tap — one-button chấm công (PILOT, /cham-cong/tap).
 *
 * The driver comes from the Nhận Việc session only. The server decides the punch
 * (nextPunch), the place (the nearest allowed one within 200 m of the PHONE's position,
 * which the page reads at the tap and Cartrack's last fix must not contradict —
 * agreesWithCartrack) and completes the task on the spot. The first tap of the day
 * is the check-in — or a check-out when it comes after the middle of today's shift —
 * and every later one a check-out; the last one counts. A tap away from every allowed place,
 * or with no position at all, is REFUSED: nothing is created.
 *
 * Allowed places: the Diag branches today's config names this driver on (fixed or
 * smart, any hours), plus their first stop of the day (check-in) or last (check-out).
 *
 * PILOT: only PILOT_DRIVERS may use it, so no real driver's day (and pay) depends on
 * it yet. Every answer carries `timings` (ms per step) to measure what a driver waits.
 * Going live = drop the gate and the timings, point the Chấm Công tab at this route.
 */

// ponytail: hard-coded pilot list; delete the gate when the tab moves to this route.
const PILOT_DRIVERS = new Set(["8094d712-0f78-11f0-b96d-506b8d982279"]); // prod test driver

// The depot (BRA - D000) is a Diag place drivers start from, but not a dropdown
// branch, so it is not in DIAG_LOCATIONS.
const DEPOT = { customer_id: "0452953a-f967-11ef-8764-506b8d9879b5", name: "D000" };
const BRANCHES = new Map([...DIAG_LOCATIONS.map((l) => [l.customer_id, l.name] as const), [DEPOT.customer_id, DEPOT.name]]);

// Branch coordinates are already in the code (PSC_ROUTES, checked equal to Cartrack's
// customer records 2026-11-04), so only a CLIENT stop costs a lookup — ~1.8 s on a
// cold instance, a quarter of the tap. D000 is no PSC route, and D030's PSC point is
// 4 km off its Cartrack record (the test PSC), so both are pinned to Cartrack's here.
const D030 = DIAG_LOCATIONS.find((l) => l.name === "D030")?.customer_id ?? "";
const KNOWN_COORDS = new Map<string, LatLng>([
  ...PSC_ROUTES.flatMap((r) => (r.lat != null && r.lon != null ? [[r.pickup, { lat: r.lat, lon: r.lon }] as const] : [])),
  [DEPOT.customer_id, { lat: 10.77846, lon: 106.67974 }],
  [D030, { lat: 9.998509, lon: 105.775258 }],
]);

type PlaceRef = Omit<Place, "lat" | "lon">;

type Ms = Record<string, number>;
const timed = async <T,>(ms: Ms, name: string, p: Promise<T>): Promise<T> => {
  const t = Date.now();
  try { return await p; } finally { ms[name] = Date.now() - t; }
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const labelNames = (labels: any): string[] =>
  Array.isArray(labels) ? labels.map((l) => (typeof l === "string" ? l : l?.label)).filter((l): l is string => typeof l === "string") : [];

// ponytail: copy of loadChamCongJobsLive in ../route.ts, kept apart so the live tab is
// untouched during the pilot; the copy there goes when the tab moves here.
async function chamCongJobsToday(driverId: string, today: string, env: Env): Promise<any[] | null> {
  const mine = (jobs: any[]) => jobs.filter((j) =>
    j.delivery_driver_id === driverId &&
    (j.reference_number ?? "").startsWith(CHAM_CONG_PREFIX) &&
    j.job_status_id !== 3 && j.job_status_id !== 7);
  const recorded = await getChamCongIds(today, driverId);
  if (recorded && recorded.length === 0) return [];
  if (recorded) {
    const jobs = await getJobsDetailsFast(recorded, env);
    if (jobs) return mine(jobs);
  }
  const stops = await getStopsByLabels(today, ["check_in", "check_out"], env);
  if (!stops) return null;
  const ids = [...new Set(stops.filter((s) => s.delivery_driver_id === driverId).map((s) => Number(s.job_id)))];
  const jobs = await getJobsDetailsFast(ids, env);
  if (!jobs) return null;
  await setChamCongIds(today, driverId, ids);
  return mine(jobs);
}

const later = (a: string | null | undefined, b: string | null | undefined) =>
  !a ? b ?? null : !b ? a : parseLiveTs(b) > parseLiveTs(a) ? b : a;

function toTask(j: any): PunchTask & { place: string | null; customer_id: string | null } {
  const stop = (j.stops ?? [])[0] ?? {};
  return {
    job_id: Number(j.job_id),
    type: labelNames(j.labels).includes("check_out") ? "check-out" : "check-in",
    done: j.job_status_id === 5,
    at: later(j.create_ts, stop.activity_completed_ts),
    place: BRANCHES.get(stop.customer_id) ?? stop.customer_name ?? null,
    customer_id: stop.customer_id ?? null,
  };
}

const placeName = (customerId: string, fallback: string) => BRANCHES.get(customerId) ?? fallback;

/** Config branches naming this driver, and their first and last stop of the day.
 *  Names only: coordinates are resolved at the tap, and only where needed. */
async function allowedPlaces(driverId: string, today: string, env: Env, ms: Ms) {
  const [config, jobs] = await Promise.all([
    timed(ms, "config", loadConfig({ requireCurrentDay: true }).catch(() => null)),
    timed(ms, "route", driverJobs(today, env, driverId, { maxAgeMs: 15 * 60_000 }).catch(() => null)),
  ]);
  const branchIds = new Set<string>();
  for (const m of config?.mappings ?? []) {
    const named = (isValidDriverId(m.driver_id) && m.driver_id === driverId) || m.smart_driver_id.includes(driverId);
    if (named && BRANCHES.has(m.customer_id)) branchIds.add(m.customer_id);
  }
  // ponytail: route order approximated by completion, then schedule — the snapshot
  // carries no stop order. Check against the timeline's orderedStops before going live.
  const stops = (jobs ?? [])
    .filter((j) => !(j.reference_number ?? "").startsWith(CHAM_CONG_PREFIX) && j.job_status_id !== 3 && j.job_status_id !== 7)
    .flatMap((j) => j.stops.map((s) => ({ s, t: s.activity_completed_ts ?? j.scheduled_delivery_ts ?? "" })))
    .filter((x) => x.s.customer_id)
    .sort((a, b) => parseLiveTs(a.t) - parseLiveTs(b.t));
  const ref = (x: (typeof stops)[number] | undefined, why: Place["why"]): PlaceRef | null =>
    x ? { customer_id: x.s.customer_id!, name: placeName(x.s.customer_id!, x.s.customer_name), why } : null;
  return {
    branches: [...branchIds].map((id): PlaceRef => ({ customer_id: id, name: placeName(id, id), why: "branch" })),
    first: ref(stops[0], "first_stop"),
    last: ref(stops.at(-1), "last_stop"),
  };
}

function auth(req: NextRequest) {
  const s = verifySession(req.cookies.get(NV_COOKIE)?.value);
  if (!s) return { error: NextResponse.json({ expired: true, error: "Phiên đăng nhập đã hết hạn." }, { status: 401 }) };
  if (!PILOT_DRIVERS.has(s.driver_id)) return { error: NextResponse.json({ error: "Tài khoản chưa được mở chấm công một chạm." }, { status: 403 }) };
  return { s };
}

/** Middle of today's working day: Lịch ca's windows plus a BO Runner's BO window
 *  (Mon–Sat, as paidDay adds it). Null — no shift — on any failure: the first tap
 *  is then simply the check-in, which is the pre-midpoint behaviour.
 *  ponytail: every working row of the day, where payroll prefers its own file's rows
 *  once imported; a midpoint only needs the rough shape of the day. */
async function todayMidpoint(driverId: string, driverName: string, today: string): Promise<number | null> {
  const rows = await sbSelect<{ start_time: string | null; end_time: string | null }>("driver_shifts",
    `select=start_time,end_time&driver_id=eq.${driverId}&shift_date=eq.${today}&day_type=eq.working`).catch(() => []);
  const windows = rows.filter((r) => r.start_time && r.end_time).map((r) => ({ start: r.start_time!, end: r.end_time! }));
  const bo = BO_RUNNERS[staffCode(driverName)]?.window;
  if (bo && new Date(`${today}T12:00:00+07:00`).getUTCDay() !== 0) windows.push(bo);
  return shiftMidpoint(windows, today);
}

const hhmm = (ts: string | null) => (ts && ts.length >= 16 ? ts.slice(11, 16) : null);
const shape = (tasks: ReturnType<typeof toTask>[]) =>
  tasks.sort((a, b) => a.job_id - b.job_id).map((t) => ({ job_id: t.job_id, type: t.type, done: t.done, time: hhmm(t.at), place: t.place }));

// ── GET — today's punches and what the button does next ───────────────────
export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const env = (req.nextUrl.searchParams.get("env") ?? "prod") as Env;
  const a = auth(req);
  if (a.error) return a.error;
  const ms: Ms = {};
  const today = vnDate();
  const [jobs, midpoint] = await Promise.all([
    timed(ms, "tasks", chamCongJobsToday(a.s.driver_id, today, env).catch(() => null)),
    timed(ms, "shift", todayMidpoint(a.s.driver_id, a.s.driver_name, today)),
  ]);
  if (!jobs) return NextResponse.json({ error: "Không đọc được chấm công từ Cartrack, vui lòng thử lại." }, { status: 502 });
  const tasks = jobs.map(toTask);
  ms.total = Date.now() - t0;
  return NextResponse.json({ driver_name: a.s.driver_name, next: nextPunch(tasks, new Date(), midpoint), tasks: shape(tasks), timings: ms });
}

// ── POST { expect } — do the next punch, here and now ─────────────────────
const NEED_LOCATION = "Chưa lấy được vị trí điện thoại. Vui lòng cho phép trang dùng vị trí, rồi thử lại.";
// The app sends a fix only now and then; its refresh button sends one at once.
const REFRESH_IN_APP = "Vui lòng bấm làm mới vị trí trong app Cartrack, rồi thử lại.";

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const env = (req.nextUrl.searchParams.get("env") ?? "prod") as Env;
  const a = auth(req);
  if (a.error) return a.error;
  const driverId = a.s.driver_id;
  const today = vnDate();
  const ms: Ms = {};
  const reply = (body: Record<string, unknown>, status = 200) => {
    ms.total = Date.now() - t0;
    return NextResponse.json({ ...body, timings: ms }, { status });
  };

  const body = (await req.json().catch(() => ({}))) as { expect?: NextPunch; fix?: unknown };
  const { expect } = body;

  // Everything the tap needs, read at once: the wait is the slowest of them, not the sum.
  const [jobs, live, places, midpoint] = await Promise.all([
    timed(ms, "tasks", chamCongJobsToday(driverId, today, env).catch(() => null)),
    timed(ms, "position", getLiveDrivers(env).catch(() => null)),
    timed(ms, "places", allowedPlaces(driverId, today, env, ms).catch(() => null)),
    timed(ms, "shift", todayMidpoint(driverId, a.s.driver_name, today)),
  ]);
  ms.read = Date.now() - t0;
  if (!jobs) return reply({ error: "Không đọc được chấm công từ Cartrack, vui lòng thử lại." }, 502);

  const tasks = jobs.map(toTask);
  const now = new Date();
  const next = nextPunch(tasks, now, midpoint);
  if (!expect || !sameNext(expect, next)) return reply({ error: "Trạng thái đã thay đổi, vui lòng xem lại.", next, tasks: shape(tasks) }, 409);
  if (next.action === "wait") {
    const last = tasks.reduce((x, t) => (t.job_id > x.job_id ? t : x));
    const until = new Date(next.until).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
    return reply({ error: `Bạn vừa ${last.type === "check-in" ? "vào ca" : "ra ca"} lúc ${hhmm(last.at)} — có thể ${next.type === "check-in" ? "vào ca" : "ra ca"} sau ${until}.`, next }, 409);
  }

  const fix = browserFix(body.fix);
  if (!fix) return reply({ reason: "no_position", error: NEED_LOCATION, next }, 409);
  if (fix.accuracy_m > CHAM_CONG_RADIUS_M) {
    return reply({ reason: "inaccurate", error: `Vị trí điện thoại chưa chính xác (±${Math.round(fix.accuracy_m)}m). Vui lòng đợi vài giây rồi thử lại.`, accuracy_m: Math.round(fix.accuracy_m), next }, 409);
  }
  // Cartrack unreadable = nothing to cross-check against; the tap goes on the phone's position.
  const me = live?.find((d) => d.deliveryDriverId === driverId);
  const pos = positionOf(me, now);
  const cross = agreesWithCartrack(fix, pos);
  const seen = { accuracy_m: Math.round(fix.accuracy_m), cartrack_m: cross.distance_m, position_age_s: pos.ok ? pos.age_s : null };
  if (!cross.ok) {
    return reply({ reason: "mismatch", error: `Vị trí điện thoại không khớp với app Cartrack. ${REFRESH_IN_APP}`, ...seen, next }, 409);
  }

  let refs: PlaceRef[];
  if (next.action === "complete") {
    // A task left open (a failed completion, or one made before one-tap): only its own place.
    const task = tasks.find((t) => t.job_id === next.job_id)!;
    refs = task.customer_id ? [{ customer_id: task.customer_id, name: task.place ?? "", why: "branch" }] : [];
  } else {
    if (!places) return reply({ error: "Không đọc được danh sách điểm chấm công, vui lòng thử lại.", next }, 502);
    const stop = next.type === "check-in" ? places.first : places.last;
    refs = [...places.branches, ...(stop ? [stop] : [])];
  }
  if (refs.length === 0) {
    return reply({ reason: "no_places", error: "Hôm nay bạn chưa có điểm chấm công nào (không có trong config, chưa có chuyến). Vui lòng liên hệ điều phối.", next }, 409);
  }
  // Known places first, for free; a client stop is looked up only if none of them is near.
  const known = refs.flatMap((r) => { const c = KNOWN_COORDS.get(r.customer_id); return c ? [{ ...r, ...c }] : []; });
  const unknown = refs.filter((r) => !KNOWN_COORDS.has(r.customer_id));
  let verdict = pickPlace(fix, known);
  if (!verdict.near && unknown.length) {
    const looked = await timed(ms, "coords", Promise.all(unknown.map(async (r) => {
      const c = await placeCoords(r.customer_id, env);
      return c ? [{ ...r, ...c }] : [];
    })));
    verdict = pickPlace(fix, [...known, ...looked.flat()]);
  }
  if (!verdict.near) {
    const far = verdict.nearest ? ` Bạn đang cách ${verdict.nearest.name} khoảng ${verdict.distance_m}m.` : "";
    return reply({ reason: "far", error: `Bạn chưa ở điểm chấm công.${far}`, nearest: verdict.nearest?.name ?? null, distance_m: verdict.distance_m, ...seen, next }, 409);
  }

  let jobId: number;
  if (next.action === "complete") {
    jobId = next.job_id;
  } else {
    const lockKey = `chamcong:${driverId}-${next.type}-${today}`;
    if (!(await timed(ms, "lock", acquireCreateLock(lockKey)))) {
      return reply({ error: "Đang xử lý chấm công, vui lòng đợi.", next }, 409);
    }
    const isCheckin = next.type === "check-in";
    // Same payload as /api/cham-cong POST, so payroll reads this punch exactly as before.
    const created = await timed(ms, "create", createJob({
      job_type_id: 3,
      schedule_type_id: 1,
      reference_number: `${CHAM_CONG_PREFIX} ${isCheckin ? "Vào" : "Ra"}`,
      labels: [isCheckin ? "check_in" : "check_out"],
      delivery_driver_id: driverId,
      stops: [{ stop_type_id: 3, customer_id: verdict.place.customer_id, duration: 5 }],
    }, env, me ? "ok" : undefined)); // in the live list = an active account; skips the gate's own lookup
    const id = Number(created.body?.data?.job_id);
    if (!created.ok || !id) {
      void releaseCreateLock(lockKey);
      if (isDriverUnavailableError(created.body)) {
        return reply({ error: 'Nhân viên đang ở trạng thái "Nghỉ ngơi": Cần cập nhật trạng thái và thử lại!', next }, 409);
      }
      return reply({ error: "Tạo chấm công chưa thành công, vui lòng thử lại.", next }, 502);
    }
    if (created.body?.data?.delivery_driver_id !== driverId) {
      await deleteJob(id, env);
      void releaseCreateLock(lockKey);
      return reply({ error: "Tạo chấm công chưa thành công, vui lòng thử lại. Liên hệ điều phối nếu vẫn gặp lỗi!", next }, 502);
    }
    jobId = id;
  }

  // Recording the id and completing are independent: run them side by side.
  const [done] = await Promise.all([
    timed(ms, "complete", completeJobFast(jobId, env)),
    next.action === "create" ? timed(ms, "record", addChamCongId(today, driverId, jobId)) : null,
  ]);
  if (!done.ok) console.warn(`[cham-cong/tap] complete failed job=${jobId} status=${done.status}`);
  const at = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  const what = next.type === "check-in" ? "vào ca" : "ra ca";
  return reply({
    ok: true,
    completed: done.ok,
    job_id: jobId,
    type: next.type,
    place: verdict.place.name,
    why: verdict.place.why,
    distance_m: verdict.distance_m,
    ...seen,
    message: done.ok
      ? `Đã ${what} lúc ${at} tại ${verdict.place.name}`
      : `Đã tạo task ${what} tại ${verdict.place.name} nhưng chưa hoàn thành được — bấm lại, hoặc hoàn thành trên app Cartrack.`,
  });
}
