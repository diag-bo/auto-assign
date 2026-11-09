// Writes the app's settings to every Vercel account from ONE fixed copy: the GitHub
// secrets of this repo. Run by hand from .github/workflows/vercel-env-sync.yml.
//
// GitHub is the source because it doesn't move when the accounts do. A copy kept on
// one account drifts: on 2026-11-09 D, rotated in that morning, carried a valid but
// wrong Labcenter receptionist login and every AO lookup 403'd. So every secret here
// is written, by its own name, to every account, overwriting what each one had.
//
// It refuses to write while any account holds a setting GitHub doesn't — the set is
// incomplete, and a rotated-in account would keep its own value for it. Add it to
// GitHub, or delete it from that account if nothing uses it. Values are never printed.
import { createHmac } from "node:crypto";
import { ACCOUNTS, api, inspect } from "./vercel-accounts.mjs";

// GitHub secrets that belong to the workflows, not the app.
const NOT_APP = (k) => /^VERCEL_TOKEN_/.test(k) || k === "GOONG_API_KEY_2" || k === "github_token";
// Account settings that are not the app's: Vercel's own, and retired per-account switches.
const NOT_SYNCED = (k) => k.startsWith("VERCEL_") || k === "STANDBY" || k === "DEPLOY_ID";
const DRY = process.env.DRY_RUN === "true";
const github = JSON.parse(process.env.SECRETS_JSON || "{}");

// 1. The master copy.
const wanted = Object.entries(github).filter(([k, v]) => !NOT_APP(k) && v !== "" && v != null).map(([key, value]) => ({ key, value }));
const keys = new Set(wanted.map((w) => w.key));
console.log(`GitHub: ${wanted.length} app settings`);

// 2. Every account's settings, and what GitHub doesn't have.
const haves = new Map();
for (const acct of ACCOUNTS) haves.set(acct, (await api(acct, "GET", `/v10/projects/${acct.project}/env`)).envs);
const notInGithub = new Map(); // key -> account ids
for (const [acct, envs] of haves) for (const e of envs) {
  if (NOT_SYNCED(e.key) || keys.has(e.key)) continue;
  notInGithub.set(e.key, [...new Set([...(notInGithub.get(e.key) ?? []), acct.id])]);
}

// 3. What each serving account is RUNNING against GitHub. Sensitive values can't be
// read back from Vercel, so the deployments report fingerprints (/api/env-fingerprint).
const cron = github.CRON_SECRET;
const fp = (v) => createHmac("sha256", cron).update(v).digest("hex").slice(0, 16);
let drift = 0;
if (!cron) console.log("RUNNING CHECK SKIPPED: no CRON_SECRET in GitHub");
else for (const acct of ACCOUNTS) {
  const { alias, healthy } = await inspect(acct).catch(() => ({ healthy: false }));
  if (!healthy) { console.log(`${acct.id}: not serving, not checked`); continue; }
  const res = await fetch(`https://${alias}/api/env-fingerprint?keys=${[...keys].join(",")}`, { headers: { Authorization: `Bearer ${cron}` } }).catch(() => null);
  if (res?.status === 401) { console.log(`${acct.id}: runs a different CRON_SECRET from GitHub's`); drift++; continue; }
  if (!res?.ok) { console.log(`${acct.id}: running check unavailable (${res?.status ?? "no answer"})`); continue; }
  const { fingerprints } = await res.json();
  const off = wanted.filter((w) => fingerprints[w.key] !== fp(w.value)).map((w) => w.key);
  console.log(`${acct.id}: ${off.length ? `runs a DIFFERENT value for ${off.join(", ")} — a real run overwrites it with GitHub's` : "runs exactly GitHub's values"}`);
  if (off.length) drift++;
}

if (notInGithub.size) {
  console.log(`\nNOT IN GITHUB — add each as a secret of the same name (Settings → Secrets and variables → Actions), or delete it from the account if nothing uses it:`);
  for (const [k, ids] of notInGithub) console.log(`  ${k}   (on ${ids.join(", ")})`);
  if (!DRY) { console.log("\nNothing written: the GitHub copy is incomplete."); process.exit(1); }
}

// 4. Write every account: update the existing entry, create where it has none.
let failed = 0;
for (const [acct, have] of haves) {
  let updated = 0, created = 0;
  for (const w of wanted) {
    const hit = have.find((e) => e.key === w.key && e.target.includes("production"));
    if (DRY) { hit ? updated++ : created++; continue; }
    try {
      if (hit) { await api(acct, "PATCH", `/v9/projects/${acct.project}/env/${hit.id}`, { value: w.value }); updated++; }
      else { await api(acct, "POST", `/v10/projects/${acct.project}/env`, { ...w, target: ["production", "preview"], type: "sensitive" }); created++; }
    } catch (e) { failed++; console.log(`  ${acct.id} ${w.key}: ${e.message}`); }
  }
  console.log(`${acct.id}: ${updated} updated, ${created} created${DRY ? " (dry run)" : ""}`);
}

// 5. Settings are baked in at build time: rebuild every serving account's
// current production deployment so the values take effect.
if (!DRY && process.env.REDEPLOY !== "false") {
  for (const acct of ACCOUNTS) {
    if (!(await inspect(acct).catch(() => ({ healthy: false }))).healthy) { console.log(`${acct.id}: not serving, no redeploy`); continue; }
    const { id } = await api(acct, "GET", `/v9/projects/${acct.project}`);
    const [last] = (await api(acct, "GET", `/v6/deployments?projectId=${id}&target=production&state=READY&limit=1`)).deployments;
    if (!last) { console.log(`${acct.id}: no production deployment to rebuild`); continue; }
    await api(acct, "POST", `/v13/deployments?forceNew=1`, { name: acct.project, deploymentId: last.uid, target: "production" });
    console.log(`${acct.id}: redeploying`);
  }
}
// A dry run goes red when anything needs doing, so the run list shows it.
if (failed || (DRY && (notInGithub.size || drift))) process.exit(1);
