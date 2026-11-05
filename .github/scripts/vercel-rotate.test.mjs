// Run: node .github/scripts/vercel-rotate.test.mjs — no network.
import assert from "node:assert/strict";
import { plan } from "./vercel-rotate.mjs";

const ids = ["C", "A", "B"];
const all = new Set(ids);
const p = (o) => plan({ ids, healthy: all, hour: 3, force: "", ...o });

assert.equal(p({ holder: "C", day: 5 }), null, "its turn → stay");
assert.equal(p({ holder: "C", day: 11 }), "A", "turn over at night");
assert.equal(p({ holder: "C", day: 11, hour: 9 }), null, "never by day");
assert.equal(p({ holder: "A", day: 25 }), "B", "third slot");
assert.equal(p({ holder: "B", day: 31 }), null, "31st stays in the third slot");
assert.equal(p({ holder: "C", day: 12, healthy: new Set(["C", "B"]) }), null, "turn paused → holder keeps it");
assert.equal(p({ holder: "C", day: 5, hour: 14, healthy: new Set(["A", "B"]) }), "A", "holder paused → move now, next in order");
assert.equal(p({ holder: "A", day: 15, hour: 14, healthy: new Set(["C", "B"]) }), "B", "desired is the paused holder → next healthy");
assert.equal(p({ holder: null, day: 5 }), "C", "nobody holds it → desired");
assert.equal(p({ holder: "C", day: 5, healthy: new Set() }), null, "nothing healthy → stay");
assert.equal(p({ holder: "C", day: 5, hour: 14, force: "B" }), "B", "manual move any time");
assert.equal(p({ holder: "C", day: 5, force: "A", healthy: new Set(["C"]) }), null, "manual move never into a paused account");
console.log("vercel-rotate: ok");
