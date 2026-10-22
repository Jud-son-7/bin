// MQTT -> Firestore bridge for the smart bins.
//
//   ESP32 --MQTT--> Mosquitto --> this file --Admin SDK--> Firestore --> website
//
// Run:      node index.js            (needs Mosquitto running and gcloud login, see README_backend.md)
// Dry run:  DRY_RUN=1 node index.js  (no Firebase, only prints what it would write)
//
// Topics (contract/README.md):
//   bins/<bin_id>/telemetry   JSON, validated against contract/telemetry.schema.json
//   bins/<bin_id>/status      plain text "online" / "offline"

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const Ajv2020 = require("ajv/dist/2020"); // the schema is JSON Schema draft 2020-12

const MQTT_URL = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "bin-project-ed93a";
const DRY_RUN = process.env.DRY_RUN === "1";

const schemaPath = [
  path.join(__dirname, "../contract/telemetry.schema.json"),
  path.join(__dirname, "telemetry.schema.json"),
].find((p) => fs.existsSync(p));
if (!schemaPath) {
  console.error("Can't find contract/telemetry.schema.json");
  process.exit(1);
}
const validate = new Ajv2020().compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));

let admin = null;
let db = null;
if (!DRY_RUN) {
  admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  db = admin.firestore();
}

async function save(binId, fields) {
  if (DRY_RUN) {
    console.log(`[dry-run] bins/${binId}`, JSON.stringify(fields), "+ last_seen");
    return;
  }
  await db
    .collection("bins")
    .doc(binId)
    .set({ ...fields, last_seen: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  console.log("Firebase updated successfully:", binId);
}

async function onTelemetry(binId, payload) {
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return console.error(`Bad JSON on bins/${binId}/telemetry, ignored`);
  }
  if (!validate(data)) {
    const why = validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    return console.error(`Rejected telemetry for ${binId}: ${why}`);
  }
  if (data.bin_id !== binId) {
    return console.error(`Rejected: bin_id "${data.bin_id}" does not match topic "${binId}"`);
  }
  // A telemetry message proves the bin is alive right now.
  await save(binId, {
    state: data.state,
    weight: data.weight,
    compactions_since_empty: data.compactions_since_empty,
    online: true,
  });
}

async function onStatus(binId, payload) {
  const text = payload.toString().trim().toLowerCase();
  if (text !== "online" && text !== "offline") {
    return console.error(`Ignored status "${text}" for ${binId}`);
  }
  await save(binId, { online: text === "online" });
}

const client = mqtt.connect(MQTT_URL);

client.on("connect", () => {
  console.log(`Connected to MQTT broker at ${MQTT_URL}${DRY_RUN ? " (dry run, not writing to Firebase)" : ""}`);
  client.subscribe(["bins/+/telemetry", "bins/+/status"], { qos: 1 }, (err) => {
    if (err) return console.error("Subscribe failed:", err.message);
    console.log("Listening for smart bin data...");
  });
});

client.on("message", (topic, payload) => {
  const [root, binId, kind] = topic.split("/");
  if (root !== "bins" || !binId) return;
  const job = kind === "telemetry" ? onTelemetry(binId, payload) : kind === "status" ? onStatus(binId, payload) : null;
  if (job) job.catch((e) => console.error(`Firestore write failed for ${binId}: ${e.message}`));
});

client.on("reconnect", () => console.log("Reconnecting to MQTT broker..."));
client.on("error", (e) => console.error("MQTT error:", e.message));
