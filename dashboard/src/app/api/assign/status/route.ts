import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { getStatusBundle, statusPayload } from "@/lib/smart-log-kv";

/**
 * One poll for the whole dashboard: switch state, heartbeat, live log, and the
 * note-held list — single pipeline request to Upstash instead of 4 separate calls.
 *
 * `?since=<ts>` returns only log entries with ts >= since, so the steady-state
 * 90s poll ships a few new lines instead of re-sending the same 100 entries.
 * Inclusive (>=) so same-second entries aren't lost; the client dedupes the
 * boundary second. Without `since`, the full window is returned (first load).
 */
export async function GET(req: NextRequest) {
  // Shaped by statusPayload rather than here, so the "every field the bundle
  // computes reaches the dashboard" rule is one testable function instead of a
  // list to keep in step. It has fallen out of step three times.
  // Lists come from the parsed config when there is one, so the bundle skips its Redis
  // copy of them; only a failed config load pays for the full hash.
  const [light, config] = await Promise.all([getStatusBundle(100, false), loadConfig()]);
  const bundle = config ? light : await getStatusBundle(100);
  // The config lists are ~150 KB of a ~160 KB answer and change only when the config
  // is parsed again, so a poll that already holds this parse (`parsed`) gets none of
  // them: the dashboard keeps what it has when the fields are absent.
  const same = !!config?.parsedAt && req.nextUrl.searchParams.get("parsed") === config.parsedAt;
  return NextResponse.json({ ...statusPayload(bundle, req.nextUrl.searchParams.get("since")),
    ...(config && !same ? { unfinished: config.unfinished, gaps: config.gaps, overlaps: config.overlaps,
      branchRules: config.branchRules, parsedAt: config.parsedAt } : {}) });
}
