// Run: npx tsx scripts/config-row-match.test.mts
import assert from "node:assert/strict";
import { parseConfigRowSnapshot } from "../src/lib/config-row-match";

const original = { rule_id: 7, revision: 3, driver: "Nguyễn Văn An", start: "07:00", end: "12:00", dropoff: "" };
assert.deepEqual(parseConfigRowSnapshot(original), original);
assert.equal(parseConfigRowSnapshot({ ...original, rule_id: undefined }), null, "a rule is identified by its id");
assert.equal(parseConfigRowSnapshot({ ...original, revision: "3" }), null, "and its revision");
assert.equal(parseConfigRowSnapshot({ ...original, driver: 1 }), null);
assert.equal(parseConfigRowSnapshot(null), null);
console.log("Config rule snapshots require id + revision.");
