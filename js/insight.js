/* FishHunter — original analyses over the daybook (data/daybook.json: per spot × day, the
 * conditions and what was caught). Pure functions shared by the app and the tests.
 *   analogs(): past days whose sea/weather/season looked most like the given conditions
 *   lift():    which fish did better than usual on those days
 *   season():  weekly catch days + size for one species (growth, arrival, fade)
 *   crowd():   typical visitor numbers by day type
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const DAY = 86400e3;
  const doy = (d) => { const t = Date.parse(d + 'T12:00:00+09:00'); return Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / DAY); };
  const sq = (x) => x * x;

  /**
   * Scaled distance: 10 days of season ≈ 0.4 m wave ≈ 2.5 m/s wind ≈ 1.5 ℃ ≈ 0.5 m of yesterday's sea.
   * Sea/weather terms weigh 0.35: on one season of pier logs (leave-one-out, ±2 days excluded) the
   * time of year carries most of the signal (AUC ≈ 0.71) and weather mainly breaks ties. As more
   * seasons accumulate, "same time of year, similar sea" starts to draw on other years.
   */
  function distance(a, b, dA, dB) {
    let s = 0, n = 0;
    const W = 0.35;
    const add = (x, y, scale, w = W) => { if (x == null || y == null) return; s += w * sq((x - y) / scale); n += w; };
    add(a.wv, b.wv, 0.4); add(a.wd, b.wd, 2.5); add(a.sst, b.sst, 1.5); add(a.prev, b.prev, 0.5); add(a.on, b.on, 0.9, W / 2);
    if (dA && dB) { let dd = Math.abs(doy(dA) - doy(dB)); dd = Math.min(dd, 365 - dd); s += sq(dd / 10); n += 1; }
    return n ? Math.sqrt(s / n) : Infinity;
  }

  const spotDays = (book, spotId) => ((book && book.days) || []).filter((e) => e.s === spotId && e.c);

  /** k nearest past days (excluding `date` itself). */
  function analogs(book, spotId, cond, date, k = 6) {
    return spotDays(book, spotId).filter((e) => e.d !== date)
      .map((e) => ({ e, dist: distance(cond, e.c, date, e.d) }))
      .sort((a, b) => a.dist - b.dist).slice(0, k);
  }

  /** Per species: share of analog days with a catch vs. the spot's overall share. */
  function lift(book, spotId, near, minBase = 3) {
    const all = spotDays(book, spotId);
    if (!all.length || !near.length) return [];
    const ids = new Set(all.flatMap((e) => Object.keys(e.f)));
    return [...ids].map((sp) => {
      const baseN = all.filter((e) => e.f[sp]).length;
      const hit = near.filter((x) => x.e.f[sp]).length;
      const fish = near.reduce((a, x) => a + (x.e.f[sp] ? x.e.f[sp][0] : 0), 0) / near.length;
      const zones = {};
      near.forEach((x) => { const z = x.e.f[sp] && x.e.f[sp][2]; if (z) zones[z] = (zones[z] || 0) + 1; });
      const zone = Object.entries(zones).sort((a, b) => b[1] - a[1])[0];
      const base = baseN / all.length, rate = hit / near.length;
      return { sp, hit, n: near.length, rate, base, lift: base ? rate / base : 0, fish, zone: zone ? zone[0] : null };
    }).filter((x) => x.hit > 0 && all.filter((e) => e.f[x.sp]).length >= minBase)
      .sort((a, b) => b.rate - a.rate || b.lift - a.lift);
  }

  /** Weekly flow for one species at one spot: [{w (Monday), days, hit, size (median of daily max)}]. */
  function season(book, spotId, sp, weeks = 10, now = Date.now()) {
    const days = ((book && book.days) || []).filter((e) => e.s === spotId);
    const monday = (t) => { const d = new Date(t + 9 * 3600e3); const wd = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd); };
    const w0 = monday(now);
    const out = Array.from({ length: weeks }, (_, i) => ({ w: w0 - (weeks - 1 - i) * 7 * DAY, days: 0, hit: 0, sizes: [] }));
    for (const e of days) {
      const i = weeks - 1 - Math.round((w0 - monday(Date.parse(e.d + 'T12:00:00+09:00'))) / (7 * DAY));
      if (i < 0 || i >= weeks) continue;
      out[i].days++;
      if (e.f[sp]) { out[i].hit++; if (e.f[sp][1] != null) out[i].sizes.push(e.f[sp][1]); }
    }
    return out.map((x) => { const s = x.sizes.sort((a, b) => a - b); return { w: x.w, days: x.days, hit: x.hit, size: s.length ? s[Math.floor(s.length / 2)] : null }; });
  }

  /** Median visitors by day type over the last `weeks` weeks. */
  function crowd(book, spotId, weeks = 6, now = Date.now()) {
    const since = now - weeks * 7 * DAY;
    const days = ((book && book.days) || []).filter((e) => e.s === spotId && e.v != null && Date.parse(e.d) >= since);
    const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const pick = (f) => days.filter(f).map((e) => e.v);
    return { weekday: med(pick((e) => e.dow >= 1 && e.dow <= 5)), sat: med(pick((e) => e.dow === 6)), sun: med(pick((e) => e.dow === 0)), n: days.length };
  }

  /**
   * 回遊レーダー: the same species at several spots, side by side.
   * → { spots: [{ id, weeks: season(), arrivals: [date…], last }], lead: { from, to, days, r, n } | null }
   * Arrival = first catch after ≥ gapDays of report days without it. A lead is only reported when the
   * 7-day smoothed daily series correlate strongly (r ≥ 0.6 over ≥ 45 shared days) at a non-zero lag.
   */
  function migration(book, sp, spotIds, now = Date.now(), { weeks = 8, gapDays = 14 } = {}) {
    const all = (book && book.days) || [];
    const res = { spots: [], lead: null };
    const series = {};
    const dates = all.map((e) => Date.parse(e.d + 'T12:00:00+09:00'));
    if (!dates.length) return res;
    const t0 = Math.min(...dates), N = Math.round((Math.max(...dates) - t0) / DAY) + 1;
    for (const id of spotIds) {
      const days = all.filter((e) => e.s === id).sort((a, b) => (a.d < b.d ? -1 : 1));
      if (!days.length) continue;
      const arrivals = [];
      const first = Date.parse(days[0].d + 'T12:00:00+09:00');
      let lastHit = null;
      for (const e of days) {
        const t = Date.parse(e.d + 'T12:00:00+09:00');
        if (!e.f[sp]) continue;
        // A first-ever catch only counts when the log already covered gapDays before it.
        if (lastHit == null ? t - first >= gapDays * DAY : t - lastHit >= gapDays * DAY) arrivals.push(e.d);
        lastHit = t;
      }
      const raw = new Array(N).fill(null);
      days.forEach((e) => { raw[Math.round((Date.parse(e.d + 'T12:00:00+09:00') - t0) / DAY)] = e.f[sp] ? Math.log1p(e.f[sp][0]) : 0; });
      series[id] = raw.map((_, i) => { let s = 0, n = 0; for (let k = i - 3; k <= i + 3; k++) if (raw[k] != null) { s += raw[k]; n++; } return n >= 3 ? s / n : null; });
      res.spots.push({ id, weeks: season(book, id, sp, weeks, now), arrivals, last: lastHit });
    }
    const corr = (a, b) => {
      const x = [], y = [];
      a.forEach((v, i) => { if (v != null && b[i] != null) { x.push(v); y.push(b[i]); } });
      const n = x.length; if (n < 45) return null;
      const mx = x.reduce((p, q) => p + q, 0) / n, my = y.reduce((p, q) => p + q, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += sq(x[i] - mx); syy += sq(y[i] - my); }
      return sxx && syy ? { r: sxy / Math.sqrt(sxx * syy), n } : null;
    };
    if (res.spots.length >= 2) {
      const [A, B] = res.spots.map((x) => series[x.id]);
      let best = null;
      for (let L = -10; L <= 10; L++) {
        const c = corr(A, B.map((_, i) => (B[i + L] === undefined ? null : B[i + L])));
        if (c && (!best || c.r > best.r)) best = Object.assign({ L }, c);
      }
      // A[i] ~ B[i+L]: L < 0 → B moves first by |L| days.
      if (best && best.r >= 0.6 && Math.abs(best.L) >= 2) {
        const [a, b] = res.spots.map((x) => x.id);
        res.lead = best.L < 0 ? { from: b, to: a, days: -best.L, r: best.r, n: best.n } : { from: a, to: b, days: best.L, r: best.r, n: best.n };
      }
    }
    return res;
  }

  const STORM_BUCKETS = [['0-1', '当日〜翌日', (d) => d <= 1], ['2', '2日後', (d) => d === 2], ['3', '3日後', (d) => d === 3], ['4-6', '4〜6日後', (d) => d >= 4 && d <= 6], ['7+', '凪が続く', (d) => d >= 7]];
  const stormBucket = (d) => (d == null ? null : STORM_BUCKETS.find((b) => b[2](d))[0]);
  /**
   * 時化後カーブ: catch vs. days since the last blow (≥1.5 m), season removed by comparing each day
   * with that pier's ±7-day mean of log(1+fish). mult = exp(mean residual) ≈ "×いつも".
   */
  function stormCurve(book, spotId, sp) {
    const days = ((book && book.days) || []).filter((e) => e.s === spotId && e.c && e.c.ss != null);
    if (days.length < 20) return null;
    const y = (e) => Math.log1p(e.f[sp] ? e.f[sp][0] : 0);
    const t = days.map((e) => Date.parse(e.d));
    const g = {};
    days.forEach((e, i) => {
      let s = 0, n = 0;
      for (let j = 0; j < days.length; j++) if (Math.abs(t[j] - t[i]) <= 7 * DAY) { s += y(days[j]); n++; }
      const k = stormBucket(e.c.ss);
      (g[k] || (g[k] = [])).push(y(e) - s / n);
    });
    return STORM_BUCKETS.map(([key, label]) => {
      const r = g[key] || [];
      return { key, label, n: r.length, mult: r.length ? Math.exp(r.reduce((a, b) => a + b, 0) / r.length) : null };
    });
  }

  const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
  /**
   * Days since the sea last peaked ≥ thr metres (0 = this morning's early hours, 1 = yesterday …).
   * null when the marine series does not reach back far enough to tell (or max days of calm).
   */
  function daysSinceStorm(spot, day, data, thr = 1.5, max = 10) {
    const m = data && data.marine && data.marine[spot.id];
    if (!m || !m.time || !m.time.length) return null;
    const start = Date.parse(day + 'T00:00:00+09:00');
    for (let k = 0; k <= max; k++) {
      const a = start - k * DAY, b = k === 0 ? start + 6 * 3600e3 : a + DAY;
      if (a < m.time[0]) return k >= 7 ? k : null; // a week of calm is enough to call it 凪が続く
      let peak = null;
      for (let i = 0; i < m.time.length; i++) if (m.time[i] >= a && m.time[i] < b && m.wave[i] != null) peak = Math.max(peak ?? 0, m.wave[i]);
      if (peak != null && peak >= thr) return k;
    }
    return max + 1; // calm for longer than `max` days
  }

  /** Daytime (05–17 JST) summary of the engine's conditions for one spot and day, or null. */
  function dayConditions(spot, day, data) {
    const E = FH.engine, H = 3600e3;
    const t0 = Date.parse(day + 'T05:00:00+09:00');
    const cs = [];
    for (let h = 0; h <= 12; h++) { const c = E.conditions(spot, t0 + h * H, data); if (c.hasWx) cs.push(c); }
    if (cs.length < 6) return null;
    const mean = (k) => { const v = cs.map((c) => c[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const noon = E.conditions(spot, t0 + 7 * H, data);
    const ss = daysSinceStorm(spot, day, data);
    return {
      ...(ss != null ? { ss } : {}),
      wv: r1(mean('wave')), wd: r1(mean('wind')), on: r1(mean('onshore')), sst: r1(mean('sst') ?? mean('waterTemp')),
      prev: r1(cs[1] && cs[1].wavePrev), rain: r1(cs[0].rain24), tide: noon.tide.name, age: r1(noon.moonAge)
    };
  }

  /** "m4:o" → "400〜499m 外側" (same keys as tools/intel/archive.mjs). */
  function zoneLabel(key) {
    if (!key) return '';
    const [z, sd] = key.split(':');
    const side = sd === 'o' ? ' 外側' : sd === 'i' ? ' 内側' : '';
    if (z === 'tip') return '先端' + side;
    const k = +z.slice(1);
    return z[0] === 'm' ? `${k * 100}〜${k * 100 + 99}m${side}` : `${k * 10 + 1}〜${k * 10 + 10}番`;
  }

  FH.insight = { distance, analogs, lift, season, crowd, migration, daysSinceStorm, stormCurve, stormBucket, dayConditions, zoneLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
