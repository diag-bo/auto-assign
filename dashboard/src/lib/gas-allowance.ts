/**
 * Phụ cấp xăng (gasoline allowance) — monthly, for every driver account.
 *
 *   reference price (A) = the month's PVOil Xăng E10 RON 95-III price, averaged
 *                         by the HOURS each price was in effect
 *   litres (E)          = km / KM_PER_LITRE
 *   allowance           = E × (A − BASE_PRICE)
 *
 * Paid only when A is at least PAY_THRESHOLD above BASE_PRICE (supervisor,
 * 2026-11-20): under that, nobody gets it that month. km are TAT legs — the
 * stop-to-stop km the allowance sheet always summed, full-time and part-time alike.
 *
 * Pure: no I/O, so scripts/gas-allowance.test.mts pins it offline.
 */

export const BASE_PRICE_VND = 20_150;
export const KM_PER_LITRE = 50;
export const PAY_THRESHOLD = 0.1;

/** A retail price that took effect at `at` ("YYYY-MM-DDTHH:MM", VN time). */
export interface PriceChange { at: string; price: number }
export interface PricePeriod { price: number; from: string; to: string; hours: number }

const toMs = (vn: string) => Date.parse(`${vn}:00Z`); // VN wall clock, compared only to itself
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** "YYYY-MM" → [first day 00:00, first day of next month 00:00] as VN wall clock. */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  return [`${month}-01T00:00`, fromMs(Date.UTC(y, m, 1))];
}

/** The month cut into periods of one price each. The price in effect at the
 *  month's start is the last change at or before it — so `changes` must reach
 *  back past the 1st, or the month's opening hours have no price. */
export function pricePeriods(month: string, changes: PriceChange[]): PricePeriod[] {
  const [start, end] = monthBounds(month);
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at));
  const opening = sorted.filter((c) => c.at <= start).at(-1);
  if (!opening) return [];
  const inside = sorted.filter((c) => c.at > start && c.at < end);
  const points = [{ at: start, price: opening.price }, ...inside];
  return points.map((p, i) => {
    const to = points[i + 1]?.at ?? end;
    return { price: p.price, from: p.at, to, hours: (toMs(to) - toMs(p.at)) / 3_600_000 };
  });
}

/** Only the changes the month uses: the one in force on the 1st, then those inside it. */
export function monthChanges(month: string, changes: PriceChange[]): PriceChange[] {
  const [start, end] = monthBounds(month);
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at));
  const opening = sorted.filter((c) => c.at <= start).at(-1);
  return [...(opening ? [opening] : []), ...sorted.filter((c) => c.at > start && c.at < end)];
}

export const averagePrice =(periods: PricePeriod[]): number | null => {
  const hours = periods.reduce((t, p) => t + p.hours, 0);
  return hours > 0 ? periods.reduce((t, p) => t + p.price * p.hours, 0) / hours : null;
};

export interface Verdict { average: number; variance: number; paid: boolean; perKm: number }

/** variance = how far the average sits above the base, as a fraction of the base. */
export function verdict(average: number, base = BASE_PRICE_VND): Verdict {
  const variance = (average - base) / base;
  const paid = variance >= PAY_THRESHOLD;
  return { average, variance, paid, perKm: paid ? (average - base) / KM_PER_LITRE : 0 };
}

export type AccountKind = "FT" | "PT";
/** Roster labels: "F - P - DC… Name" is full-time, "P - P - PT… Name" part-time.
 *  Anything else (3PL proxy, Học việc trainees, staff accounts) gets no allowance. */
/** Staff who never get the allowance, by staff code (supervisor, 2026-11-20). */
export const EXCLUDED_STAFF = ["DC100043"]; // Lê Huỳnh Hồng Huệ
export const accountKind = (label: string): AccountKind | null =>
  EXCLUDED_STAFF.some((code) => label.split(" ").includes(code)) ? null
    : label.startsWith("F - ") ? "FT" : label.startsWith("P - ") ? "PT" : null;

export interface AllowanceRow {
  driver_id: string; name: string; kind: AccountKind; km: number;
  litres: number; reference_vnd: number; base_vnd: number; allowance_vnd: number;
}

export function allowanceRows(km: { driver_id: string; name: string; km: number }[], v: Verdict, base = BASE_PRICE_VND): AllowanceRow[] {
  return km.flatMap((r) => {
    const kind = accountKind(r.name);
    if (!kind) return [];
    const litres = r.km / KM_PER_LITRE;
    return [{
      driver_id: r.driver_id, name: r.name, kind, km: r.km, litres,
      reference_vnd: Math.round(litres * v.average), base_vnd: Math.round(litres * base),
      allowance_vnd: v.paid ? Math.round(litres * (v.average - base)) : 0,
    }];
  }).sort((a, b) => a.kind.localeCompare(b.kind) || b.km - a.km);
}

/** The export's "Trip Details" columns: tat_legs' own, in its order, as the sheet has always had them. */
export const TRIP_COLUMNS = [
  "id", "trip_date", "driver_id", "driver_name", "seq", "from_stop_id", "from_job_id", "from_customer_id", "from_name",
  "from_lat", "from_lng", "departed_ts", "to_stop_id", "to_job_id", "to_customer_id", "to_name", "to_lat", "to_lng",
  "arrived_ts", "tat_mins", "tat_basis", "distance_km", "target_mins", "on_time", "long_gap", "archived_at", "eta_mins",
  "benchmark_mins", "available_at", "idle_mins", "unscored",
] as const; // master_driver_id / master_from_id / master_to_id were dropped from tat_legs after 09/2026

/* ---- Petrolimex import (fetches live in the route) ------------------------- */

export const PETROLIMEX_RELEASES = "https://www.petrolimex.com.vn/ndi/thong-cao-bao-chi";
export const GIAXANG_HISTORY = "https://giaxanghomnay.com/lich-su-gia-xang";

/** Petrolimex price releases on one list page, with the exact effective time
 *  from the link ("…dieu-chinh-gia-xang-dau-tu-22-gio-00-phut-ngay-03-11-2026"). */
export function parsePetrolimexReleases(html: string): { at: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const m of html.matchAll(/href="([^"]*dieu-chinh-gia-xang-dau-tu-(\d{1,2})-gio-(\d{2})-phut-ngay-(\d{1,2})-(\d{1,2})-(\d{4})[^"]*)"/g)) {
    const at = fromMs(Date.UTC(+m[6], +m[5] - 1, +m[4], +m[2], +m[3]));
    seen.set(at, m[1].startsWith("http") ? m[1] : `https://www.petrolimex.com.vn${m[1]}`);
  }
  return [...seen].map(([at, url]) => ({ at, url }));
}

/**
 * Petrolimex's E10 RON 95-III (Mức 3) figures on giaxanghomnay.com, by DATE —
 * Petrolimex itself publishes them only as pictures. Dated 15:00; the release
 * list supplies the real time when it differs.
 */
export function parseGiaxanghomnay(html: string): PriceChange[] {
  return html.split(/Điều chỉnh ngày\s*/).slice(1).flatMap((block) => {
    const d = block.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    const row = block.match(/E10\s*RON\s*95(?:\s*Mức\s*3|-III)?\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)/);
    return d && row ? [{ at: `${d[3]}-${d[2]}-${d[1]}T15:00`, price: Number(row[1].replace(/[.,]/g, "")) }] : [];
  });
}

/**
 * Release times + aggregator figures → the changes to import, and the releases
 * with no figure (giaxanghomnay has skipped a petrol change before — 24/09/2026),
 * which the tab asks someone to type from the release. A figure with no release
 * (the 15/10/2026 voluntary −300đ came as an article, not a release) is kept at 15:00.
 */
export function petrolimexChanges(releases: { at: string; url: string }[], figures: PriceChange[]) {
  const byDate = new Map(figures.map((f) => [f.at.slice(0, 10), f.price]));
  const found: PriceChange[] = [], missing: { at: string; url: string }[] = [];
  for (const r of releases) {
    const price = byDate.get(r.at.slice(0, 10));
    if (price) found.push({ at: r.at, price }); else missing.push(r);
  }
  const releaseDates = new Set(releases.map((r) => r.at.slice(0, 10)));
  for (const f of figures) if (!releaseDates.has(f.at.slice(0, 10))) found.push(f);
  return { found, missing };
}

const DAY_MS = 86_400_000;
/** Changes worth saving: none within a day of one already held. */
export const importable = (held: PriceChange[], incoming: PriceChange[]): PriceChange[] =>
  incoming.filter((c) => !held.some((h) => Math.abs(toMs(h.at) - toMs(c.at)) < DAY_MS));

/** Saved rows → one price per time; a typed ('manual') price wins over an import. */
export function effectivePrices(rows: { at: string; price: number; source: string }[]): (PriceChange & { source: string })[] {
  const byAt = new Map<string, PriceChange & { source: string }>();
  for (const r of rows) {
    if (r.source !== "petrolimex" && r.source !== "manual") continue;
    const cur = byAt.get(r.at);
    if (!cur || r.source === "manual") byAt.set(r.at, { at: r.at, price: r.price, source: r.source });
  }
  return [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at));
}
