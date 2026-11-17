/** A payroll month covers the previous month's 15th through its own 14th, inclusive. */
export function payrollPeriod(month: string): { from: string; to: string } {
  const previous = new Date(`${month}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return { from: `${previous.toISOString().slice(0, 7)}-15`, to: `${month}-14` };
}

/** The payroll month `today` (YYYY-MM-DD) falls in: from the 15th it is next
 *  month's — 17/11 is in Tháng 12 (15/11–14/12). */
export function runningPayMonth(today: string): string {
  const month = today.slice(0, 7);
  if (Number(today.slice(8, 10)) <= 14) return month;
  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString().slice(0, 7);
}
