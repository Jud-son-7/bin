#!/usr/bin/env node
// Writes fake bins into Firestore using the SAME fields and document ids as the real
// MQTT bridge (see backend/README_backend.md), so the website can be tested live
// without a broker or an ESP32.
//
//   node seed.js                one-off: write a few bins
//   node seed.js --loop         keep going: bin-001 fills, goes full, then is emptied
//   node seed.js --full bin-014 set one bin to full right now (to trigger the alert)
//   node seed.js --empty bin-014  set one bin back to idle (emptied)
//   node seed.js --clear        delete the demo bins (ids starting "bin-")
//   node seed.js --dry-run      only validate and print, no Firebase needed
//
// Login once with:  gcloud auth application-default login
//                   gcloud config set project bin-project-ed93a

const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");

const PROJECT_ID = "bin-project-ed93a";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dryRun = flag("--dry-run");

// Validate every message against the team contract, like the real bridge does.
const schemaPath = [
  path.join(__dirname, "../../contract/telemetry.schema.json"),
  path.join(__dirname, "telemetry.schema.json"),
].find((p) => fs.existsSync(p));
if (!schemaPath) {
  console.error("Can't find contract/telemetry.schema.json. Run this from inside the repo.");
  process.exit(1);
}
const validate = new Ajv2020().compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));

const msg = (bin_id, state, compactions_since_empty, weight) => ({ bin_id, state, compactions_since_empty, weight });

const START = [
  msg("bin-001", "idle", 0, 3.2),
  msg("bin-014", "compacting", 2, 14.6),
  msg("bin-067", "full", 10, 21.8),
  msg("bin-090", "idle", 1, 5.0),
];

let db = null;
let admin = null;
if (!dryRun) {
  admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  db = admin.firestore();
}

async function write(m) {
  if (!validate(m)) {
    console.error("Invalid message, not written:", JSON.stringify(m), validate.errors.map((e) => e.message).join("; "));
    return;
  }
  const doc = {
    state: m.state,
    weight: m.weight,
    compactions_since_empty: m.compactions_since_empty,
  };
  if (dryRun) {
    console.log(`[dry-run] bins/${m.bin_id}`, JSON.stringify(doc), "+ last_seen=serverTimestamp");
    return;
  }
  await db.collection("bins").doc(m.bin_id).set({ ...doc, last_seen: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  console.log(`wrote bins/${m.bin_id}: ${m.state}, ${m.weight} kg, ${m.compactions_since_empty} compactions`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (flag("--clear")) {
    if (dryRun) return console.log("[dry-run] would delete all docs whose id starts with 'bin-'");
    const snap = await db.collection("bins").get();
    for (const d of snap.docs) if (d.id.startsWith("bin-")) { await d.ref.delete(); console.log("deleted", d.id); }
    return;
  }
  if (arg("--full")) return write(msg(arg("--full"), "full", 10, 21.8));
  if (arg("--empty")) return write(msg(arg("--empty"), "idle", 0, 2.5));

  for (const m of START) await write(m);

  if (flag("--loop")) {
    console.log("Looping. bin-001 will fill, go full, then be emptied. Ctrl+C to stop.");
    const cycle = [
      msg("bin-001", "compacting", 3, 15.0),
      msg("bin-001", "full", 10, 22.1),
      msg("bin-001", "full", 10, 22.1), // repeat = duplicate MQTT delivery, must not re-alert
      msg("bin-001", "idle", 0, 2.5),
    ];
    for (;;) for (const m of cycle) { await sleep(8000); await write(m); }
  }
}

main().then(() => { if (!flag("--loop")) process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
