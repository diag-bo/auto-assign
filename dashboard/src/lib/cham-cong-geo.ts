import { getCustomerById, type Env, type LiveDriver } from "./cartrack";
import { haversineKm } from "./distance";

/**
 * One-tap chấm công: is the driver standing at a place they may punch at?
 *
 * The position is the PHONE'S, read by the page at the tap (browserFix), checked on
 * the server against the CARTRACK APP's last fix (delivery_drivers_list). Nothing about
 * either is stored or logged; only the verdict and rounded distances go back to the page.
 *
 * Straight-line distance, deliberately: a 200 m radius needs no road router, and the
 * road providers are the billed, daily-capped ones (CLAUDE.md footgun 12).
 */

/** How close counts as "at the place". */
export const CHAM_CONG_RADIUS_M = 200;

export interface LatLng { lat: number; lon: number }

export type PositionVerdict =
  | { ok: true; pos: LatLng; age_s: number | null }
  | { ok: false; reason: "no_position" };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A delivery_drivers_list time, "2026-11-03 17:56:51.704844+07" (seen live
 *  2026-11-03; the fraction is 5 or 6 digits). Unlike the REST stamps it carries
 *  its own offset, so parseVnTimestamp — which appends +07:00 — reads it as NaN.
 *  A bare "YYYY-MM-DD HH:MM:SS" is VN time. NaN for anything else. */
export function parseLiveTs(ts: string | null | undefined): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(ts?.trim() ?? "");
  if (!m) return NaN;
  const ms = (m[3] ?? "").slice(0, 3).padEnd(3, "0");
  const off = !m[4] ? "+07:00" : m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].includes(":") ? m[4] : `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}.${ms}${off}`);
}

/** The driver's LAST KNOWN Cartrack position, whatever its age (supervisor,
 *  2026-11-03): the app sends a new fix only now and then — one test phone sat on
 *  the same fix for 4+ minutes with the app open — so an age limit refused drivers
 *  standing at the branch. The age (from positionUpdatedTs, when the fix was taken)
 *  is reported, never enforced. (0, 0) is a failed fix, not a place in Vietnam. */
export function positionOf(live: LiveDriver | undefined, now: Date): PositionVerdict {
  const lat = live?.latitude, lon = live?.longitude;
  if (!finite(lat) || !finite(lon) || (lat === 0 && lon === 0)) return { ok: false, reason: "no_position" };
  const at = parseLiveTs(live?.positionUpdatedTs);
  const age_s = Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 1000)) : null;
  return { ok: true, pos: { lat, lon }, age_s };
}

/** The phone's own position, sent by the page with the tap (navigator.geolocation).
 *  FRESH — read at the tap — which Cartrack's is not: with the app closed, Cartrack
 *  keeps its last fix forever, and a test check-in passed 15 km from the branch
 *  (2026-11-04). But it is numbers the page sends, so it is cross-checked against
 *  Cartrack (agreesWithCartrack). Null when the body carries nothing usable. */
export interface BrowserFix extends LatLng { accuracy_m: number }

export function browserFix(v: unknown): BrowserFix | null {
  const f = v as { lat?: unknown; lon?: unknown; accuracy_m?: unknown } | null;
  if (!f || !finite(f.lat) || !finite(f.lon) || !finite(f.accuracy_m) || f.accuracy_m < 0) return null;
  if (Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180 || (f.lat === 0 && f.lon === 0)) return null;
  return { lat: f.lat, lon: f.lon, accuracy_m: f.accuracy_m };
}

// Nobody covers ground faster than this between Cartrack's fix and the tap
// (54 km/h, in town), plus slack for two GPS readings of one spot.
const MAX_SPEED_M_S = 15;
const AGREE_SLACK_M = 500;

/** Could the phone have got from Cartrack's last fix to where the browser says it is?
 *  A recent Cartrack fix far from the browser's means the browser's numbers are not
 *  the phone's — refused. An old fix, or none, cannot say: allowed (the hole left is a
 *  faked browser position with the Cartrack app kept closed). */
export function agreesWithCartrack(fix: LatLng, cartrack: PositionVerdict): { ok: boolean; distance_m: number | null } {
  if (!cartrack.ok || cartrack.age_s === null) return { ok: true, distance_m: null };
  const distance_m = Math.round(haversineKm(fix.lat, fix.lon, cartrack.pos.lat, cartrack.pos.lon) * 1000);
  return { ok: distance_m <= AGREE_SLACK_M + cartrack.age_s * MAX_SPEED_M_S, distance_m };
}

export interface Place {
  customer_id: string;
  name: string;
  lat: number;
  lon: number;
  why: "branch" | "first_stop" | "last_stop";
}

export type PlaceVerdict =
  | { near: true; place: Place; distance_m: number }
  | { near: false; nearest: Place | null; distance_m: number | null };

/** The nearest allowed place within the radius, else the nearest one at all (for the
 *  message: "Bạn đang cách D001 khoảng 850m"). */
export function pickPlace(pos: LatLng, places: Place[]): PlaceVerdict {
  let best: Place | null = null;
  let bestM = Infinity;
  for (const p of places) {
    const m = haversineKm(pos.lat, pos.lon, p.lat, p.lon) * 1000;
    if (m < bestM) { best = p; bestM = m; }
  }
  if (!best) return { near: false, nearest: null, distance_m: null };
  const distance_m = Math.round(bestM);
  return distance_m <= CHAM_CONG_RADIUS_M ? { near: true, place: best, distance_m } : { near: false, nearest: best, distance_m };
}

// Places do not move, so one lookup per place per instance per day is plenty. A
// failed lookup is not cached: the next tap simply asks again.
const PLACE_TTL_MS = 24 * 60 * 60 * 1000;
const placeCache = new Map<string, { coords: LatLng; at: number }>();

/** A place's coordinates from its Cartrack customer record — the same point the
 *  Cartrack app routes drivers to. Null on any failure. */
export async function placeCoords(customerId: string, env: Env): Promise<LatLng | null> {
  const key = `${env}:${customerId}`;
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.at < PLACE_TTL_MS) return hit.coords;
  try {
    const res = await getCustomerById(customerId, env);
    const lat = Number(res?.data?.latitude);
    const lon = Number(res?.data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    const coords = { lat, lon };
    placeCache.set(key, { coords, at: Date.now() });
    return coords;
  } catch {
    return null;
  }
}
