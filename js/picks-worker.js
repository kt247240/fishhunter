/* FishHunter — background worker for the heavy "top picks" / weekend scans.
 * Runs the same engine code off the main thread. The page passes in the
 * weather data, catch-intel evidence/observations and the relevant local
 * storage values (catch log, preferences) so results match the main thread. */
/* global importScripts */
let store = {};
self.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
importScripts('diagnostics.js', 'spots.js', 'astro.js', 'catchlog.js', 'prefs.js', 'engine.js');

self.onmessage = (ev) => {
  const m = ev.data || {};
  try {
    store = m.storage || {};
    const FH = self.FH;
    const ev7 = m.evidence || {};
    const obs = m.observations || {};
    FH.feed = {
      loaded: () => !!m.intel,
      evidence: (spot, sp) => ev7[spot.id + ':' + sp.id] || null,
      observed: (id) => obs[id] || null
    };
    const filter = m.mine ? FH.prefs.matches : null;
    const slim = (p) => ({ spotId: p.spot.id, spId: p.sp.id, win: p.win });
    const picks = FH.engine.topPicks(m.data, m.now, m.hours || 18, m.limit || 8, filter).map(slim);
    const weekend = FH.engine.weekend(m.data, m.now, { limit: 3, filter }).map((d) => Object.assign({}, d, { picks: d.picks.map(slim) }));
    self.postMessage({ id: m.id, ok: true, picks, weekend });
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e) });
  }
};
