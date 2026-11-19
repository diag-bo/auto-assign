/**
 * Tiền gửi xe — a driver declares, per payroll period, the parking they paid:
 * per place, the price of one parking and how many times. A place is one
 * Cartrack client (master_clients row); its standard price is
 * master_clients.parking_fee_vnd (null = not a parking place).
 *
 * The check is per line and strict (supervisor, 2026-11-19 — some places are
 * free for the first hour, so anything above the record is refused, not just
 * flagged): the price may not exceed the standard price, and the count may not
 * exceed the driver's VISITS in the period, a visit being an arrival at the
 * client from a different client (tat_legs — consecutive stops there are one
 * parking). An invalid line blocks the whole submission until corrected.
 */
import { payrollPeriod, runningPayMonth } from "./pay-period";

export interface ClientRow {
  customer_id: string; customer_name: string | null; address_line_1: string | null; parking_fee_vnd: number;
}
export interface ParkingPlace { id: string; name: string; address: string; fee_vnd: number }
export interface ParkingLineInput { place_id: string; amount_vnd: number; times: number }
export interface ParkingLine extends ParkingLineInput {
  name: string; fee_vnd: number; visits: number; claimed_vnd: number;
  /** Vietnamese reason the line is refused, or null. */
  problem: string | null;
}
export interface ParkingCheck { lines: ParkingLine[]; claimed_vnd: number; valid: boolean }

/** "SENDOUT4 - D5 - NCThanh - Bệnh Viện Chợ Rẫy" → "Bệnh Viện Chợ Rẫy". Code,
 *  district and street are the first three parts; the name may itself hold " - ". */
export function shortName(full: string): string {
  const parts = full.split(/\s+-\s+/);
  return (parts.length > 3 ? parts.slice(3).join(" - ") : parts[parts.length - 1]).trim();
}

/** Drop the dispatcher notes some addresses open with: "(Cutoff 13h00 thứ 6) …". */
const cleanAddress = (a: string) => a.replace(/^\s*\([^)]*\)\s*/, "").trim();

export function toPlaces(rows: ClientRow[]): ParkingPlace[] {
  return rows.map((r) => ({
    id: r.customer_id, name: shortName(r.customer_name ?? ""),
    address: cleanAddress(r.address_line_1 ?? ""), fee_vnd: r.parking_fee_vnd,
  })).sort((a, b) => a.name.localeCompare(b.name, "vi") || a.address.localeCompare(b.address, "vi"));
}

/** Visits per client: arrivals there from a different client. */
export function countVisits(legs: { from_customer_id: string | null; to_customer_id: string | null }[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const l of legs) {
    if (!l.to_customer_id || l.from_customer_id === l.to_customer_id) continue;
    n.set(l.to_customer_id, (n.get(l.to_customer_id) ?? 0) + 1);
  }
  return n;
}

/** Payroll months a driver may still declare for: the running one, plus the one
 *  just ended until payroll runs on the 25th (as Cập nhật công). */
export function openPayMonths(today: string): string[] {
  const running = runningPayMonth(today);
  const day = Number(today.slice(8, 10));
  return day >= 15 && day <= 25 ? [running, today.slice(0, 7)] : [running];
}

export { payrollPeriod };

/** Validates shape; returns a Vietnamese message or null. */
export function badLines(lines: unknown, places: Map<string, ParkingPlace>): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return "Thêm ít nhất một điểm gửi xe.";
  if (lines.length > 50) return "Tối đa 50 dòng.";
  const seen = new Set<string>();
  for (const l of lines as Partial<ParkingLineInput>[]) {
    const p = places.get(String(l?.place_id ?? ""));
    if (!p) return "Chọn điểm gửi xe từ danh sách.";
    if (seen.has(p.id)) return `${p.name}: mỗi điểm chỉ nhập một dòng.`;
    seen.add(p.id);
    if (!Number.isInteger(l.amount_vnd) || l.amount_vnd! <= 0) return `${p.name}: số tiền 1 lần không hợp lệ.`;
    if (!Number.isInteger(l.times) || l.times! <= 0) return `${p.name}: số lần không hợp lệ.`;
  }
  return null;
}

/** The driver is told THAT a line is wrong, never why (supervisor, 2026-11-19):
 *  naming the limit would tell them what to type. */
export function lineProblem(amount: number, times: number, fee: number, visits: number): string | null {
  return amount > fee || times > visits ? "Yêu cầu không hợp lệ" : null;
}

export function checkLines(lines: ParkingLineInput[], places: Map<string, ParkingPlace>, visits: Map<string, number>): ParkingCheck {
  const out: ParkingLine[] = lines.map((l) => {
    const p = places.get(l.place_id)!;
    const v = visits.get(p.id) ?? 0;
    return { place_id: p.id, amount_vnd: l.amount_vnd, times: l.times, name: p.name, fee_vnd: p.fee_vnd,
      visits: v, claimed_vnd: l.amount_vnd * l.times, problem: lineProblem(l.amount_vnd, l.times, p.fee_vnd, v) };
  });
  return { lines: out, claimed_vnd: out.reduce((s, l) => s + l.claimed_vnd, 0), valid: out.every((l) => !l.problem) };
}
