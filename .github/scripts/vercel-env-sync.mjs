// Copies one account's environment variables to the others, so three accounts carry
// identical settings and are edited in ONE place. Run by hand from
// .github/workflows/vercel-env-sync.yml.
//
// The source account is the master copy: its key set is the key set. Values Vercel
// will not hand back (type "sensitive") come from a GitHub secret of the same name
// instead, and only those — a GitHub secret never overrides a value the source can
// show, so a stale copy kept for another workflow cannot clobber production.
// Except ENV_<KEY>: a GitHub secret with that prefix IS <KEY> on every account.
// Values are never printed.
import { createHmac } from "node:crypto";
import { ACCOUNTS, api, inspect } from "./vercel-accounts.mjs";

const SKIP = new Set(["STANDBY", "DEPLOY_ID"]); // retired per-account switches
const DRY = process.env.DRY_RUN === "true";
const github = JSON.parse(process.env.SECRETS_JSON || "{}");
const source = ACCOUNTS.find((a) => a.id === (process.env.SOURCE || "B").toUpperCase());
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

// A GitHub secret named ENV_<KEY> is <KEY> on EVERY account and beats the source's
// copy: the one place that doesn't move when the accounts do. The prefix keeps the
// secrets other workflows hold (KV_REST_API_*, GOONG_*…) from leaking into the app.
const PREFIX = "ENV_";
const fromGithub = Object.keys(github).filter((k) => k.startsWith(PREFIX) && k.length > PREFIX.length).map((k) => k.slice(PREFIX.length));
for (const key of fromGithub) {
  const i = wanted.findIndex((w) => w.key === key);
  const target = (i >= 0 ? wanted[i].target : envs.find((e) => e.key === key)?.target) ?? ["production", "preview"];
  if (i >= 0) wanted.splice(i, 1);
  wanted.push({ key, value: github[PREFIX + key], target: target.filter((t) => t !== "development"), type: "sensitive" });
}
missing.splice(0, missing.length, ...missing.filter((k) => !fromGithub.includes(k)));
console.log(`source ${source.id}: ${wanted.length} to copy${fromGithub.length ? ` (${fromGithub.length} from GitHub ${PREFIX}*: ${fromGithub.join(", ")})` : ""}`);

// 2. What each serving account is RUNNING, against the master copy. Sensitive values
// can't be read back from any account, so the deployments report fingerprints
// (/api/env-fingerprint). This is what catches a stale GitHub secret: the source
// itself then disagrees with the copy the sync would spread.
const cron = wanted.find((w) => w.key === "CRON_SECRET")?.value;
const prodKeys = [...new Set(envs.filter((e) => e.target.includes("production") && !SKIP.has(e.key) && !e.key.startsWith("VERCEL_")).map((e) => e.key)), ...fromGithub.filter((k) => !envs.some((e) => e.key === k))];
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
  if (acct === source) staleSecrets = off.filter((k) => sensitive.has(k) && expected.has(k) && !fromGithub.includes(k));
  // A key with no master value (sensitive, no GitHub secret): the first serving
  // account (the source when it serves) is the reference the rest must agree with.
  for (const k of prodKeys) if (!expected.has(k) && fingerprints[k]) expected.set(k, fingerprints[k]);
}

// A sensitive key with no GitHub secret can't be copied. Harmless where an account
// already has it (left as it is, and the running check above compares it); a GAP
// where an account lacks it — which is how a new account ends up broken.
const targets = ACCOUNTS.filter((a) => a !== source);
const haves = new Map([[source, envs]]);
for (const acct of targets) haves.set(acct, (await api(acct, "GET", `/v10/projects/${acct.project}/env`)).envs);
const gaps = missing.map((k) => [k, targets.filter((a) => !haves.get(a).some((e) => e.key === k)).map((a) => a.id)]).filter(([, ids]) => ids.length);
const kept = missing.filter((k) => !gaps.some(([g]) => g === k));
if (kept.length) console.log(`\nNot copied, each account keeps its own (sensitive on ${source.id}, no GitHub secret): ${kept.join(", ")}`);
if (gaps.length) {
  console.log(`\nNEEDED — sensitive on ${source.id} with no GitHub secret, and missing on an account. Add a GitHub secret named ${PREFIX}<KEY> (Settings → Secrets and variables → Actions), or re-save it on ${source.id} as not sensitive:`);
  for (const [k, ids] of gaps) console.log(`  ${k}   (missing on ${ids.join(", ")})`);
}
if (staleSecrets.length) {
  console.log(`\nSTALE GITHUB SECRETS (${source.id} runs a different value; fix the secret, or ${source.id} if it was never rebuilt):`);
  for (const k of staleSecrets) console.log(`  ${k}`);
}
// A gap or a stale copy is how an account ends up wrong, so refuse it whole.
if ((gaps.length || staleSecrets.length) && !DRY) { console.log("\nNothing written: fix the list above first."); process.exit(1); }

// 3. Write each account: update where the key+targets exist, create otherwise. The
// source gets only the GitHub ENV_* keys — everything else came from it.
let failed = 0;
for (const acct of [...targets, source]) {
  const have = haves.get(acct);
  const byKey = new Map(have.map((e) => [`${e.key}|${tkey(e.target)}`, e]));
  const list = acct === source ? wanted.filter((w) => fromGithub.includes(w.key)) : wanted;
  if (!list.length) continue;
  let updated = 0, created = 0;
  for (const w of list) {
    const hit = byKey.get(`${w.key}|${tkey(w.target)}`) ?? have.find((e) => e.key === w.key && e.target.includes("production"));
    if (DRY) { hit ? updated++ : created++; continue; }
    try {
      if (hit) { await api(acct, "PATCH", `/v9/projects/${acct.project}/env/${hit.id}`, { value: w.value }); updated++; }
      else { await api(acct, "POST", `/v10/projects/${acct.project}/env`, w); created++; }
    } catch (e) { failed++; console.log(`  ${acct.id} ${w.key}: ${e.message}`); }
  }
  const extra = acct === source ? [] : have.filter((e) => !wanted.some((w) => w.key === e.key) && !missing.includes(e.key)).map((e) => e.key);
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
if (failed || (DRY && (gaps.length || staleSecrets.length || drift.length))) process.exit(1);
