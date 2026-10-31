/**
 * The rule list every bulk config route takes: `[{ pickup_name, expected_row }]`,
 * where `expected_row` is the rule as the dashboard SAW it (id + revision + the
 * values shown). A rule whose revision has moved is skipped, never written.
 *
 * Capped: 500 is several times any real selection.
 */
import { parseConfigRowSnapshot, type ConfigRowSnapshot } from "./config-row-match";

export const MAX_BULK_ROWS = 500;

export type ConfigTarget = { expectPickup: string; expected: ConfigRowSnapshot };

export function parseConfigTargets(
  rows: unknown,
): { targets: ConfigTarget[] } | { error: string } {
  if (!Array.isArray(rows) || rows.length === 0) return { error: "Chưa chọn dòng nào" };
  if (rows.length > MAX_BULK_ROWS) return { error: `Tối đa ${MAX_BULK_ROWS} dòng một lần` };
  const targets: ConfigTarget[] = [];
  for (const r of rows as { pickup_name?: unknown; expected_row?: unknown }[]) {
    if (typeof r?.pickup_name !== "string" || !r.pickup_name.trim()) return { error: "Có dòng thiếu tên điểm lấy mẫu" };
    const expected = parseConfigRowSnapshot(r.expected_row);
    if (!expected) return { error: `Dòng ${r.pickup_name} thiếu mã quy tắc — tải lại` };
    targets.push({ expectPickup: r.pickup_name, expected });
  }
  return { targets };
}
