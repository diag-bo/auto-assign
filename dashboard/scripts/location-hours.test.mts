import assert from "node:assert/strict";
import { cleanWeekHours, summarizeWeekHours } from "../src/lib/location-hours";

const ok = (raw: unknown) => {
  const r = cleanWeekHours(raw);
  assert.ok("hours" in r, JSON.stringify(r));
  return r.hours;
};
const bad = (raw: unknown) => assert.ok("error" in cleanWeekHours(raw), JSON.stringify(raw));

// Everything optional: empty week, blank days, blank fields all dropped.
assert.deepEqual(ok({}), {});
assert.deepEqual(ok({ "1": { open: "", close: " " }, "2": null }), {});
assert.deepEqual(ok({ "3": { open: "07:00" } }), { "3": { open: "07:00" } });
// Closed wins over any hours left in the row.
assert.deepEqual(ok({ "7": { closed: true, open: "07:00" } }), { "7": { closed: true } });

bad({ "8": { open: "07:00" } });
bad({ "1": { open: "7:00" } });
bad({ "1": { open: "17:00", close: "07:00" } });
bad({ "1": { break_from: "12:00" } });
bad({ "1": { open: "07:00", close: "17:00", break_from: "13:00", break_to: "12:00" } });
bad({ "1": { open: "07:00", close: "11:00", break_from: "12:00", break_to: "13:00" } });
bad([]);

const wk = { open: "07:00", close: "17:00", break_from: "12:00", break_to: "13:00" };
assert.equal(
  summarizeWeekHours({ "1": wk, "2": wk, "3": wk, "4": wk, "5": wk, "6": { open: "07:00", close: "11:30" }, "7": { closed: true } }),
  "T2–T6 07:00–17:00 (nghỉ 12:00–13:00) · T7 07:00–11:30 · CN nghỉ",
);
assert.equal(summarizeWeekHours({ "1": wk, "3": wk }), "T2 07:00–17:00 (nghỉ 12:00–13:00) · T4 07:00–17:00 (nghỉ 12:00–13:00)");
assert.equal(summarizeWeekHours({}), "");
console.log("location-hours: ok");
