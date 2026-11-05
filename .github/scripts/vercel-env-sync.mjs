// Copies one account's environment variables to the others, so three accounts carry
// identical settings and are edited in ONE place. Run by hand from
// .github/workflows/vercel-env-sync.yml.
//
// The source account is the master copy: its key set is the key set. Values Vercel
// will not hand back (type "sensitive") come from a GitHub secret of the same name
// instead, and only those — a GitHub secret never overrides a value the source can
// show, so a stale copy kept for another workflow cannot clobber production.
// Values are never printed.
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
console.log(`source ${source.id}: ${wanted.length} to copy`);
if (missing.length) console.log(`NOT COPIED (sensitive on ${source.id}, no GitHub secret of that name): ${missing.join(", ")}`);

// 2. Write each other account: update where the key+targets exist, create otherwise.
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

// 3. Settings are baked in at build time: rebuild every serving account's
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
if (failed) process.exit(1);
