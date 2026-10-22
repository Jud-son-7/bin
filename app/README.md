# Bin Watch app (website)

Live staff view of the smart bins. Reads the Firestore `bins` collection and shows an alert when a bin turns `full`.

## Run it

```bash
cd app
npm install
npm run dev
```

Open the address it prints (for example `http://localhost:5173`). To open it on a phone on the same Wi-Fi, use the `Network:` address it prints.

Until Firebase is set up, the page shows demo data and says so in the top right. You can also force demo mode with `?demo=1` on the address.

## Connect to Firebase

1. Firebase Console, then Project settings, then Your apps. Add a Web app if there isn't one.
2. Copy `.env.example` to `.env` and paste the config values in. Restart `npm run dev`.
3. Deploy the rules in `firebase/firestore.rules` (see `docs/firebase-setup.md`). Otherwise the top right shows `error: permission-denied`.

## Data it expects

Collection `bins`, document id = `bin_id`, fields `state` (`idle`, `compacting`, `full`), `weight` (kg), `compactions_since_empty`, `last_seen` (Firestore Timestamp). See `backend/README_backend.md`.

## Alert rules

- A bin needs collection when `state === "full"`.
- The alert fires only when a bin changes **to** `full`. The first load, retained or duplicate messages, and bins that stay full do not re-alert.
- A bin with no update for 2 minutes is shown faded as "may be offline".

## Tests

```bash
node src/bins.test.mjs
```
