// The Vercel accounts the app rotates across, and the few API calls both the
// rotation and the env sync need. Each account's token is a GitHub secret named
// VERCEL_TOKEN_<id>; its team is looked up from the token, so nothing else about an
// account has to be stored.

export const DOMAIN = "diag-logistics.vercel.app";

// Rotation order: days 1–10 of the month go to the first, 11–20 to the second,
// 21–end to the third. Reorder to change who carries which ten days.
export const ACCOUNTS = [
  { id: "C", project: "auto-assign" }, // team diag4 (auto-assign-six.vercel.app)
  { id: "D", project: "auto-assign" }, // team diag-bo2 (auto-assign-eta.vercel.app)
  { id: "B", project: "auto-assign" }, // team bologistics283-8297s-projects (diag-bo.vercel.app)
];

const teams = {};

async function call(token, method, path, body) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

/** One Vercel API call as this account. */
export async function api(acct, method, path, body) {
  const token = process.env[`VERCEL_TOKEN_${acct.id}`];
  if (!token) throw new Error(`secret VERCEL_TOKEN_${acct.id} is missing`);
  if (!teams[acct.id]) {
    const { user } = await call(token, "GET", "/v2/user");
    teams[acct.id] = user.defaultTeamId ?? (await call(token, "GET", "/v2/teams?limit=1")).teams[0].id;
  }
  const sep = path.includes("?") ? "&" : "?";
  return call(token, method, `${path}${sep}teamId=${teams[acct.id]}`, body);
}

/** Does this account hold the domain, and is it serving? A paused account (over a
 *  plan limit) answers every request with an x-vercel-error header before any code
 *  runs, and so does a project with no production deployment yet. */
export async function inspect(acct) {
  const { domains } = await api(acct, "GET", `/v9/projects/${acct.project}/domains?limit=50`);
  const names = domains.map((d) => d.name);
  const alias = names.find((n) => n !== DOMAIN);
  let healthy = false;
  if (alias) {
    const res = await fetch(`https://${alias}/favicon.ico`, { redirect: "manual" }).catch(() => null);
    healthy = !!res && !res.headers.get("x-vercel-error");
  }
  return { holds: names.includes(DOMAIN), alias, healthy };
}
