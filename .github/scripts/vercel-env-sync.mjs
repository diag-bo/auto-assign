// Copies one account's environment variables to the others, so three accounts carry
// identical settings and are edited in ONE place. Run by hand from
// .github/workflows/vercel-env-sync.yml.
//
// The source account is the master copy: its key set is the key set. Values Vercel
// will not hand back (type "sensitive") come from a GitHub secret of the same name
// instead, and only those — a GitHub secret never overrides a value the source can
// show, so a stale copy kept for another workflow cannot clobber production.
// Values are never printed.
import { createHmac } from "node:crypto";
import { ACCOUNTS, api, inspect } from "./vercel-accounts.mjs";

const SKIP = new Set(["STANDBY", "DEPLOY_ID"]); // retired per-account switches
const DRY = process.env.DRY_RUN === "true";
const github = JSON.parse(process.env.SECRETS_JSON || "{}");
const source = ACCOUNTS.find((a) => a.id === (process.env.SOURCE || "C").toUpperCase());
if (!source) throw new Error(`unknown source ${process.env.SOURCE}`);

const tkey = (t) => [...t].sort().join("+");

// 1. The master copy.
const { envs } = await api(source, "GET", `/v10/projects/${source.project}/env`);
const wanted = [];
const missing = [];
for (const e of envs) {
  if (SKIP.has(e.key) || e.key.startsWith("VERCEL_")) continue;
  let value;
  if (e.type === "sensitive") value = github[e.key];
  else value = (await api(source, "GET", `/v1/projects/${source.project}/env/${e.id}`)).value;
  if (value === undefined || value === null) { missing.push(e.key); continue; }
  wanted.push({ key: e.key, value, target: e.target, type: e.type === "sensitive" ? "sensitive" : "encrypted" });
}
console.log(`source ${source.id}: ${wanted.length} to copy`);

// 2. What each serving account is RUNNING, against the master copy. Sensitive values
// can't be read back from any account, so the deployments report fingerprints
// (/api/env-fingerprint). This is what catches a stale GitHub secret: the source
// itself then disagrees with the copy the sync would spread.
const cron = wanted.find((w) => w.key === "CRON_SECRET")?.value;
const prodKeys = [...new Set(envs.filter((e) => e.target.includes("production") && !SKIP.has(e.key) && !e.key.startsWith("VERCEL_")).map((e) => e.key))];
const fp = (v) => createHmac("sha256", cron).update(v).digest("hex").slice(0, 16);
const expected = new Map(wanted.filter((w) => w.target.includes("production")).map((w) => [w.key, fp(w.value)]));
const sensitive = new Set(envs.filter((e) => e.type === "sensitive").map((e) => e.key));
const drift = [];
let staleSecrets = [];
if (!cron) console.log("RUNNING CHECK SKIPPED: CRON_SECRET is sensitive on the source and has no GitHub secret");
// Source first: for a key with no master value (sensitive, no GitHub secret) the
// others are compared with what the SOURCE runs.
else for (const acct of [source, ...ACCOUNTS.filter((a) => a !== source)]) {
  const { alias, healthy } = await inspect(acct).catch(() => ({ healthy: false }));
  if (!healthy) { console.log(`${acct.id}: not serving, not checked`); continue; }
  const res = await fetch(`https://${alias}/api/env-fingerprint?keys=${prodKeys.join(",")}`, { headers: { Authorization: `Bearer ${cron}` } }).catch(() => null);
  if (res?.status === 401) { console.log(`${acct.id}: running CRON_SECRET differs from the master copy`); drift.push(acct.id); continue; }
  if (!res?.ok) { console.log(`${acct.id}: running check unavailable (${res?.status ?? "no answer"}; deployed before /api/env-fingerprint?)`); continue; }
  const { fingerprints } = await res.json();
  const off = prodKeys.filter((k) => expected.has(k) ? fingerprints[k] !== expected.get(k) : fingerprints[k] === null);
  console.log(`${acct.id}: running ${off.length ? `DIFFERS on ${off.join(", ")}` : "matches the master copy"}`);
  if (off.length) drift.push(acct.id);
  // The source running a sensitive value its GitHub secret doesn't match = the secret
  // is stale, and copying it would spread the wrong value to every account.
  if (acct === source) {
    staleSecrets = off.filter((k) => sensitive.has(k) && expected.has(k));
    for (const k of prodKeys) if (!expected.has(k) && fingerprints[k]) expected.set(k, fingerprints[k]);
  }
}

if (missing.length) {
  console.log(`\nMISSING GITHUB SECRETS (sensitive on ${source.id}; add each under Settings → Secrets and variables → Actions, same name):`);
  for (const k of missing) console.log(`  ${k}`);
}
if (staleSecrets.length) {
  console.log(`\nSTALE GITHUB SECRETS (${source.id} runs a different value; fix the secret, or ${source.id} if it was never rebuilt):`);
  for (const k of staleSecrets) console.log(`  ${k}`);
}
// A partial or stale copy is how an account ends up wrong, so refuse it whole.
if ((missing.length || staleSecrets.length) && !DRY) { console.log("\nNothing written: fix the secrets above first."); process.exit(1); }

// 3. Write each other account: update where the key+targets exist, create otherwise.
let failed = 0;
for (const acct of ACCOUNTS.filter((a) => a !== source)) {
  const have = (await api(acct, "GET", `/v10/projects/${acct.project}/env`)).envs;
  const byKey = new Map(have.map((e) => [`${e.key}|${tkey(e.target)}`, e]));
  let updated = 0, created = 0;
  for (const w of wanted) {
    const hit = byKey.get(`${w.key}|${tkey(w.target)}`);
    if (DRY) { hit ? updated++ : created++; continue; }
    try {
      if (hit) { await api(acct, "PATCH", `/v9/projects/${acct.project}/env/${hit.id}`, { value: w.value }); updated++; }
      else { await api(acct, "POST", `/v10/projects/${acct.project}/env`, w); created++; }
    } catch (e) { failed++; console.log(`  ${acct.id} ${w.key}: ${e.message}`); }
  }
  const extra = have.filter((e) => !wanted.some((w) => w.key === e.key) && !missing.includes(e.key)).map((e) => e.key);
  console.log(`${acct.id}: ${updated} updated, ${created} created${DRY ? " (dry run)" : ""}${extra.length ? `; only here: ${extra.join(", ")}` : ""}`);
}

// 4. Settings are baked in at build time: rebuild every serving account's
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
if (failed || (DRY && (missing.length || staleSecrets.length || drift.length))) process.exit(1);
