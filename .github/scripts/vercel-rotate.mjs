// Moves diag-logistics.vercel.app round-robin across the healthy accounts: each holds
// it for one turn, then it passes to the next healthy account in order; a paused
// account is skipped and moved off straight away. Run every 5 minutes by
// .github/workflows/vercel-rotate.yml; every run works the whole answer out again
// from the domain itself, so a missed or late run costs nothing.
import { ACCOUNTS, DOMAIN, api, inspect } from "./vercel-accounts.mjs";

// One turn = 8 days of holding the domain. The engine runs on a fixed beat (every
// 3 minutes, 05:00–22:00), so days held IS runs done — the share is equal without
// counting anything. The 6 h slack keeps the hand-over inside the night window.
export const TURN_MS = 8 * 86_400_000 - 6 * 3_600_000;

/** Pure decision. ids in rotation order; holder = id or null; healthy = Set of ids;
 *  heldMs = how long the holder has had the domain. Returns the id to move to, or
 *  null to stay. */
export function plan({ ids, holder, healthy, heldMs, hour, force }) {
  if (force) return healthy.has(force) && force !== holder ? force : null;
  const h = ids.indexOf(holder);
  const next = [...ids.slice(h + 1), ...ids.slice(0, h + 1)].find((id) => id !== holder && healthy.has(id)) ?? null;
  if (!holder || !healthy.has(holder)) return next; // holder down: move now
  return hour < 5 && heldMs >= TURN_MS ? next : null; // turn over only 00:00–04:59 VN, engine asleep
}

async function main() {
  const force = (process.env.FORCE_TO ?? "").trim().toUpperCase();
  const vn = new Date(Date.now() + 7 * 3600_000);
  const state = {};
  for (const a of ACCOUNTS) {
    state[a.id] = await inspect(a).catch((e) => ({ error: e.message, holds: false, healthy: false }));
    console.log(`${a.id} (${a.project}):`, JSON.stringify(state[a.id]));
  }
  const holder = ACCOUNTS.find((a) => state[a.id].holds)?.id ?? null;
  const healthy = new Set(ACCOUNTS.filter((a) => state[a.id].healthy).map((a) => a.id));
  const heldMs = holder ? Date.now() - state[holder].since : 0;
  if (holder && !state[holder].since) console.log(`::warning::no start time for ${holder}'s hold — planned turns cannot advance`);
  else if (holder) console.log(`${holder} has held ${DOMAIN} ${(heldMs / 86_400_000).toFixed(1)} days (turn: ${(TURN_MS / 86_400_000).toFixed(2)})`);
  const to = plan({
    ids: ACCOUNTS.map((a) => a.id), holder, healthy, heldMs,
    hour: vn.getUTCHours(), force: force === "AUTO" ? "" : force,
  });
  if (!to) return console.log(`stay: ${DOMAIN} on ${holder ?? "nobody"}`);

  const from = ACCOUNTS.find((a) => a.id === holder);
  const dest = ACCOUNTS.find((a) => a.id === to);
  console.log(`move: ${DOMAIN} ${holder ?? "nobody"} → ${to}`);
  if (from) await api(from, "DELETE", `/v9/projects/${from.project}/domains/${DOMAIN}`);
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      await api(dest, "POST", `/v10/projects/${dest.project}/domains`, { name: DOMAIN });
      return console.log("moved");
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  // Never leave the domain on nobody: hand it back.
  if (from) await api(from, "POST", `/v10/projects/${from.project}/domains`, { name: DOMAIN });
  throw last;
}

if (process.argv[1]?.endsWith("vercel-rotate.mjs")) await main();
