// Run: npx tsx scripts/engine-trial.test.mts — no network.
import assert from "node:assert/strict";
import { classifyRequest, fingerprint, inTrial, noteFingerprint } from "../src/lib/engine-trial";
import type { Job } from "../src/lib/types";

const RPC = "https://fleetweb-vn.cartrack.com/jsonrpc/index.php";
const rpc = (method: string) => JSON.stringify({ version: "2.0", method, id: 1, params: {} });

assert.equal(classifyRequest(RPC, "POST", rpc("delivery_timeline_route_list")), null, "timeline list is a read");
assert.equal(classifyRequest(RPC, "POST", rpc("delivery_get_job_details")), null, "get is a read");
assert.equal(classifyRequest(RPC, "POST", rpc("ct_login")), null, "login is not work");
assert.equal(classifyRequest(RPC, "POST", rpc("delivery_route_slice_jobs_assign")), "rpc:delivery_route_slice_jobs_assign");
assert.equal(classifyRequest("https://fleetapi-vn.cartrack.com/rest/delivery/jobs/1", "PUT", ""), "rest:PUT");
assert.equal(classifyRequest("https://fleetapi-vn.cartrack.com/rest/delivery/jobs", "GET", ""), null);
assert.equal(classifyRequest("https://whole-leech-134012.upstash.io/pipeline", "POST", "[]"), null, "Redis never counts");
assert.equal(classifyRequest("https://x.supabase.co/rest/v1/t", "POST", "[]"), "supabase");
assert.equal(classifyRequest("https://bot-api.zaloplatforms.com/botX/sendMessage", "POST", "{}"), "zalo");

// Counting follows the cycle only.
globalThis.fetch = (async () => new Response("{}")) as typeof fetch;
const { trial } = await inTrial(async () => {
  await fetch(RPC, { method: "POST", body: rpc("delivery_reject_job") });
  await fetch(RPC, { method: "POST", body: rpc("delivery_jobs_list_new") });
});
await fetch(RPC, { method: "POST", body: rpc("delivery_reject_job") }); // outside: not counted
assert.deepEqual(trial.writes, { "rpc:delivery_reject_job": 1 });
assert.equal(trial.fetchCpuMs, null, "no fingerprint taken, no floor recorded");

// The floor is taken when the fingerprint is.
const { trial: t2 } = await inTrial(async () => { noteFingerprint([], [], "p", []); });
assert.ok(typeof t2.fetchCpuMs === "number" && t2.fetchCpuMs >= 0);
assert.ok(typeof t2.fetchWallMs === "number" && t2.fetchWallMs >= 0);

// Order and GPS do not move the fingerprint; a stop status does.
const job = (id: number, status = 1, lat = 10): Job => ({
  job_id: id, job_status_id: 4, delivery_driver_id: "d",
  stops: [{ stop_id: id * 10, stop_type_id: 1, stop_status_id: status, customer_id: "c", latitude: lat }],
});
const base = fingerprint([], [job(1), job(2)], "p", []);
assert.equal(fingerprint([], [job(2), job(1)], "p", []), base, "order ignored");
assert.equal(fingerprint([], [job(1, 1, 11), job(2)], "p", []), base, "GPS ignored");
assert.notEqual(fingerprint([], [job(1, 3), job(2)], "p", []), base, "stop status counts");
assert.notEqual(fingerprint([], [job(1), job(2)], "p2", []), base, "config version counts");
console.log("engine-trial: ok");
