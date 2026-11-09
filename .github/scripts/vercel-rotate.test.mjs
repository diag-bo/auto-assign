// Run: node .github/scripts/vercel-rotate.test.mjs — no network.
import assert from "node:assert/strict";
import { plan, TURN_MS } from "./vercel-rotate.mjs";

const ids = ["C", "D", "B", "A"];
const all = new Set(ids);
const DAY = 86_400_000;
const p = (o) => plan({ ids, healthy: all, hour: 3, force: "", heldMs: 2 * DAY, ...o });

assert.equal(p({ holder: "C" }), null, "mid-turn → stay");
assert.equal(p({ holder: "C", heldMs: 8 * DAY }), "D", "turn over at night");
assert.equal(p({ holder: "C", heldMs: TURN_MS }), "D", "slack: an hour-early night still hands over");
assert.equal(p({ holder: "C", heldMs: 8 * DAY, hour: 9 }), null, "never by day");
assert.equal(p({ holder: "A", heldMs: 8 * DAY }), "C", "wraps round");
const cd = new Set(["C", "D"]);
assert.equal(p({ holder: "D", heldMs: 8 * DAY, healthy: cd }), "C", "B and A paused → skipped, round robin over C and D");
assert.equal(p({ holder: "C", heldMs: 8 * DAY, healthy: cd }), "D", "…and back");
assert.equal(p({ holder: "C", heldMs: 30 * DAY, healthy: new Set(["C"]) }), null, "only the holder healthy → stay");
assert.equal(p({ holder: "C", hour: 14, healthy: new Set(["B", "A"]) }), "B", "holder paused → move now, next in order");
assert.equal(p({ holder: null }), "C", "nobody holds it → first healthy");
assert.equal(p({ holder: "C", healthy: new Set() }), null, "nothing healthy → stay");
assert.equal(p({ holder: "C", heldMs: NaN, healthy: all }), null, "unknown hold time → no planned move");
assert.equal(p({ holder: "C", hour: 14, force: "B" }), "B", "manual move any time");
assert.equal(p({ holder: "C", force: "A", healthy: new Set(["C"]) }), null, "manual move never into a paused account");
console.log("vercel-rotate: ok");
