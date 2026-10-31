/** A config rule as the supervisor saw it when they opened it. The id and
 *  revision identify it; a save refuses if the revision has moved since. */
export interface ConfigRowSnapshot {
  rule_id: number;
  revision: number;
  driver: string;
  start: string;
  end: string;
  dropoff: string;
}

export function parseConfigRowSnapshot(value: unknown): ConfigRowSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if ([row.driver, row.start, row.end, row.dropoff].some((cell) => typeof cell !== "string")) return null;
  if (!Number.isSafeInteger(row.rule_id) || !Number.isSafeInteger(row.revision)) return null;
  return { rule_id: row.rule_id as number, revision: row.revision as number,
    driver: row.driver as string, start: row.start as string, end: row.end as string, dropoff: row.dropoff as string };
}
