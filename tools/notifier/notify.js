// Watches the Firestore "bins" collection and sends a Telegram message when a bin
// turns "full". Same rule as the website: it alerts on the change TO full, not on
// the first load and not on repeats, so retained or duplicate MQTT messages don't spam.
//
// Setup: see README.md in this folder. Run: npm start   (or: npm run dry to only print)
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot } from "firebase/firestore";
import { newlyFull } from "../../app/src/bins.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, ".env") });              // TELEGRAM_* (this folder)
dotenv.config({ path: path.join(here, "../../app/.env") });    // VITE_FIREBASE_* (the website's config)

const DRY_RUN = process.env.DRY_RUN === "1";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);

const cfg = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

if (!cfg.apiKey || !cfg.projectId) {
  console.error("Missing Firebase config. Make sure app/.env is filled in.");
  process.exit(1);
}
if (!DRY_RUN && (!TOKEN || CHAT_IDS.length === 0)) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in tools/notifier/.env (or run: npm run dry).");
  process.exit(1);
}

export function messageFor(bin) {
  const kg = typeof bin.weight === "number" ? `${bin.weight.toFixed(1)} kg` : "weight unknown";
  const n = bin.compactions_since_empty ?? "?";
  return `🗑️ ${bin.id} is full and needs emptying (${kg}, ${n} compactions).`;
}

async function send(text) {
  if (DRY_RUN) return console.log(`[dry-run] would send: ${text}`);
  for (const chat_id of CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text }),
      });
      if (!res.ok) console.error(`Telegram error ${res.status}: ${await res.text()}`);
      else console.log(`Sent to ${chat_id}: ${text}`);
    } catch (e) {
      console.error("Telegram request failed:", e.message);
    }
  }
}

const db = getFirestore(initializeApp(cfg));
let prev = null;

onSnapshot(
  collection(db, "bins"),
  (snap) => {
    const bins = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    for (const id of newlyFull(prev, bins)) send(messageFor(bins.find((b) => b.id === id)));
    if (prev === null) console.log(`Watching ${bins.length} bin(s). Waiting for a bin to turn full...`);
    prev = bins;
  },
  (err) => console.error("Firestore error:", err.code || err.message)
);
