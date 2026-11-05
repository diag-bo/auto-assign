// Moves diag-logistics.vercel.app to the account whose ten days it is, and off a
// paused account straight away. Run hourly by .github/workflows/vercel-rotate.yml;
// every run works out the whole answer again, so a missed or late run costs nothing.
import { ACCOUNTS, DOMAIN, api, inspect } from "./vercel-accounts.mjs";

/** Pure decision. ids in rotation order; holder = id or null; healthy = Set of ids.
 *  Returns the id to move to, or null to stay. */
export function plan({ ids, holder, healthy, day, hour, force }) {
  if (force) return healthy.has(force) && force !== holder ? force : null;
  const slot = day <= 10 ? 0 : day <= 20 ? 1 : 2;
  const desired = ids[slot % ids.length];
  // The holder is down: move now, to the desired account or the next healthy one.
  if (!holder || !healthy.has(holder)) {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[(slot + i) % ids.length];
      if (healthy.has(id)) return id;
    }
    return null;
  }
  if (holder === desired || !healthy.has(desired)) return null; // a paused turn waits
  return hour < 5 ? desired : null; // planned moves only 00:00–04:59 VN, engine asleep
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
  const to = plan({
    ids: ACCOUNTS.map((a) => a.id), holder, healthy,
    day: vn.getUTCDate(), hour: vn.getUTCHours(), force: force === "AUTO" ? "" : force,
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
