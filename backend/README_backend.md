# Bin Watch — Backend, MQTT Broker & Firebase

> **Team handoff / development README**  
> This document describes the backend and database architecture implemented for the smart bin prototype, how to run it locally, and the interface for the teammate connecting Firestore to the Bin Watch website.

## 1. Overview

Bin Watch monitors smart rubbish bins and shows cleaners when a bin needs collection. The ESP32 firmware publishes telemetry using MQTT. A Node.js bridge receives and validates those messages and stores the latest reading in Google Cloud Firestore. The staff website will read the Firestore data and display live bin status.

```text
ESP32 + sensors
    | MQTT publish (QoS 1, retained telemetry)
    v
Mosquitto MQTT broker
    | MQTT subscribe
    v
Node.js bridge (backend/index.js)
    | Validate against contract/telemetry.schema.json
    | Firebase Admin SDK
    v
Firebase Cloud Firestore (project: bin-project-ed93a)
    | Firestore web SDK / real-time listener (TO BE INTEGRATED)
    v
Bin Watch cleaner website
```

**Important:** Node.js is the processing/bridging application, not the database. Mosquitto is the MQTT message broker. Firestore is the managed cloud database. The website does **not** need to connect directly to Mosquitto for the current design.

## 2. Current implementation status

| Component | Status | Notes |
| --- | --- | --- |
| MQTT broker | Working locally | Mosquitto 2.1.2, TCP port `1883`, localhost-only default configuration |
| MQTT publisher/subscriber test | Verified | Test JSON was delivered on `bins/bin-067/telemetry` |
| Node.js MQTT subscriber | Verified | `backend/index.js` receives telemetry |
| JSON schema validation | Implemented | Uses AJV 2020 (`ajv/dist/2020`) to support the contract's JSON Schema draft 2020-12 |
| Firebase authentication | Configured locally | Google Application Default Credentials (ADC), **not** a committed service-account key |
| Firebase project | Created | `bin-project-ed93a` |
| Firestore write logic | Implemented | Bridge calls Firestore `.set(..., { merge: true })`; **confirm the resulting document and live update in Firebase Console** |
| Website ↔ Firestore | **Not yet integrated** | Assigned to website integration teammate |
| Physical ESP32 ↔ broker | **Not yet verified** | Current tests simulate the ESP32 from the Mac |
| 24/7 deployment | **Not configured** | Broker and Node.js bridge currently run on the developer's Mac |

## 3. Repository layout

Relevant files/folders:

```text
bin-main/
├── backend/
│   ├── index.js              # MQTT -> Firestore bridge
│   ├── package.json          # Node.js dependencies
│   ├── package-lock.json
│   └── node_modules/         # Local dependencies; DO NOT commit
├── contract/
│   ├── telemetry.schema.json # Source of truth for telemetry fields
│   ├── README.md             # MQTT topics and contract rules
│   └── examples/
│       └── full.json
├── docs/
├── tools/
├── App code                 # Existing Bin Watch website code
└── README.md
```

The contract files are the source of truth. If their contents or locations change, update the bridge and this README accordingly.

## 4. MQTT contract

**Broker during local development:** `mqtt://127.0.0.1:1883`

| Topic | Publisher | Payload | QoS | Retained |
| --- | --- | --- | --- | --- |
| `bins/<bin_id>/telemetry` | ESP32 | JSON telemetry | 1 | Yes |
| `bins/<bin_id>/status` | ESP32 | Plain text `online` / `offline` | 1 | Yes |

The broker can publish `offline` through the ESP32's MQTT Last Will when a device disconnects unexpectedly. The backend contract calls for subscriptions to `bins/+/telemetry` and `bins/+/status`; **the current bridge code shown during development subscribes only to telemetry**. Device online/offline handling is a follow-up task.

Example valid telemetry:

```json
{
  "bin_id": "bin-067",
  "state": "full",
  "compactions_since_empty": 10,
  "weight": 21.8
}
```

Field definitions:

| Field | Type | Meaning |
| --- | --- | --- |
| `bin_id` | String | Unique bin identifier; must match the `<bin_id>` in the MQTT topic |
| `state` | String | `idle`, `compacting`, or `full` |
| `compactions_since_empty` | Non-negative integer | Number of compaction cycles since last emptying |
| `weight` | Number | Measured weight in **kilograms** |

Contract behavior:
- ESP32 publishes on state changes and periodically (approximately every 30 seconds).
- A `full` state is the firmware's indication that the bin needs emptying; do not infer `full` solely from an arbitrary weight threshold.
- After emptying, firmware should publish `state: "idle"` and reset `compactions_since_empty` to `0`.
- The backend records receipt time; the telemetry payload does not contain a timestamp.
- The JSON schema rejects extra fields. Do not add fields to the MQTT payload without updating the team contract.
- MQTT QoS 1 may deliver duplicates, and retained messages are replayed to new subscribers. Downstream alerts should avoid treating every received message as a new event.

## 5. Node.js backend

The bridge is located at `backend/index.js` and uses:

- `mqtt` — connects and subscribes to Mosquitto.
- `firebase-admin` — writes server-side data to Firestore.
- `ajv` — validates incoming JSON against the team's telemetry schema.
- `dotenv` — installed for environment-based configuration (not required by the minimal example code).

**Important AJV compatibility detail:** The schema uses JSON Schema **draft 2020-12**, so use:

```js
const Ajv2020 = require("ajv/dist/2020");
const ajv = new Ajv2020();
```

Do **not** use `new (require("ajv"))()` with this schema: it can fail with `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`.

### Firestore write mapping

The current backend writes to the `bins` collection, using the MQTT bin ID as the document ID:

**Document path:** `bins/bin-067`

```js
await db.collection("bins").doc(binId).set(
  {
    state: data.state,
    weight: data.weight,
    compactions_since_empty: data.compactions_since_empty,
    last_seen: admin.firestore.FieldValue.serverTimestamp()
  },
  { merge: true }
);
```

Example Firestore document after a successful update:

```text
bins/
  bin-067/
    state: "full"
    weight: 21.8
    compactions_since_empty: 10
    last_seen: <Firestore Timestamp>
```

`last_seen` is a **Firestore Timestamp**, not a text string. `merge: true` preserves other existing fields (for example, a separately maintained `location` field).

**Naming warning:** An earlier manually created example document may be named `BIN_001` with fields such as `weight_kg` or `status`. That is **not the same schema** as the current bridge. For website integration, use the actual backend fields (`state`, `weight`, `compactions_since_empty`, `last_seen`) and document IDs that match MQTT (`bin-067`), or explicitly agree on a mapping with the team.

## 6. Set up the backend on another developer's Mac

### Prerequisites

- Node.js and npm
- Homebrew (macOS)
- Mosquitto
- Google Cloud CLI (`gcloud`)
- Access to Firebase / Google Cloud project `bin-project-ed93a` with appropriate Firestore permissions
- Repository checked out locally (prefer `git clone` over editing a downloaded ZIP)

Install Mosquitto and Google Cloud CLI on macOS:

```bash
brew install mosquitto
brew install --cask google-cloud-sdk
```

From the repository root, install the Node.js dependencies:

```bash
cd backend
npm ci
```

If `npm ci` cannot run because the lockfile has not been committed, use `npm install` and commit the resulting `package-lock.json`.

### Authenticate locally without storing keys in GitHub

```bash
gcloud auth application-default login
gcloud config set project bin-project-ed93a
gcloud auth application-default set-quota-project bin-project-ed93a
```

Use the Google account authorised for this project. Grant only permissions you understand and need. If browser sign-in fails, inspect the error and retry the login; don't share credential files, tokens, or browser authorisation codes.

The Admin SDK can then use local ADC:

```js
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "bin-project-ed93a"
});
```

**Security:** Never commit `~/.config/gcloud/application_default_credentials.json`, a downloaded service-account JSON file, `.env` secrets, or private keys. ADC setup is **per developer machine** and does not automatically authenticate teammates or a deployed server. A production deployment should use a managed service identity where possible.

### Run locally

Open **Terminal A** and start Mosquitto:

```bash
mosquitto -v
```

Leave it running. If port `1883` is already in use, check whether a broker is already running instead of starting a duplicate:

```bash
lsof -nP -iTCP:1883 -sTCP:LISTEN
```

Open **Terminal B**, inside `backend/`, and start the bridge:

```bash
node index.js
```

Expected output:

```text
Connected to MQTT broker!
Listening for smart bin data...
```

A retained telemetry message may be received immediately on startup. A successful Firestore write should log:

```text
Firebase updated successfully: bin-067
```

The Mosquitto and Node.js processes must remain running to process new telemetry.

## 7. End-to-end test (without physical ESP32)

Keep the broker and Node.js bridge running. In another terminal, publish a simulated full-bin reading:

```bash
mosquitto_pub -h 127.0.0.1 -t "bins/bin-067/telemetry" -q 1 -r -m '{"bin_id":"bin-067","state":"full","compactions_since_empty":10,"weight":21.8}'
```

Check the Node.js output for a successful Firestore write. Then open **Firebase Console → project `bin-project-ed93a` → Firestore Database → Data → `bins` → `bin-067`**.

Simulate emptying the bin:

```bash
mosquitto_pub -h 127.0.0.1 -t "bins/bin-067/telemetry" -q 1 -r -m '{"bin_id":"bin-067","state":"idle","compactions_since_empty":0,"weight":2.5}'
```

Verify that the Firestore document changes to `state: "idle"`, `weight: 2.5`, and `compactions_since_empty: 0`. If the bridge logs a permissions error, verify that the authenticated Google account has Firestore write access to the correct project.

Optional MQTT-only subscriber test:

```bash
mosquitto_sub -h 127.0.0.1 -t "bins/+/telemetry" -v
```

**Note:** `-r` retains the last published message, so a newly started subscriber/bridge may immediately receive the latest test message.

## 8. Handoff to the website integration teammate

### What the website should connect to

**Read from Firestore, not directly from Mosquitto or the Node.js bridge.** The bridge already converts MQTT telemetry into Firestore documents.

- **Firebase project ID:** `bin-project-ed93a`
- **Collection:** `bins`
- **Document ID:** MQTT `bin_id` (for example `bin-067`)
- **Current fields:** `state`, `weight`, `compactions_since_empty`, `last_seen`
- **Collection alert condition:** `state === "full"`
- **Cleared condition:** `state === "idle"` after emptying

Use the Firebase **Web SDK** in the website with the Firebase web app configuration from **Firebase Console → Project settings → Your apps**. The web configuration is distinct from the Admin SDK credentials used by Node.js. Do not put Admin SDK credentials in frontend code.

### Example browser-side Firestore listener

The following is an **integration example**, not a complete replacement for the existing Bin Watch website. It assumes the teammate has already initialised the Firebase Web SDK as `db`:

```js
import { collection, onSnapshot } from "firebase/firestore";

const unsubscribe = onSnapshot(collection(db, "bins"), (snapshot) => {
  const bins = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));

  const binsNeedingCollection = bins.filter((bin) => bin.state === "full");

  // TODO: Connect these arrays to the existing Bin Watch UI.
  console.log("All bins:", bins);
  console.log("Needs collection:", binsNeedingCollection);
});

// Call unsubscribe() when the relevant page/component is removed.
```

The website can show `last_seen` to help cleaners recognise stale readings. **Do not assume that a `full` document is currently online**: the online/offline MQTT status topic has not yet been integrated into Firestore.

### Authentication and Firestore Security Rules

Firebase Admin SDK writes from Node.js use server-side IAM credentials and **bypass Firestore Security Rules**. Browser-based reads use the Firebase Web SDK and **are governed by Firestore Security Rules**.

Before sharing or deploying the website:

1. Decide how cleaners will authenticate (Firebase Authentication is an option).
2. Set Firestore rules to permit only the intended users to read bin status.
3. Do **not** allow unauthorised website users to write arbitrary bin states.
4. Test website permissions using a non-admin user account.

A Firebase web app configuration is not a secret, but it is **not** permission to leave the database publicly writable.

### Suggested website behavior

- Display a card or row for each document in `bins`.
- Show the bin ID, state, weight in kg, and last update time.
- Highlight bins whose `state` is `full` as **Needs collection**.
- Update the display automatically with a Firestore `onSnapshot` listener.
- Treat `compacting` as a separate in-progress state, not as `full`.
- Handle missing `location` and `last_seen` fields gracefully.
- Coordinate any acknowledgement, assignment, or collection-history feature before changing the Firestore schema.

## 9. Current limitations / next work

1. **Verify Firestore writes end to end.** Confirm `bins/bin-067` updates after publishing test MQTT messages.
2. **Website integration.** Connect the existing Bin Watch UI to Firestore with appropriate security rules and authentication.
3. **Device status.** Add handling for `bins/+/status` (`online` / `offline`) and represent connectivity separately from `state`.
4. **Physical ESP32 connectivity.** The broker is currently in **localhost-only** mode. An ESP32 on the network cannot connect until an appropriate listener, authentication, firewall rules, and preferably TLS are configured. Do not expose an unauthenticated MQTT port to the public internet.
5. **Always-on hosting.** The current broker and bridge stop when the developer's Mac or terminal stops. Plan a reliable hosted broker and continuously running Node.js bridge for deployment.
6. **Robustness.** Handle invalid JSON/schema errors, Firestore write failures, MQTT reconnects, duplicate QoS 1 deliveries, and retained messages without duplicate collection alerts.
7. **Data model agreement.** Align the website's fields with the bridge and firmware contract before adding features.
8. **Git hygiene.** Add a `.gitignore` that excludes `node_modules/`, `.env`, and credential/key files; commit source files, `package.json`, and `package-lock.json`.

## 10. Troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| `brew: command not found` | Install Homebrew and follow its shell PATH setup instructions |
| `Address already in use` on port 1883 | Another broker/process is listening; check with `lsof -nP -iTCP:1883 -sTCP:LISTEN` |
| MQTT subscriber shows a blank terminal | Normal until a matching message arrives (or a retained message exists) |
| `Keepalive exceeded` | Broker/client stopped responding; inspect broker logs and restart the affected process if needed |
| AJV `no schema with key or ref ... 2020-12` | Use `const Ajv2020 = require("ajv/dist/2020")` and `new Ajv2020()` |
| `Application default credentials have not been set up` | Complete `gcloud auth application-default login` |
| Firestore permission error | Check Google account/project selection and Firestore IAM permissions |
| Website shows no data | Check Firestore collection/document names, Firebase web app config, authentication, security rules, and browser console |

---

**Maintainer note:** This README reflects the local prototype setup and team handoff. Confirm deployed endpoints, security configuration, and final Firestore schema with the team before treating it as production documentation.
