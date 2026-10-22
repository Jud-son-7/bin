// Pure logic, no browser or Firebase code, so it is easy to test.
// Contract: state is "idle" | "compacting" | "full" (see contract/telemetry.schema.json).

export const STALE_AFTER_MS = 2 * 60 * 1000; // no update for 2 min => stale

export function toMillis(lastSeen) {
  if (!lastSeen) return null;
  if (typeof lastSeen.toMillis === "function") return lastSeen.toMillis(); // Firestore Timestamp
  if (lastSeen instanceof Date) return lastSeen.getTime();
  if (typeof lastSeen === "number") return lastSeen;
  return null;
}

export function isStale(bin, now = Date.now()) {
  if (bin.online === false) return true; // the broker reported the bin as offline
  const t = toMillis(bin.last_seen);
  return t === null || now - t > STALE_AFTER_MS;
}

export function needsCollection(bin) {
  return bin.state === "full";
}

// Compare the previous and the new snapshot and return the bin ids that just
// turned "full". The first snapshot (prev === null) never alerts, and bins that
// were already full do not alert again, so duplicate or retained MQTT messages
// do not spam the cleaner.
export function newlyFull(prev, next) {
  if (prev === null) return [];
  return next.filter((b) => needsCollection(b) && !needsCollection(prev.find((p) => p.id === b.id) || {})).map((b) => b.id);
}

export function timeAgo(ms, now = Date.now()) {
  if (ms === null) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
