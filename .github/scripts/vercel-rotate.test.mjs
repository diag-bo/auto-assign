// Run: node .github/scripts/vercel-rotate.test.mjs — no network.
import assert from "node:assert/strict";
import { plan } from "./vercel-rotate.mjs";

const ids = ["C", "D", "B", "A"];
const all = new Set(ids);
const p = (o) => plan({ ids, healthy: all, hour: 3, force: "", ...o });

assert.equal(p({ holder: "C", day: 5 }), null, "its turn → stay");
assert.equal(p({ holder: "C", day: 8 }), null, "day 8 is still C's");
assert.equal(p({ holder: "C", day: 9 }), "D", "turn over at night");
assert.equal(p({ holder: "C", day: 9, hour: 9 }), null, "never by day");
assert.equal(p({ holder: "D", day: 17 }), "B", "third turn");
assert.equal(p({ holder: "B", day: 25 }), "A", "fourth turn");
assert.equal(p({ holder: "A", day: 31 }), null, "31st stays in the last turn");
assert.equal(p({ holder: "D", day: 17, healthy: new Set(["C", "D"]) }), "C", "B and A paused → turn passes on, not kept by the holder");
assert.equal(p({ holder: "C", day: 17, healthy: new Set(["C", "D"]) }), null, "…and stays there");
assert.equal(p({ holder: "C", day: 5, hour: 14, healthy: new Set(["D", "B"]) }), "D", "holder paused → move now, next in order");
assert.equal(p({ holder: null, day: 5 }), "C", "nobody holds it → its turn");
assert.equal(p({ holder: "C", day: 5, healthy: new Set() }), null, "nothing healthy → stay");
assert.equal(p({ holder: "C", day: 5, hour: 14, force: "B" }), "B", "manual move any time");
assert.equal(p({ holder: "C", day: 5, force: "A", healthy: new Set(["C"]) }), null, "manual move never into a paused account");
assert.equal(plan({ ids: ["C", "D", "B"], holder: "C", healthy: new Set(["C", "D", "B"]), day: 12, hour: 3, force: "" }), "D", "three accounts: 1–11, 12–22, 23–end");
console.log("vercel-rotate: ok");
