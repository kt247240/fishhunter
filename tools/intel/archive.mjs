// FishHunter catch archive + evidence ("where exactly is it working?").
// Pure functions, no network. collect.mjs keeps a rolling archive of compact catch records
// (data/archive.json, carried over between builds) and derives data/hotspots.json from it:
// per spot × species, on how many days it was reported caught, where on the pier, when, how.
// Evidence is counted in DAYS, not fish: "caught on 23 of the last 60 report days" is robust
// against one lucky angler reporting 80 small mackerel.

const DAY = 86400e3;
export const KEEP_DAYS = 400;
// Bump when extraction changes enough that history should be re-read once (collector back-fills again).
export const ARCHIVE_SCHEMA = 'fishhunter.archive/3'; // v3: per-day Nojiri URLs, observations, Nagano back-fill
const jstDay = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

/** Zone keys for a pier position: "m4:o" (400–499 m, outer side), "tip:i", "n2" (posts 21–30). */
export function zoneKeys(pos) {
  if (!pos) return [];
  const side = pos.side === '外側' ? ':o' : pos.side === '内側' ? ':i' : '';
  if (pos.tip) return ['tip' + side];
  if (pos.m != null) return ['m' + Math.floor(pos.m / 100) + side];
  if (pos.no && pos.no.length) return [...new Set(pos.no.map((n) => 'n' + Math.floor((n - 1) / 10)))];
  return [];
}
export function zoneLabel(key) {
  const [z, s] = key.split(':');
  const side = s === 'o' ? ' 外側' : s === 'i' ? ' 内側' : '';
  if (z === 'tip') return '先端' + side;
  if (z[0] === 'm') { const k = +z.slice(1); return `${k * 100}〜${k * 100 + 99}m${side}`; }
  const k = +z.slice(1); return `${k * 10 + 1}〜${k * 10 + 10}番`;
}

/** One report → compact record (only catches that were actually reported caught). */
export function toRecord(r) {
  const c = (r.catches || []).filter((x) => !x.mention).map((x) => [x.sp || x.name, x.count ?? null, x.max ?? null, x.method || null, zoneKeys(x.pos)]);
  const rec = { id: r.id, d: r.date, src: r.src, t: r.type, a: r.area || null, s: r.spots || [], tb: (r.time && r.time.buckets) || [], v: r.visitors ?? null, c };
  if (r.colorHits && r.colorHits.length) rec.col = r.colorHits; // [[speciesId|null, colour, ±1]]
  if (r.obs && r.obs.waterTemp != null) rec.o = { wt: r.obs.waterTemp }; // measured water temperature
  return rec;
}

/** Merge fresh reports into the previous archive (same id → fresh wins), drop old / empty ones. */
export function mergeArchive(prev, reports, now = Date.now()) {
  const map = new Map();
  for (const x of (prev && prev.records) || []) if (x && x.id && x.d) map.set(x.id, x);
  for (const r of reports) if (r.id && r.date && r.date <= now + DAY) map.set(r.id, toRecord(r));
  const records = [...map.values()].filter((x) => now - x.d <= KEEP_DAYS * DAY && (x.c.length || x.v != null || (x.col && x.col.length) || x.o)).sort((a, b) => b.d - a.d);
  return { schema: ARCHIVE_SCHEMA, updated_at: new Date(now).toISOString(), records };
}

/** Earliest record date per source (to decide whether a source still needs its history back-filled). */
export function coverage(archive) {
  const out = {};
  for (const x of (archive && archive.records) || []) out[x.src] = Math.min(out[x.src] || Infinity, x.d);
  return out;
}

/**
 * Evidence per spot × species over the last `days` (default 60), plus a cross-spot ranking.
 * Keys starting with "@" are areas (e.g. "@上越") and include every report from that area.
 * speciesIds: the app's own species ids (others are kept by name at spot level only).
 */
export function buildHotspots(archive, now = Date.now(), { days = 60, speciesIds = null } = {}) {
  const since = now - days * DAY, d30 = now - 30 * DAY, d14 = now - 14 * DAY, d7 = now - 7 * DAY;
  const spots = {};
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  for (const x of (archive && archive.records) || []) {
    if (x.d < since || x.t === 'boat') continue;
    const day = jstDay(x.d);
    // Spot-level evidence, plus "@<area>" buckets for reports that only name the area.
    for (const sid of [...x.s, ...(x.a ? ['@' + x.a] : [])]) {
      const S = spots[sid] || (spots[sid] = { days: new Set(), from: x.d, to: x.d, srcs: new Set(), sp: {} });
      S.days.add(day); S.from = Math.min(S.from, x.d); S.to = Math.max(S.to, x.d); S.srcs.add(x.src);
      for (const [csp, name, sign] of x.col || []) {
        const k = csp || '_any';
        const C = S.col || (S.col = {});
        const b = (C[k] || (C[k] = {}))[name] || (C[k][name] = [0, 0]);
        b[sign > 0 ? 0 : 1]++;
      }
      const seenHere = new Set();
      for (const [k, cnt, max, method, zones] of x.c) {
        const P = S.sp[k] || (S.sp[k] = { days: new Set(), d30: new Set(), d14: new Set(), d7: new Set(), fish: 0, max: null, last: 0, methods: {}, tb: {}, zones: {} });
        P.days.add(day); if (x.d >= d30) P.d30.add(day); if (x.d >= d14) P.d14.add(day); if (x.d >= d7) P.d7.add(day);
        P.fish += cnt || 1;
        if (max != null) P.max = Math.max(P.max || 0, max);
        P.last = Math.max(P.last, x.d);
        if (method) inc(P.methods, method);
        if (!seenHere.has(k)) { seenHere.add(k); x.tb.forEach((b) => inc(P.tb, b)); }
        for (const z of zones) {
          const Z = P.zones[z] || (P.zones[z] = { days: new Set(), d14: new Set(), fish: 0 });
          Z.days.add(day); if (x.d >= d14) Z.d14.add(day); Z.fish += (cnt || 1) / zones.length;
        }
      }
    }
  }
  const out = {};
  const rank = {};
  for (const [sid, S] of Object.entries(spots)) {
    const sp = {};
    for (const [k, P] of Object.entries(S.sp)) {
      const zones = Object.entries(P.zones).map(([z, Z]) => ({ z, label: zoneLabel(z), days: Z.days.size, d14: Z.d14.size, fish: Math.round(Z.fish) }))
        .sort((a, b) => b.days - a.days || b.fish - a.fish).slice(0, 8);
      sp[k] = {
        days: P.days.size, d30: P.d30.size, d14: P.d14.size, d7: P.d7.size, fish: P.fish, max: P.max, last: P.last,
        methods: Object.entries(P.methods).sort((a, b) => b[1] - a[1]).slice(0, 3),
        tb: P.tb, zones
      };
      if (sid[0] !== '@' && (!speciesIds || speciesIds.includes(k))) (rank[k] || (rank[k] = [])).push({ spot: sid, d30: P.d30.size, d7: P.d7.size, days: P.days.size, reportDays: S.days.size, last: P.last, max: P.max });
    }
    const colors = {};
    for (const [k, m] of Object.entries(S.col || {})) colors[k] = Object.entries(m).map(([n, [p, q]]) => [n, p, q]).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]) || b[1] - a[1]);
    out[sid] = { reportDays: S.days.size, from: S.from, to: S.to, sources: S.srcs.size, sp, ...(Object.keys(colors).length ? { colors } : {}) };
  }
  for (const k of Object.keys(rank)) rank[k] = rank[k].filter((r) => r.d30 > 0).sort((a, b) => b.d30 - a.d30 || b.d7 - a.d7 || b.last - a.last).slice(0, 10);
  return { schema: 'fishhunter.hotspots/1', generated_at: new Date(now).toISOString(), days, spots: out, rank };
}
