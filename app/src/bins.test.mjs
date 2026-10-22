// Run: node src/bins.test.mjs
import assert from "node:assert/strict";
import { newlyFull, isStale, needsCollection } from "./bins.js";

const b = (id, state, ageMs = 0) => ({ id, state, last_seen: new Date(Date.now() - ageMs) });

// first snapshot never alerts
assert.deepEqual(newlyFull(null, [b("a", "full")]), []);
// idle -> full alerts once
assert.deepEqual(newlyFull([b("a", "idle")], [b("a", "full")]), ["a"]);
// already full does not alert again (duplicate / retained messages)
assert.deepEqual(newlyFull([b("a", "full")], [b("a", "full")]), []);
// compacting -> full alerts
assert.deepEqual(newlyFull([b("a", "compacting")], [b("a", "full")]), ["a"]);
// full -> idle (emptied) then full again alerts again
assert.deepEqual(newlyFull([b("a", "idle")], [b("a", "full")]), ["a"]);
// a brand new bin that appears already full alerts
assert.deepEqual(newlyFull([b("a", "idle")], [b("a", "idle"), b("c", "full")]), ["c"]);
// compacting is not "needs collection"
assert.equal(needsCollection(b("a", "compacting")), false);
// staleness
assert.equal(isStale(b("a", "idle", 10 * 60 * 1000)), true);
assert.equal(isStale(b("a", "idle", 5000)), false);
assert.equal(isStale({ id: "a", state: "idle" }), true); // missing last_seen

// bridge reported offline (MQTT Last Will) => stale even if last_seen is recent
assert.equal(isStale({ ...b("a", "idle", 1000), online: false }), true);
assert.equal(isStale({ ...b("a", "idle", 1000), online: true }), false);

console.log("bins.js tests passed");
