import "./style.css";
import { collection, onSnapshot } from "firebase/firestore";
import { db, configured } from "./firebase.js";
import { startMock } from "./mock.js";
import { isStale, needsCollection, newlyFull, timeAgo, toMillis } from "./bins.js";

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has("demo") || !configured;

let prev = null; // previous list of bins, used to detect "just turned full"
let current = [];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function card(bin) {
  const stale = isStale(bin);
  const full = needsCollection(bin);
  const label = full ? "Needs collection" : bin.state === "compacting" ? "Compacting" : "OK";
  const cls = full ? "full" : bin.state === "compacting" ? "compacting" : "idle";
  const w = typeof bin.weight === "number" ? bin.weight.toFixed(1) : "?";
  return `<article class="card ${cls}${stale ? " stale" : ""}">
    <div class="row"><strong>${esc(bin.id)}</strong><span class="badge">${label}</span></div>
    <div class="meta">${w} kg &middot; ${esc(bin.compactions_since_empty ?? "?")} compactions</div>
    <div class="meta">Updated ${timeAgo(toMillis(bin.last_seen))}${stale ? " &middot; <b>may be offline</b>" : ""}</div>
  </article>`;
}

function render() {
  const sorted = [...current].sort((a, b) => a.id.localeCompare(b.id));
  const full = sorted.filter(needsCollection);
  $("count-full").textContent = full.length;
  $("full").innerHTML = full.length ? full.map(card).join("") : `<p class="empty">No bins need collection.</p>`;
  $("all").innerHTML = sorted.length ? sorted.map(card).join("") : `<p class="empty">No bins yet.</p>`;
}

function showAlert(id) {
  const el = document.createElement("div");
  el.className = "alert";
  el.innerHTML = `<b>${esc(id)}</b> is full and needs emptying.<button aria-label="Dismiss">&times;</button>`;
  el.querySelector("button").onclick = () => el.remove();
  $("alerts").appendChild(el);
  if (navigator.vibrate) navigator.vibrate(200);
}

function onBins(bins) {
  for (const id of newlyFull(prev, bins)) showAlert(id);
  prev = bins;
  current = bins;
  render();
}

// Refresh "x s ago" and stale flags even when no new data arrives.
setInterval(render, 15000);

if (demo) {
  $("conn").textContent = configured ? "demo data" : "demo data (Firebase not set up)";
  startMock(onBins);
} else {
  $("conn").textContent = "live";
  onSnapshot(
    collection(db, "bins"),
    (snap) => onBins(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error(err);
      $("conn").textContent = "error: " + (err.code || err.message);
      $("conn").classList.add("bad");
    }
  );
}
