// Run: npx tsx scripts/standby.test.mts — no network.
// A backup ping idles only while the movable domain's beat is fresh; its own beat
// never counts, and a stale or unreadable hash means "take over".
import assert from "node:assert/strict";
import { primaryFresh, beatId } from "../src/lib/smart-log-kv";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

assert.equal(beatId("diag-logistics.vercel.app"), "diag-logistics");
assert.equal(beatId("Diag-BO.vercel.app:443"), "diag-bo");
assert.equal(primaryFresh({ "diag-logistics": ago(1), "diag-bo": ago(0) }), true, "holder fresh → idle");
assert.equal(primaryFresh({ "diag-logistics": ago(9), "diag-bo": ago(0) }), false, "holder stale → take over");
assert.equal(primaryFresh({ "diag-bo": ago(0) }), false, "own beat never counts");
assert.equal(primaryFresh(null), false, "unreadable → take over");
assert.equal(primaryFresh({ "diag-logistics": "garbage" }), false, "unparseable beat ignored");
console.log("standby: ok");
