/* FishHunter — astronomy: sun, moon, tide phase names, solunar periods.
 * Low-precision algorithms (±1–2 min for sun, ±5–10 min for moon events),
 * which is ample for fishing-window planning. All pure, no network.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const RAD = Math.PI / 180;
  const JST = 9 * 3600e3;
  const HOUR = 3600e3;
  const SYNODIC = 29.530588853;

  const sin = (d) => Math.sin(d * RAD);
  const cos = (d) => Math.cos(d * RAD);
  const norm360 = (x) => ((x % 360) + 360) % 360;

  const jd = (date) => date.getTime() / 86400e3 + 2440587.5;

  /** 00:00 JST of the JST calendar day containing `date` (as a Date). */
  function jstMidnight(date) {
    const t = date.getTime() + JST;
    return new Date(t - (t % 86400e3) - JST);
  }
  function jstParts(date) {
    const d = new Date(date.getTime() + JST);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), dow: d.getUTCDay() };
  }

  function altAz(raDeg, decDeg, date, lat, lon) {
    const d = jd(date) - 2451545.0;
    const gmst = norm360(280.46061837 + 360.98564736629 * d);
    const ha = norm360(gmst + lon - raDeg);
    const alt = Math.asin(sin(lat) * sin(decDeg) + cos(lat) * cos(decDeg) * cos(ha)) / RAD;
    return alt;
  }

  function sunRaDec(date) {
    const d = jd(date) - 2451545.0;
    const gm = norm360(357.529 + 0.98560028 * d);
    const q = norm360(280.459 + 0.98564736 * d);
    const L = norm360(q + 1.915 * sin(gm) + 0.02 * sin(2 * gm));
    const e = 23.439 - 0.00000036 * d;
    const ra = norm360(Math.atan2(cos(e) * sin(L), cos(L)) / RAD);
    const dec = Math.asin(sin(e) * sin(L)) / RAD;
    return { ra, dec };
  }

  function moonLambda(date) {
    const T = (jd(date) - 2451545.0) / 36525;
    return 218.32 + 481267.881 * T
      + 6.29 * sin(135.0 + 477198.87 * T) - 1.27 * sin(259.3 - 413335.36 * T)
      + 0.66 * sin(235.7 + 890534.22 * T) + 0.21 * sin(269.9 + 954397.74 * T)
      - 0.19 * sin(357.5 + 35999.05 * T) - 0.11 * sin(186.5 + 966404.03 * T);
  }
  function sunLambda(date) {
    const d = jd(date) - 2451545.0;
    const gm = norm360(357.529 + 0.98560028 * d);
    return norm360(280.459 + 0.98564736 * d + 1.915 * sin(gm) + 0.02 * sin(2 * gm));
  }

  function moonRaDec(date) {
    const T = (jd(date) - 2451545.0) / 36525;
    const lam = moonLambda(date);
    const bet = 5.13 * sin(93.3 + 483202.02 * T) + 0.28 * sin(228.2 + 960400.89 * T)
      - 0.28 * sin(318.3 + 6003.15 * T) - 0.17 * sin(217.6 - 407332.21 * T);
    const e = 23.439;
    const x = cos(bet) * cos(lam);
    const y = cos(e) * cos(bet) * sin(lam) - sin(e) * sin(bet);
    const z = sin(e) * cos(bet) * sin(lam) + cos(e) * sin(bet);
    return { ra: norm360(Math.atan2(y, x) / RAD), dec: Math.asin(z) / RAD };
  }

  /** Horizontal coordinates: altitude and azimuth (deg, 0=N, 90=E). */
  function horizontal(raDeg, decDeg, date, lat, lon) {
    const d = jd(date) - 2451545.0;
    const ha = norm360(norm360(280.46061837 + 360.98564736629 * d) + lon - raDeg);
    const alt = Math.asin(sin(lat) * sin(decDeg) + cos(lat) * cos(decDeg) * cos(ha)) / RAD;
    const az = norm360(Math.atan2(-sin(ha) * cos(decDeg), cos(lat) * sin(decDeg) - sin(lat) * cos(decDeg) * cos(ha)) / RAD);
    return { alt, az };
  }
  const sunPos = (date, lat, lon) => { const p = sunRaDec(date); return horizontal(p.ra, p.dec, date, lat, lon); };
  const moonPos = (date, lat, lon) => { const p = moonRaDec(date); return horizontal(p.ra, p.dec, date, lat, lon); };
  const sunAlt = (date, lat, lon) => { const p = sunRaDec(date); return altAz(p.ra, p.dec, date, lat, lon); };
  const moonAlt = (date, lat, lon) => { const p = moonRaDec(date); return altAz(p.ra, p.dec, date, lat, lon); };

  /** Scan a function across [start, start+spanH] and return threshold crossings + extrema. */
  function scan(fn, start, spanH, stepMin, threshold) {
    const step = stepMin * 60e3;
    const out = { up: [], down: [], max: [], min: [] };
    let t0 = start.getTime();
    let prev2 = null, prev = fn(new Date(t0)), tPrev = t0;
    for (let t = t0 + step; t <= t0 + spanH * HOUR; t += step) {
      const v = fn(new Date(t));
      if (prev < threshold && v >= threshold) out.up.push(new Date(tPrev + step * (threshold - prev) / (v - prev)));
      if (prev >= threshold && v < threshold) out.down.push(new Date(tPrev + step * (prev - threshold) / (prev - v)));
      if (prev2 !== null) {
        if (prev > prev2 && prev >= v) out.max.push({ t: new Date(tPrev), v: prev });
        if (prev < prev2 && prev <= v) out.min.push({ t: new Date(tPrev), v: prev });
      }
      prev2 = prev; prev = v; tPrev = t;
    }
    return out;
  }

  const sunCache = new Map();
  /** Sun events for the JST day containing `date`. */
  function sunTimes(date, lat, lon) {
    const day = jstMidnight(date);
    const key = day.getTime() + ':' + lat.toFixed(2) + ':' + lon.toFixed(2);
    if (sunCache.has(key)) return sunCache.get(key);
    const f = (t) => sunAlt(t, lat, lon);
    const s = scan(f, day, 24, 2, -0.833);
    const civ = scan(f, day, 24, 2, -6);
    const noon = s.max[0] ? s.max[0].t : new Date(day.getTime() + 11.7 * HOUR);
    const r = {
      rise: s.up[0] || null, set: s.down[0] || null,
      dawn: civ.up[0] || null, dusk: civ.down[0] || null, noon
    };
    sunCache.set(key, r);
    return r;
  }

  /** Moon age in days from the true Sun–Moon elongation (accurate to a few hours). */
  function moonAge(date) {
    const elong = norm360(moonLambda(date) - sunLambda(date));
    return (elong / 360) * SYNODIC;
  }
  function moonIllum(date) {
    const elong = norm360(moonLambda(date) - sunLambda(date));
    return (1 - cos(elong)) / 2;
  }
  function moonPhaseName(age) {
    if (age < 1.5 || age > 28.0) return '新月';
    if (age < 6.4) return '三日月';
    if (age < 8.9) return '上弦';
    if (age < 13.8) return '十三夜';
    if (age < 15.8) return '満月';
    if (age < 21.1) return '寝待月';
    if (age < 23.6) return '下弦';
    return '有明月';
  }

  // Tide naming by (rounded) moon age — the conventional Japanese table.
  const TIDE_BY_AGE = [
    '大潮', '大潮', '大潮', '中潮', '中潮', '中潮', '中潮', '小潮', '小潮', '小潮',
    '長潮', '若潮', '中潮', '中潮', '大潮', '大潮', '大潮', '大潮', '中潮', '中潮',
    '中潮', '中潮', '小潮', '小潮', '小潮', '長潮', '若潮', '中潮', '中潮', '大潮'
  ];
  const TIDE_STRENGTH = { 大潮: 1, 中潮: 0.8, 小潮: 0.55, 長潮: 0.45, 若潮: 0.6 };
  function tideName(date) {
    // Evaluate at local noon so the whole JST day shares one name.
    const noon = new Date(jstMidnight(date).getTime() + 12 * HOUR);
    const idx = Math.round(moonAge(noon)) % 30;
    const name = TIDE_BY_AGE[idx];
    return { name, strength: TIDE_STRENGTH[name] };
  }

  const solCache = new Map();
  /** Solunar periods around the JST day of `date` (spans previous evening to next morning). */
  function solunar(date, lat, lon) {
    const day = jstMidnight(date);
    const key = day.getTime() + ':' + lat.toFixed(1) + ':' + lon.toFixed(1);
    if (solCache.has(key)) return solCache.get(key);
    const start = new Date(day.getTime() - 6 * HOUR);
    const f = (t) => moonAlt(t, lat, lon);
    const s = scan(f, start, 36, 6, 0.125);
    const major = [...s.max.map((m) => ({ t: m.t, kind: '南中' })), ...s.min.map((m) => ({ t: m.t, kind: '北中' }))]
      .map((m) => ({ kind: m.kind, center: m.t, start: new Date(m.t.getTime() - HOUR), end: new Date(m.t.getTime() + HOUR) }));
    const minor = [...s.up.map((t) => ({ t, kind: '月の出' })), ...s.down.map((t) => ({ t, kind: '月の入' }))]
      .map((m) => ({ kind: m.kind, center: m.t, start: new Date(m.t.getTime() - 0.5 * HOUR), end: new Date(m.t.getTime() + 0.5 * HOUR) }));
    const inDay = (t) => t >= day && t < new Date(day.getTime() + 24 * HOUR);
    const r = {
      major, minor,
      moonrise: s.up.find(inDay) || null,
      moonset: s.down.find(inDay) || null
    };
    solCache.set(key, r);
    return r;
  }

  /** 1 inside a major period, ~0.75 inside minor, 0.5 otherwise; tapers at the edges. */
  function solunarFactor(date, lat, lon) {
    const s = solunar(date, lat, lon);
    const t = date.getTime();
    let best = 0.5, label = null;
    for (const p of s.major) {
      const dist = Math.abs(t - p.center.getTime()) / HOUR;
      if (dist <= 1) { const v = 1 - dist * 0.15; if (v > best) { best = v; label = '月' + p.kind; } }
    }
    for (const p of s.minor) {
      const dist = Math.abs(t - p.center.getTime()) / HOUR;
      if (dist <= 0.5) { const v = 0.78 - dist * 0.1; if (v > best) { best = v; label = p.kind; } }
    }
    return { value: best, label };
  }

  /** Light phase of an instant: mazume (twilight ±75min of sunrise/sunset) | day | night */
  function lightPhase(date, lat, lon) {
    const s = sunTimes(date, lat, lon);
    const t = date.getTime();
    const W = 75 * 60e3;
    if (s.rise && Math.abs(t - s.rise.getTime()) <= W) return { phase: 'mazume', label: '朝マズメ' };
    if (s.set && Math.abs(t - s.set.getTime()) <= W) return { phase: 'mazume', label: '夕マズメ' };
    const alt = sunAlt(date, lat, lon);
    return alt > 0 ? { phase: 'day', label: '日中' } : { phase: 'night', label: '夜' };
  }

  FH.astro = {
    jd, jstMidnight, jstParts, sunAlt, moonAlt, sunPos, moonPos, sunTimes, moonAge, moonIllum,
    moonPhaseName, tideName, solunar, solunarFactor, lightPhase, HOUR
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
