// Fake data so the UI works without Firebase. Used when the config is not filled in,
// or when you open the page with ?demo=1.
// Every few seconds a bin changes state so you can see the alert fire.

export function startMock(onBins) {
  const now = Date.now();
  const bins = [
    { id: "bin-001", state: "idle", weight: 3.2, compactions_since_empty: 0, last_seen: new Date(now) },
    { id: "bin-014", state: "compacting", weight: 14.6, compactions_since_empty: 2, last_seen: new Date(now) },
    { id: "bin-067", state: "full", weight: 21.8, compactions_since_empty: 10, last_seen: new Date(now) },
    { id: "bin-090", state: "idle", weight: 5.0, compactions_since_empty: 1, last_seen: new Date(now - 10 * 60 * 1000) }, // stale
  ];
  const emit = () => onBins(bins.map((b) => ({ ...b })));
  emit();

  let step = 0;
  const id = setInterval(() => {
    step++;
    const b = bins[0]; // bin-001 fills up, then is emptied
    if (step % 4 === 1) { b.state = "compacting"; b.weight = 15; b.compactions_since_empty = 3; }
    else if (step % 4 === 2) { b.state = "full"; b.weight = 22.1; b.compactions_since_empty = 10; }
    else if (step % 4 === 0) { b.state = "idle"; b.weight = 2.5; b.compactions_since_empty = 0; }
    b.last_seen = new Date();
    bins[1].last_seen = new Date();
    emit();
  }, 5000);
  return () => clearInterval(id);
}
