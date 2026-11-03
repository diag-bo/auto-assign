import { getCustomerById, type Env, type LiveDriver } from "./cartrack";
import { haversineKm } from "./distance";
import { parseVnTimestamp } from "./time";

/**
 * One-tap chấm công: is the driver standing at a place they may punch at?
 *
 * The position is the one the CARTRACK APP reports (delivery_drivers_list), read on
 * the server at the moment of the tap — never the browser's. Nothing about it is
 * stored or logged; only the verdict and a rounded distance go back to the page.
 *
 * Straight-line distance, deliberately: a 200 m radius needs no road router, and the
 * road providers are the billed, daily-capped ones (CLAUDE.md footgun 12).
 */

/** How close counts as "at the place". */
export const CHAM_CONG_RADIUS_M = 200;

/** A position older than this says where the driver WAS. The Cartrack app reports
 *  while it is open; a backgrounded app goes quiet and its last fix goes stale. */
export const POSITION_MAX_AGE_MIN = 5;

export interface LatLng { lat: number; lon: number }

export type PositionVerdict =
  | { ok: true; pos: LatLng; age_s: number }
  | { ok: false; reason: "no_position" | "stale"; age_s?: number };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The driver's live Cartrack position, if it is fresh enough to judge a tap by.
 *  (0, 0) is a failed fix, not a place in Vietnam. An unparseable lastOnlineTs is
 *  stale, never fresh: a clock we cannot read cannot vouch for anything. */
export function positionOf(live: LiveDriver | undefined, now: Date): PositionVerdict {
  const lat = live?.latitude, lon = live?.longitude;
  if (!finite(lat) || !finite(lon) || (lat === 0 && lon === 0)) return { ok: false, reason: "no_position" };
  const at = parseVnTimestamp(live?.lastOnlineTs).getTime();
  if (!Number.isFinite(at)) return { ok: false, reason: "stale" };
  const age_s = Math.max(0, Math.round((now.getTime() - at) / 1000));
  if (age_s > POSITION_MAX_AGE_MIN * 60) return { ok: false, reason: "stale", age_s };
  return { ok: true, pos: { lat, lon }, age_s };
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
