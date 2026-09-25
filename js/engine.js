/* FishHunter — HUNT engine.
 * Turns weather/marine/astro conditions into an explainable 0–99 bite score
 * per spot × species × hour, plus safety gating and tactic suggestions.
 * Pure functions: depends only on FH.astro, FH.SPOTS/SPECIES and the data
 * object produced by FH.weather.load(). Optional hooks: FH.feed, FH.catchlog.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const A = () => FH.astro;
  const HOUR = 3600e3;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const COMPASS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const compass = (deg) => (deg == null ? '—' : COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]);

  /* ───────────────────────── conditions ───────────────────────── */

  function idxAt(series, t) {
    if (!series || !series.time || !series.time.length) return -1;
    const i = Math.floor((t - series.time[0]) / HOUR);
    return i >= 0 && i < series.time.length ? i : -1;
  }
  const at = (arr, i) => (arr && i >= 0 && i < arr.length ? num(arr[i]) : null);
  function sumRange(arr, from, to) {
    let s = 0, n = 0;
    for (let k = Math.max(0, from); k < Math.min(arr ? arr.length : 0, to); k++) { const v = num(arr[k]); if (v != null) { s += v; n++; } }
    return n ? s : null;
  }
  function meanRange(arr, from, to) {
    let s = 0, n = 0;
    for (let k = Math.max(0, from); k < Math.min(arr ? arr.length : 0, to); k++) { const v = num(arr[k]); if (v != null) { s += v; n++; } }
    return n ? s / n : null;
  }

  // Conditions are species-independent: memoise per data snapshot × spot × instant.
  const condCache = new WeakMap();
  /** Assemble every input the scorer needs for one spot at instant t. */
  function conditions(spot, t, data) {
    if (data && typeof data === 'object') {
      let m = condCache.get(data);
      if (!m) { m = new Map(); condCache.set(data, m); }
      const k = spot.id + '@' + t;
      if (!m.has(k)) m.set(k, buildConditions(spot, t, data));
      return m.get(k);
    }
    return buildConditions(spot, t, data);
  }
  function buildConditions(spot, t, data) {
    const a = A();
    const date = new Date(t);
    const w = data && data.wx ? data.wx[spot.id] : null;
    const m = data && data.marine ? data.marine[spot.id] : null;
    const i = idxAt(w, t);
    const j = idxAt(m, t);
    const c = {
      t, spotId: spot.id, month: a.jstParts(date).m, day: a.jstParts(date).d,
      temp: at(w && w.temp, i), precip: at(w && w.precip, i), pressure: at(w && w.pressure, i),
      cloud: at(w && w.cloud, i), wind: at(w && w.wind, i), windDir: at(w && w.windDir, i),
      gust: at(w && w.gust, i), code: at(w && w.code, i),
      wave: at(m && m.wave, j), waveDir: at(m && m.waveDir, j), wavePeriod: at(m && m.wavePeriod, j),
      swell: at(m && m.swell, j), sst: at(m && m.sst, j),
      hasWx: i >= 0, hasMarine: j >= 0
    };
    const p3 = at(w && w.pressure, i - 3);
    c.dp3 = c.pressure != null && p3 != null ? c.pressure - p3 : null;
    c.rain6 = w ? sumRange(w.precip, i - 6, i) : null;
    c.rain24 = w ? sumRange(w.precip, i - 24, i) : null;
    c.rain72 = w ? sumRange(w.precip, i - 72, i) : null;

    // Water temperature: measured SST at sea; lagged air-temp estimate inland.
    if (spot.water === 'sea') {
      c.waterTemp = c.sst; c.waterTempEst = false;
    } else if (w) {
      const mean72 = meanRange(w.temp, i - 72, i + 1);
      if (mean72 != null) {
        let est = spot.water === 'lake' ? mean72 + 1 : mean72 - 1;
        if (spot.water === 'river' && (c.month === 4 || c.month === 5) && (spot.elev || 0) >= 400) est -= 2; // snowmelt
        c.waterTemp = clamp(est, 1, 30); c.waterTempEst = true;
      } else { c.waterTemp = null; c.waterTempEst = true; }
    }

    // Onshore component (+1 = straight onshore, -1 = offshore / tailwind for casting).
    c.onshore = spot.water === 'sea' && c.windDir != null ? Math.cos(((c.windDir - (spot.face || 0)) * Math.PI) / 180) : 0;

    // Turbidity proxy 0 (clear) … 1 (heavily stained).
    if (spot.water === 'sea') {
      const mouth = /河口/.test(spot.type) ? 1 : 0.35;
      c.murk = clamp(((c.wave || 0) - 0.7) / 1.6 + ((c.rain24 || 0) / 45) * mouth + Math.max(0, c.onshore) * ((c.wind || 0) / 30));
    } else {
      const flow = (c.rain24 || 0) + 0.5 * Math.max(0, (c.rain72 || 0) - (c.rain24 || 0));
      c.flow = flow;
      c.murk = clamp(flow / 40);
    }

    c.light = a.lightPhase(date, spot.lat, spot.lon);
    c.tide = a.tideName(date);
    c.moonAge = a.moonAge(date);
    c.moonIllum = a.moonIllum(date);
    c.solunar = a.solunarFactor(date, spot.lat, spot.lon);
    return c;
  }

  /* ───────────────────────── safety ───────────────────────── */

  function safety(spot, c) {
    const reasons = [];
    let level = 0; // 0 ok, 1 caution, 2 danger
    const up = (l, r) => { level = Math.max(level, l); reasons.push(r); };
    if (c.code != null && c.code >= 95) up(2, '雷雨の予報：釣り竿は落雷の危険大');
    if (spot.water === 'sea') {
      if (c.wave != null && c.wave >= 2.5) up(2, `波高 ${c.wave.toFixed(1)}m：高波で危険`);
      else if (c.wave != null && c.wave >= 1.8) up(1, `波高 ${c.wave.toFixed(1)}m：外向き・低い足場は避ける`);
      if (c.gust != null && c.gust >= 15) up(2, `突風 ${c.gust.toFixed(0)}m/s：転落・飛来物の危険`);
      else if (c.gust != null && c.gust >= 11) up(1, `突風 ${c.gust.toFixed(0)}m/s：キャスト・足元に注意`);
    } else if (spot.water === 'river') {
      if ((c.rain24 || 0) >= 50 || (c.rain6 || 0) >= 20) up(2, `直近の雨量が多く増水の危険（24h ${Math.round(c.rain24 || 0)}mm）`);
      else if ((c.rain24 || 0) >= 25) up(1, `増水・濁りに注意（24h ${Math.round(c.rain24 || 0)}mm）`);
      if (/放流/.test(spot.caution || '')) reasons.push('ダム放流情報を事前確認');
    } else {
      if (c.gust != null && c.gust >= 13) up(2, `突風 ${c.gust.toFixed(0)}m/s：ボート・桟橋は危険`);
      else if (c.wind != null && c.wind >= 8) up(1, `風 ${c.wind.toFixed(0)}m/s：ボートは要注意`);
    }
    if (c.code === 75 || c.code === 86) up(1, '大雪：路面・視界に注意');
    return { level, reasons, label: ['OK', '注意', '危険'][level] };
  }

  /* ───────────────────────── component scores ───────────────────────── */

  function seasonAt(sp, c) {
    // Smooth monthly weights: blend toward the neighbouring month.
    const m = c.month - 1;
    const frac = (c.day - 15) / 30;
    const n = frac >= 0 ? (m + 1) % 12 : (m + 11) % 12;
    return clamp(sp.months[m] * (1 - Math.abs(frac)) + sp.months[n] * Math.abs(frac));
  }

  function trap(x, [lo0, lo1, hi1, hi0]) {
    if (x == null) return null;
    if (x <= lo0 || x >= hi0) return 0.05;
    if (x < lo1) return 0.05 + 0.95 * (x - lo0) / (lo1 - lo0);
    if (x > hi1) return 0.05 + 0.95 * (hi0 - x) / (hi0 - hi1);
    return 1;
  }

  function timeScore(sp, c) {
    let v = sp.time[c.light.phase];
    if (c.light.phase === 'day' && (c.cloud || 0) >= 75) v += (sp.time.mazume - v) * 0.3; // overcast ≈ extended twilight
    if (c.light.phase === 'night' && sp.moon && c.moonIllum < 0.25) v += 0.05 * sp.moon * 10 * (0.25 - c.moonIllum);
    return clamp(v);
  }

  function waveScore(sp, wave) {
    if (wave == null || !sp.wave) return null;
    const [a, b, mx] = sp.wave;
    if (wave < a) return 0.7 + 0.3 * (a > 0 ? wave / a : 1);
    if (wave <= b) return 1;
    if (wave <= mx) return 1 - 0.65 * (wave - b) / (mx - b);
    return clamp(0.35 - (wave - mx) * 0.5);
  }

  function windScore(sp, wind, bonusTail) {
    if (wind == null) return null;
    const v = wind <= sp.windTol ? 1 : clamp(1 - (wind - sp.windTol) / 8);
    return clamp(v + (bonusTail || 0));
  }

  function clarityScore(sp, murk) {
    if (sp.water === 'clear') return clamp(1 - 0.75 * murk, 0.1);
    if (sp.water === 'murky') return clamp(0.5 + 0.5 * murk);
    return clamp(1 - Math.abs(murk - 0.4) * 1.3, 0.2); // stain: moderate colour is best
  }

  function flowScore(sp, c) {
    const r = c.flow || 0;
    let v;
    if (sp.water === 'clear') v = clamp(1 - r / 35, 0.08);
    else if (r < 3) v = 0.62;
    else if (r <= 12) v = 0.62 + 0.38 * (r - 3) / 9;
    else if (r <= 30) v = 1 - 0.25 * (r - 12) / 18;
    else if (r <= 60) v = 0.75 - 0.55 * (r - 30) / 30;
    else v = 0.08;
    if ((c.rain6 || 0) >= 5) v *= 0.7; // rising water right now
    return clamp(v);
  }

  function pressureScore(dp3) {
    if (dp3 == null) return null;
    if (dp3 <= -2.5) return 0.75;
    if (dp3 <= -0.5) return 1;
    if (dp3 < 0.5) return 0.65;
    if (dp3 < 1.5) return 0.5;
    return 0.35;
  }

  const WEIGHTS = {
    sea: { time: 0.28, temp: 0.18, env: 0.22, pressure: 0.1, solunar: 0.1, tide: 0.12 },
    river: { time: 0.25, temp: 0.25, env: 0.3, pressure: 0.1, solunar: 0.1 },
    lake: { time: 0.28, temp: 0.25, env: 0.17, pressure: 0.15, solunar: 0.15 }
  };

  /* ───────────────────────── score ───────────────────────── */

  function score(spot, sp, c, opts = {}) {
    const f = {};
    const notes = {};
    f.time = timeScore(sp, c);
    notes.time = c.light.label + ((c.light.phase === 'day' && (c.cloud || 0) >= 75) ? '（曇天で光量低め）' : '');

    const ts = trap(c.waterTemp, sp.temp);
    f.temp = ts == null ? 0.6 : ts;
    notes.temp = c.waterTemp == null ? '水温データなし' : `${c.waterTempEst ? '推定' : ''}水温 ${c.waterTemp.toFixed(1)}℃（適水温 ${sp.temp[1]}〜${sp.temp[2]}℃）`;

    if (spot.water === 'sea') {
      const ws = waveScore(sp, c.wave);
      const wi = windScore(sp, c.wind, c.onshore < -0.5 ? 0.05 : 0);
      const cl = clarityScore(sp, c.murk);
      f.env = (ws == null ? 0.6 : ws) * 0.45 + (wi == null ? 0.6 : wi) * 0.3 + cl * 0.25;
      notes.env = `波 ${c.wave == null ? '—' : c.wave.toFixed(1) + 'm'} / 風 ${c.wind == null ? '—' : c.wind.toFixed(0) + 'm/s ' + compass(c.windDir)}${c.onshore > 0.5 ? '（向かい風）' : c.onshore < -0.5 ? '（追い風）' : ''} / ${c.murk > 0.55 ? '濁り強' : c.murk > 0.25 ? 'ささ濁り' : '澄み'}`;
      f.tide = c.tide.strength;
      notes.tide = c.tide.name + '（日本海は潮位差が小さく影響は控えめ）';
    } else if (spot.water === 'river') {
      const fl = flowScore(sp, c);
      const wi = windScore(sp, c.wind) || 0.7;
      f.env = fl * 0.75 + wi * 0.25;
      const r = c.flow || 0;
      notes.env = `雨量指数 ${r.toFixed(0)}mm → ${r < 3 ? '平水〜渇水' : r <= 12 ? 'ささ濁り・好水位' : r <= 30 ? '増水気味' : '増水・濁流'}${(c.rain6 || 0) >= 5 ? '（今まさに増水中）' : ''}`;
    } else {
      const wind = c.wind == null ? 2 : c.wind;
      let wi;
      if (sp.id === 'bass') wi = wind < 1 ? 0.65 : wind <= 6 ? 1 : clamp(1 - (wind - 6) / 7);
      else wi = windScore(sp, wind) || 0.7;
      f.env = wi;
      notes.env = `風 ${wind.toFixed(0)}m/s ${compass(c.windDir)}${sp.id === 'bass' && wind >= 2 && wind <= 6 ? '（風の当たるバンクが有利）' : ''}`;
    }

    const ps = pressureScore(c.dp3);
    f.pressure = ps == null ? 0.6 : ps;
    notes.pressure = c.dp3 == null ? '気圧データなし' : `3時間変化 ${c.dp3 > 0 ? '+' : ''}${c.dp3.toFixed(1)}hPa${c.dp3 <= -0.5 ? '（下降＝活性UP傾向）' : c.dp3 >= 1.5 ? '（急上昇＝食い渋り傾向）' : ''}`;

    f.solunar = c.solunar.value;
    notes.solunar = c.solunar.label ? `ソルナー：${c.solunar.label}` : 'ソルナー時合外';

    const W = WEIGHTS[spot.water];
    let core = 0;
    for (const k of Object.keys(W)) core += W[k] * f[k];
    const season = seasonAt(sp, c);
    const seasonMul = Math.pow(season, 0.6);
    let s = 100 * Math.pow(core, 1.35) * seasonMul;

    const extras = [];
    if (opts.evidence && opts.evidence.count > 0) {
      const b = Math.min(8, opts.evidence.count * 2.5) * (opts.evidence.freshness || 0.5);
      s += b; extras.push({ key: 'evidence', label: '直近の釣果情報', impact: b, note: `${opts.evidence.count}件（${opts.evidence.latestText || '最近'}）` });
    }
    if (opts.personal && opts.personal.bonus) {
      s += opts.personal.bonus; extras.push({ key: 'personal', label: 'あなたの実績パターン', impact: opts.personal.bonus, note: opts.personal.note });
    }

    const safe = safety(spot, c);
    if (safe.level === 2) s = Math.min(s, 12);
    s = Math.round(clamp(s, 0, 99));

    const LABEL = { time: '時間帯', temp: '水温', env: spot.water === 'sea' ? '海況' : spot.water === 'river' ? '水量・濁り' : '風・湖況', pressure: '気圧変化', solunar: '月（ソルナー）', tide: '潮回り' };
    const factors = Object.keys(W).map((k) => ({
      key: k, label: LABEL[k], value: f[k], weight: W[k], note: notes[k],
      impact: W[k] * (f[k] - 0.6) * 100 * seasonMul
    }));
    factors.unshift({ key: 'season', label: 'シーズン', value: season, weight: null, note: `${c.month}月の旬度 ${Math.round(season * 100)}%`, impact: (seasonMul - 0.75) * 40 });
    factors.push(...extras);
    return { score: s, season, factors, safety: safe, cond: c };
  }

  function verdict(s) {
    if (s >= 80) return { label: '激アツ', tone: 'hot' };
    if (s >= 65) return { label: '好機', tone: 'good' };
    if (s >= 50) return { label: '狙える', tone: 'ok' };
    if (s >= 35) return { label: '渋め', tone: 'meh' };
    return { label: '厳しい', tone: 'bad' };
  }

  /* ───────────────────────── series & windows ───────────────────────── */

  function hookOpts(spot, sp, c) {
    const o = {};
    if (FH.feed && FH.feed.evidence) o.evidence = FH.feed.evidence(spot, sp);
    if (FH.catchlog && FH.catchlog.personalBoost) o.personal = FH.catchlog.personalBoost(sp.id, c);
    return o;
  }

  function series(spot, sp, data, fromT, hours) {
    const out = [];
    const t0 = Math.floor(fromT / HOUR) * HOUR;
    for (let h = 0; h < hours; h++) {
      const t = t0 + h * HOUR + HOUR / 2; // score the middle of each hour
      const c = conditions(spot, t, data);
      if (!c.hasWx) { out.push({ t: t - HOUR / 2, score: null, cond: c }); continue; }
      const r = score(spot, sp, c, hookOpts(spot, sp, c));
      out.push({ t: t - HOUR / 2, score: r.score, safety: r.safety, cond: c });
    }
    return out;
  }

  function windows(ser, { min = 55, limit = 5 } = {}) {
    const vals = ser.filter((x) => x.score != null).map((x) => x.score);
    if (!vals.length) return [];
    const peakAll = Math.max(...vals);
    const thr = Math.max(min, peakAll - 10);
    const out = [];
    let cur = null;
    for (const x of ser) {
      const ok = x.score != null && x.score >= thr && (!x.safety || x.safety.level < 2);
      if (ok) {
        if (!cur) cur = { start: x.t, end: x.t + HOUR, peak: x.score, peakT: x.t, sum: 0, n: 0, labels: new Set() };
        cur.end = x.t + HOUR; cur.sum += x.score; cur.n++;
        if (x.score > cur.peak) { cur.peak = x.score; cur.peakT = x.t; }
        cur.labels.add(x.cond.light.label);
        if (x.cond.solunar.label) cur.labels.add(x.cond.solunar.label);
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out
      .map((w) => ({ start: w.start, end: w.end, peak: w.peak, peakT: w.peakT, avg: Math.round(w.sum / w.n), tags: [...w.labels] }))
      .sort((a, b) => b.peak - a.peak || a.start - b.start)
      .slice(0, limit);
  }

  function speciesFor(spot) { return spot.species.map((id) => FH.speciesById[id]).filter(Boolean); }

  /** Rank spots for one species: now score + best window in the next `hours`. */
  function rankSpots(sp, data, now, hours = 24) {
    return FH.SPOTS.filter((s) => s.species.includes(sp.id)).map((spot) => {
      const ser = series(spot, sp, data, now, hours);
      const nowPt = ser[0];
      const win = windows(ser, { min: 0, limit: 1 })[0] || null;
      return { spot, now: nowPt ? nowPt.score : null, safety: nowPt && nowPt.safety, best: win, series: ser };
    }).sort((a, b) => ((b.best && b.best.peak) || 0) - ((a.best && a.best.peak) || 0));
  }

  /** Best spot × species combos in the next `hours` (the "今行くならここ" list). */
  function topPicks(data, now, hours = 18, limit = 6, filter = null) {
    const picks = [];
    for (const spot of FH.SPOTS) {
      for (const sp of speciesFor(spot)) {
        if (filter && !filter(spot, sp)) continue;
        const ser = series(spot, sp, data, now, hours);
        const w = windows(ser, { min: 0, limit: 1 })[0];
        if (w) picks.push({ spot, sp, win: w, now: ser[0] && ser[0].score });
      }
    }
    picks.sort((a, b) => b.win.peak - a.win.peak || a.win.start - b.win.start);
    const seen = new Set();
    const perSp = {};
    return picks.filter((p) => {
      if (seen.has(p.spot.id) || (perSp[p.sp.id] || 0) >= 2) return false;
      seen.add(p.spot.id); perSp[p.sp.id] = (perSp[p.sp.id] || 0) + 1; return true;
    }).slice(0, limit);
  }

  /** Last instant covered by weather data (ms), or 0. */
  function dataEnd(data) {
    const w = data && data.wx && Object.values(data.wx)[0];
    return w && w.time && w.time.length ? w.time[w.time.length - 1] + HOUR : 0;
  }

  /**
   * Upcoming Saturday & Sunday (JST; today counts if it is the weekend).
   * Returns [{ day, label, start, inRange, picks }] — picks only when forecast covers it.
   */
  function weekend(data, now, { limit = 3, filter = null } = {}) {
    const a = A();
    const today = a.jstMidnight(new Date(now)).getTime();
    const dow = a.jstParts(new Date(now)).dow;
    const toSat = dow === 0 ? -1 : (6 - dow);
    const days = [today + toSat * 24 * HOUR, today + (toSat + 1) * 24 * HOUR];
    const end = dataEnd(data);
    return days.map((d, i) => {
      const from = Math.max(d, now);
      const hours = Math.max(0, Math.floor((Math.min(d + 24 * HOUR, end) - from) / HOUR));
      const inRange = hours >= 3;
      return {
        day: d, label: i === 0 ? '土' : '日', start: from, inRange,
        picks: inRange ? topPicks(data, from, hours, limit, filter) : []
      };
    });
  }

  /** Hours in the next `hours` where any sea spot is in danger — for safety alerts. */
  function dangerScan(data, now, hours = 72) {
    const out = [];
    for (const spot of FH.SPOTS) {
      let cur = null;
      for (let h = 0; h < hours; h++) {
        const t = Math.floor(now / HOUR) * HOUR + h * HOUR + HOUR / 2;
        const c = conditions(spot, t, data);
        if (!c.hasWx) break;
        const s = safety(spot, c);
        if (s.level === 2) {
          if (!cur) cur = { spot, start: t - HOUR / 2, end: t + HOUR / 2, reasons: new Set() };
          cur.end = t + HOUR / 2;
          s.reasons.forEach((r) => cur.reasons.add(/波高/.test(r) ? '高波' : /突風/.test(r) ? '突風' : /雷/.test(r) ? '雷雨' : /雨量|増水/.test(r) ? '増水' : '荒天'));
        } else if (cur) { out.push(cur); cur = null; }
      }
      if (cur) out.push(cur);
    }
    return out.map((x) => Object.assign(x, { reasons: [...x.reasons] }));
  }

  /* ───────────────────────── tactics ───────────────────────── */

  const BOTTOM = new Set(['kisu', 'hirame', 'kasago', 'kurodai', 'madai']);

  function tactics(spot, sp, c) {
    const month = c.month;
    const phase = c.light.phase;
    const cloudy = (c.cloud || 0) >= 70;
    const out = { method: sp.methods[0], alt: sp.methods.slice(1), aim: [], notes: [] };

    // Colour
    if (phase === 'night') out.color = { main: 'シルエット系（黒・赤）／ 常夜灯下はクリア・ケイムラ', why: '夜は輪郭で見せる。明るい常夜灯下は透け感で違和感を消す' };
    else if (c.murk > 0.55) out.color = { main: 'チャート・ピンク・ゴールド（強アピール）', why: '濁りが強く、視認性優先' };
    else if (phase === 'mazume' || cloudy) out.color = { main: 'オレンジ・ピンク・パール（中アピール）', why: phase === 'mazume' ? 'マズメの薄明かりでシルエット＋フラッシング' : '曇天で光量が少ない' };
    else out.color = { main: 'ナチュラル（イワシ・クリア・ブラウン・オリーブ）', why: '澄み潮・晴天は見切られやすい' };
    if (sp.id === 'aori') {
      const base = phase === 'night' ? '赤テープ・ケイムラ' : c.murk > 0.5 || cloudy || phase === 'mazume' ? '金テープ' : 'マーブル・ホロ';
      out.color.main = `下地：${base} ／ 布：${phase === 'night' ? 'ダーク系' : c.murk > 0.5 ? 'オレンジ・ピンク' : cloudy ? 'オレンジ' : 'ナチュラル・ブラウン'}`;
    }

    // Size / weight
    const windy = (c.wind || 0) >= 6;
    const deep = spot.depth === 'deep';
    const sizes = {
      aori: () => (month >= 9 && month <= 10 ? '2.5〜3.0号' : month === 11 ? '3.0〜3.5号' : '3.5〜4.0号') + (windy || deep ? '（ディープ／重め）' : spot.depth === 'shallow' ? '（シャロー）' : '（ノーマル）'),
      aji: () => (windy ? 'ジグヘッド1.5〜2g／スプリット' : 'ジグヘッド0.6〜1g'),
      saba: () => (windy ? 'ジグ30g＋サビキ' : 'サビキ・ジグ20g'),
      inada: () => (windy || deep ? 'メタルジグ40〜60g' : 'メタルジグ30〜40g'),
      sagoshi: () => (windy ? 'ジグ30〜40g' : 'ブレードジグ20〜30g'),
      seabass: () => (windy || c.murk > 0.5 ? 'バイブ20〜26g' : 'ミノー・シンペン12〜20g'),
      kurodai: () => (windy ? 'フリーリグ10〜14g' : 'フリーリグ5〜7g'),
      madai: () => (deep ? 'カゴ12〜15号／ショアラバ60g' : 'カゴ10号／ショアラバ40g'),
      kisu: () => (windy ? 'オモリ25〜30号' : 'オモリ15〜20号（ちょい投げは8〜10号）'),
      hirame: () => (windy || (c.wave || 0) > 1.2 ? 'ジグ40g・HSミノー' : 'ジグ30g・ワーム21g'),
      kasago: () => (windy ? 'テキサス7〜10g' : 'ジグヘッド1〜3g'),
      sakuramasu: () => ((c.flow || 0) > 12 ? 'ヘビーシンキングミノー・スプーン15〜20g' : 'ミノー9〜11cm・スプーン10〜14g'),
      yamame: () => ((c.flow || 0) > 12 ? 'ヘビーシンキングミノー5cm' : 'シンキングミノー4〜5cm'),
      iwana: () => ((c.flow || 0) > 12 ? 'スプーン5g・ヘビーミノー' : 'ミノー5cm・スプーン3g'),
      niji: () => ((c.flow || 0) > 12 ? 'スプーン14g・ヘビーミノー9cm' : 'ミノー7cm・スプーン7〜10g'),
      ayu: () => '水量に合わせてオモリ・背バリで調整',
      bass: () => (c.waterTemp != null && c.waterTemp < 12 ? 'メタルバイブ・ネコリグ（ディープ）' : windy ? 'シャッド・スピナーベイト' : 'ネコリグ・ミドスト（中層）'),
      wakasagi: () => '仕掛け0.5〜1号／オモリは棚と風で3〜7g'
    };
    out.size = (sizes[sp.id] || (() => '状況に合わせて'))();

    // Speed
    if (c.waterTemp != null && c.waterTemp < sp.temp[1]) out.speed = 'スロー：止め・フォールを長めに（低水温で反応が鈍い）';
    else if (c.waterTemp != null && c.waterTemp > sp.temp[2]) out.speed = 'レンジを下げる：朝夕の涼しい時間に集中（高水温）';
    else out.speed = '通常〜やや速め：活性が高い水温帯。テンポ良く広く探る';

    // Layer
    if (BOTTOM.has(sp.id)) out.layer = 'ボトム中心';
    else if (phase === 'mazume') out.layer = '表層〜中層（ベイトが浮く時間）';
    else if (phase === 'night') out.layer = '表層〜中層（常夜灯の明暗）';
    else out.layer = cloudy ? '中層' : '中層〜ボトム（日差しを避けて沈む）';

    // Aim points by spot type
    const T = spot.type;
    if (/漁港|港湾/.test(T)) out.aim.push('港口・船道の駆け上がり', '常夜灯の明暗の境', '堤防先端の潮目');
    if (/磯/.test(T)) out.aim.push('サラシの切れ目', '沈み根の周り', '潮通しの良い岬');
    if (/サーフ/.test(T)) out.aim.push('離岸流（払い出し）', 'カケアガリ', '波の崩れ方が違う場所');
    if (/河口/.test(T)) out.aim.push('流れのヨレ・潮目', '河川水と海水の境界', '橋脚・明暗');
    if (/突堤/.test(T)) out.aim.push('突堤先端の潮流', '付け根のサーフとの境');
    if (/渓流/.test(T)) out.aim.push('落ち込みの白泡下', '岩裏の巻き返し', '瀬尻・淵尻');
    if (/本流|河川/.test(T)) out.aim.push('流芯脇の緩流帯', '瀬から淵への変化', '合流点');
    if (/湖/.test(T)) out.aim.push('岬・張り出し', '流れ込み', sp.id === 'bass' ? '風の当たるバンク' : 'ワンド奥・ブレイク');
    out.aim = [...new Set(out.aim)].slice(0, 4);

    // Notes
    if (c.dp3 != null && c.dp3 <= -0.5) out.notes.push('気圧下降中：活性が上がりやすい。手返し重視で');
    if (c.dp3 != null && c.dp3 >= 1.5) out.notes.push('気圧急上昇：食いが浅い。サイズを落として丁寧に');
    if (spot.water === 'sea' && c.onshore > 0.5 && (c.wind || 0) >= 5) out.notes.push('向かい風：重めのルアーで弾道を低く。PEの糸ふけに注意');
    if (spot.water === 'sea' && c.onshore < -0.5 && (c.wind || 0) >= 3) out.notes.push('追い風：飛距離が出る。沖の潮目まで届くチャンス');
    if (spot.water === 'river' && (c.flow || 0) > 12 && (c.rain6 || 0) < 5) out.notes.push('引き水・ささ濁り：警戒心が薄れる好機');
    if (c.solunar.label) out.notes.push(`${c.solunar.label}の時合：この前後1時間に集中`);
    const off = { 春: [3, 4, 5, 6], 夏: [6, 7, 8, 9], 秋: [8, 9, 10, 11, 12], 冬: [11, 12, 1, 2, 3] };
    const inSeason = (tip) => Object.entries(off).every(([k, ms]) => !tip.startsWith(k) && !tip.includes('の' + k) && !tip.includes(k + 'の') || ms.includes(month));
    out.notes.push(...(sp.tips || []).filter(inSeason).slice(0, 2));
    return out;
  }

  FH.engine = { conditions, score, safety, series, windows, rankSpots, topPicks, weekend, dangerScan, dataEnd, tactics, verdict, speciesFor, compass, seasonAt, HOUR };
})(typeof globalThis !== 'undefined' ? globalThis : this);
