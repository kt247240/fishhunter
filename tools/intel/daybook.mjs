// FishHunter daybook: one line per (spot, day) = that day's conditions + what was caught.
// Built in CI from the catch archive and Open-Meteo past weather, carried over between builds so
// days older than the weather window keep their conditions. Powers the app's original analyses:
// "days like today" (analogs), season flow (weekly catch days + size growth) and crowding.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const DAY = 86400e3, H = 3600e3;
export const KEEP_DAYS = 400;
const jstDay = (t) => new Date(t + 9 * H).toISOString().slice(0, 10);

/** The app's own engine in a sandbox (conditions() = the exact inputs the score uses). */
export function loadEngine(root) {
  const ctx = { console, setTimeout, clearTimeout, performance, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['diagnostics', 'spots', 'astro', 'engine', 'insight']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  return ctx.FH;
}

/** Same summary the app computes for "today" (js/insight.js). */
export const dayConditions = (FH, spot, day, data) => FH.insight.dayConditions(spot, day, data);

/**
 * archive: {records}; spotIds: spots to keep a daybook for; data: {wx, marine} with past days;
 * prev: previous daybook (carried over). Returns { schema, days: [{s, d, dow, c, v, f}] }.
 * f: { speciesId: [fish, maxSize|null, topZone|null] } — only the app's species ids.
 */
export function buildDaybook(FH, archive, spotIds, data, prev, now = Date.now()) {
  const want = new Set(spotIds);
  const ids = new Set(FH.SPECIES.map((s) => s.id));
  const byKey = new Map();
  for (const x of (archive && archive.records) || []) {
    if (x.t === 'boat' || !x.d) continue;
    for (const s of x.s) {
      if (!want.has(s)) continue;
      const d = jstDay(x.d), k = s + '|' + d;
      const e = byKey.get(k) || { s, d, dow: new Date(Date.parse(d + 'T12:00:00+09:00')).getUTCDay(), v: null, f: {}, zc: {} };
      if (x.v != null) e.v = Math.max(e.v || 0, x.v);
      for (const [sp, cnt, max, , zones] of x.c) {
        if (!ids.has(sp)) continue;
        const f = e.f[sp] || (e.f[sp] = [0, null, null]);
        f[0] += cnt || 1;
        if (max != null) f[1] = Math.max(f[1] || 0, max);
        const zc = e.zc[sp] || (e.zc[sp] = {});
        for (const z of zones) zc[z] = (zc[z] || 0) + (cnt || 1);
      }
      byKey.set(k, e);
    }
  }
  const old = new Map(((prev && prev.days) || []).map((e) => [e.s + '|' + e.d, e]));
  const out = [];
  for (const [k, e] of byKey) {
    for (const sp of Object.keys(e.f)) { const z = Object.entries(e.zc[sp]).sort((a, b) => b[1] - a[1])[0]; e.f[sp][2] = z ? z[0] : null; }
    delete e.zc;
    const spot = FH.spotById[e.s];
    e.c = (data && spot && dayConditions(FH, spot, e.d, data)) || (old.get(k) && old.get(k).c) || null;
    out.push(e);
  }
  // Days that fell out of the archive window but are still in the previous daybook stay.
  for (const [k, e] of old) if (!byKey.has(k) && want.has(e.s)) out.push(e);
  const days = out.filter((e) => now - Date.parse(e.d) <= KEEP_DAYS * DAY).sort((a, b) => (a.d < b.d ? 1 : -1));
  return { schema: 'fishhunter.daybook/1', generated_at: new Date(now).toISOString(), days };
}
