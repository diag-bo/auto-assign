import { getCustomerById, type Env, type LiveDriver } from "./cartrack";
import { haversineKm } from "./distance";

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
