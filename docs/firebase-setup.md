# Firebase setup (website live, no ESP32 needed)

Project: `bin-project-ed93a`. Data lives in the `bins` collection, one document per bin (id = `bin_id`), fields `state`, `weight`, `compactions_since_empty`, `last_seen`.

## 1. Get access

Accept the Firebase owner invite at console.firebase.google.com (open the console yourself rather than clicking the email link).

## 2. Turn on Firestore

Console, then Build, then Firestore Database, then Create database (production mode). Skip if it already exists.

## 3. Deploy the security rules

The website reads `bins`, and nothing can write from a browser. The Node.js bridge writes with the Admin SDK, which ignores these rules.

Simplest: Console, Firestore, Rules tab, paste the contents of `firebase/firestore.rules`, click Publish.

Or with the CLI:

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase deploy --only firestore:rules --project bin-project-ed93a
```

Note: `allow read: if true` means anyone with the website's config can read bin status. That is fine for a demo (no personal data). Add Firebase Authentication later if cleaners need to log in.

## 4. Put test bins in Firestore (no broker needed)

```bash
gcloud auth application-default login
gcloud config set project bin-project-ed93a
cd tools/firebase-seed
npm install
node seed.js                 # writes 4 bins
node seed.js --full bin-014  # makes bin-014 full: the website should alert
node seed.js --empty bin-014 # emptied again
node seed.js --loop          # automatic fill / full / empty cycle for a demo
node seed.js --clear         # delete the demo bins
```

`node seed.js --dry-run` checks the messages against the contract without touching Firebase.

## 5. Connect the website

```bash
cd app
cp .env.example .env     # paste the web app config from Project settings > Your apps
npm install
npm run dev
```

The top right of the page should say `live`. Run `node seed.js --full bin-014` and the alert banner appears.

## Troubleshooting

| Top right says | Meaning |
| --- | --- |
| `demo data (Firebase not set up)` | `.env` is missing or empty. Restart `npm run dev` after editing it |
| `error: permission-denied` | Rules not deployed (step 3) |
| `live` but no bins | Collection is empty. Run the seed script, or check the project id in `.env` |
| `Application default credentials` error from seed | Run the `gcloud auth application-default login` line |

## When the ESP32 and broker work

The real bridge (`backend/index.js`) writes the same documents, so the website needs no change. Stop using `seed.js` then, or run `--clear` first.

## Running your own broker and bridge (on your Mac)

```bash
brew install mosquitto
cd backend && npm install
gcloud auth application-default login
gcloud config set project bin-project-ed93a
```

Terminal A: `mosquitto -v`. Terminal B (in `backend/`): `node index.js`. You should see `Connected to MQTT broker` and `Listening for smart bin data...`.

Test it with a fake bin (Terminal C):

```bash
mosquitto_pub -h 127.0.0.1 -t "bins/bin-067/telemetry" -q 1 -r -m '{"bin_id":"bin-067","state":"full","compactions_since_empty":10,"weight":21.8}'
```

The bridge logs `Firebase updated successfully: bin-067` and the website shows the alert. To check messages without touching Firebase, run `npm run dry` instead of `node index.js`.

The bridge also subscribes to `bins/+/status` and stores `online: true/false` on the bin document. The website shows a bin as "may be offline" when `online` is false. This adds one field to the Firestore document, so tell the team.
