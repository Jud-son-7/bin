// Run: node test.mjs   (checks the message text and the "only on change" rule)
import assert from "node:assert/strict";
import { newlyFull } from "../../app/src/bins.js";

const b = (id, state) => ({ id, state });
assert.deepEqual(newlyFull(null, [b("a", "full")]), []);                      // startup: no spam
assert.deepEqual(newlyFull([b("a", "idle")], [b("a", "full")]), ["a"]);       // turns full: notify
assert.deepEqual(newlyFull([b("a", "full")], [b("a", "full")]), []);          // still full: silent
assert.deepEqual(newlyFull([b("a", "full")], [b("a", "idle")]), []);          // emptied: silent
console.log("notifier rules OK");
