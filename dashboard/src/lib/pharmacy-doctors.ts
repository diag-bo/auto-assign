import { receptionistFetch } from "./labcenter";
import { getMonthToDateInvoices, type KiotInvoice } from "./kiotviet";
import { addDays, vnDate } from "./time";

// ── Pharmacy revenue by prescribing doctor, month to date ────────────────────
// Three systems, joined on two keys (verified on November 2026, 93% of revenue
// reached a doctor; the rest were genuine walk-in sales with no visit):
//
//   KiotViet invoice.OrderCode ("DH000534")
//     = Sapoche pharmacy order.kiotviet_order_code      → its reference_vid (the visit)
//     = Sapoche prescription request.access_number      → doctor_name
//
// Both Sapoche reads work on the receptionist login the /sales pages already use;
// no pharmacist account is needed.

const PHARMACY_ORDERS = "https://api.labcenter.vn/spc-pos/api/pharmacy/orders";
const PRESCRIPTIONS = "https://api-bknd.labcenter.vn/api/v1/user/prescription-requests/list";

/** How far before the month a pharmacy order / prescription may have been made for
 *  an invoice issued in it. Measured Nov 2026: every order was made at most 2 hours
 *  before its invoice. */
const ORDER_LOOKBACK_DAYS = 3;
const PRESCRIPTION_LOOKBACK_DAYS = 120;
const PARALLEL = 25;

interface PharmacyOrder {
  kiotviet_order_code: string | null;
  reference_vid: string | null;
  status: string;
}

async function labcenterJson(url: string): Promise<{ data?: unknown }> {
  const res = await receptionistFetch(url);
  if (!res?.ok) throw new Error(`Labcenter ${res?.status ?? "chưa đăng nhập được"}: ${url.split("?")[0]}`);
  return res.json();
}

/** One query per day, all at once. The list costs ~50 ms per row it returns (it
 *  signs a PDF link for each), so a month in one call took 6–13 s; days in
 *  parallel take ~2 s. A day is ~10 orders, far under the 1000 page — the `meta`
 *  block can't confirm that (its `total` echoes the page size), so a full page
 *  throws rather than silently dropping orders. */
async function pharmacyOrders(from: string, to: string): Promise<PharmacyOrder[]> {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const perDay = await Promise.all(
    days.map(async (d) => {
      const j = await labcenterJson(
        `${PHARMACY_ORDERS}?page=1&per_page=1000&created_at_from=${d}T00:00:00.000000&created_at_to=${d}T23:59:59.999999`
      );
      const rows = (j.data ?? []) as PharmacyOrder[];
      if (rows.length >= 1000) throw new Error(`Sapoche: ${d} có hơn 1000 đơn thuốc`);
      return rows;
    })
  );
  return perDay.flat();
}

/** "  BS.  Trần Thanh An" → "BS. Trần Thanh An" */
function cleanName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** Distinct doctors who wrote a prescription for this visit. */
async function doctorsOfVisit(vid: string, from: string, to: string): Promise<string[]> {
  const j = await labcenterJson(
    `${PRESCRIPTIONS}?page=1&per_page=100&access_number=${encodeURIComponent(vid)}` +
      `&from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`
  );
  const rows = (j.data ?? []) as { access_number: string; doctor_name: string | null }[];
  return [...new Set(rows.filter((p) => p.access_number === vid).map((p) => cleanName(p.doctor_name)).filter(Boolean))];
}

export interface DoctorLine {
  name: string;
  revenue: number;
  invoices: number;
}

export interface DoctorReport {
  month: string; // YYYY-MM
  total: number;
  invoices: number;
  doctors: DoctorLine[]; // highest revenue first
  unlinked: { revenue: number; invoices: number }; // no visit / prescription behind the sale
}

/** Group invoices by the doctor(s) behind them. A visit with prescriptions from
 *  several doctors is split evenly — nothing says which line came from whom — so
 *  the doctors still add up to the month's revenue. */
export function groupByDoctor(
  invoices: KiotInvoice[],
  doctorsByOrderCode: Map<string, string[]>
): Omit<DoctorReport, "month"> {
  const byName = new Map<string, DoctorLine>();
  const unlinked = { revenue: 0, invoices: 0 };
  let total = 0;
  for (const inv of invoices) {
    total += inv.total;
    const names = doctorsByOrderCode.get(inv.orderCode) ?? [];
    if (names.length === 0) {
      unlinked.revenue += inv.total;
      unlinked.invoices++;
      continue;
    }
    for (const name of names) {
      const line = byName.get(name) ?? byName.set(name, { name, revenue: 0, invoices: 0 }).get(name)!;
      line.revenue += inv.total / names.length;
      line.invoices++;
    }
  }
  const doctors = [...byName.values()]
    .map((d) => ({ ...d, revenue: Math.round(d.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
  return { total, invoices: invoices.length, doctors, unlinked };
}

export async function getDoctorRevenueMtd(date: string = vnDate()): Promise<DoctorReport> {
  const monthStart = `${date.slice(0, 7)}-01`;
  const to = addDays(date, 1);
  const [invoices, orders] = await Promise.all([
    getMonthToDateInvoices(date),
    pharmacyOrders(addDays(monthStart, -ORDER_LOOKBACK_DAYS), to),
  ]);

  // A cancelled order can share its KiotViet code with the one re-made after it.
  const visitByOrderCode = new Map<string, string>();
  for (const o of orders) {
    if (!o.kiotviet_order_code || !o.reference_vid) continue;
    if (o.status === "canceled" && visitByOrderCode.has(o.kiotviet_order_code)) continue;
    visitByOrderCode.set(o.kiotviet_order_code, o.reference_vid);
  }

  const visits = [...new Set(invoices.map((i) => visitByOrderCode.get(i.orderCode)).filter((v): v is string => !!v))];
  const prescFrom = addDays(monthStart, -PRESCRIPTION_LOOKBACK_DAYS);
  const doctorsByVisit = new Map<string, string[]>();
  for (let i = 0; i < visits.length; i += PARALLEL) {
    const batch = visits.slice(i, i + PARALLEL);
    const found = await Promise.all(batch.map((v) => doctorsOfVisit(v, prescFrom, to)));
    batch.forEach((v, k) => doctorsByVisit.set(v, found[k]));
  }

  const doctorsByOrderCode = new Map<string, string[]>();
  for (const [code, vid] of visitByOrderCode) doctorsByOrderCode.set(code, doctorsByVisit.get(vid) ?? []);

  return { month: date.slice(0, 7), ...groupByDoctor(invoices, doctorsByOrderCode) };
}
