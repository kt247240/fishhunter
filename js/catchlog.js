/* FishHunter — personal catch log + pattern learning.
 * Every entry snapshots the conditions at catch time so the app can learn
 * *your* winning patterns and feed them back into the HUNT score.
 * Stored locally (localStorage); export/import as JSON for backup.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const KEY = 'fh.catchlog.v1';
  let entries = null;
  let statCache = new Map();
  const listeners = new Set();

  function read() {
    if (entries) return entries;
    try { entries = JSON.parse(g.localStorage.getItem(KEY)) || []; } catch (_) { entries = []; }
    return entries;
  }
  function write() {
    statCache = new Map();
    try {
      g.localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (e) {
      // Quota exceeded (photos). Drop the oldest photos and retry once.
      const withPhoto = entries.filter((x) => x.photo).sort((a, b) => a.t - b.t);
      if (withPhoto.length) { withPhoto.slice(0, Math.ceil(withPhoto.length / 2)).forEach((x) => { delete x.photo; }); }
      try { g.localStorage.setItem(KEY, JSON.stringify(entries)); } catch (_) { throw new Error('保存容量が不足しています。エクスポートして古い記録を整理してください'); }
    }
    listeners.forEach((fn) => { try { fn(); } catch (_) { /* isolate */ } });
  }

  /** Compact snapshot of the conditions worth learning from. */
  function snapshot(c, scoreVal) {
    if (!c) return null;
    const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    return {
      light: c.light && c.light.label, tide: c.tide && c.tide.name, moonAge: r1(c.moonAge),
      temp: r1(c.temp), waterTemp: r1(c.waterTemp), waterTempEst: !!c.waterTempEst,
      wind: r1(c.wind), windDir: c.windDir, wave: r1(c.wave), pressure: r1(c.pressure), dp3: r1(c.dp3),
      cloud: c.cloud, code: c.code, rain24: r1(c.rain24), murk: r1(c.murk), score: scoreVal == null ? null : scoreVal
    };
  }

  function add(e) {
    read();
    const entry = Object.assign({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now() }, e);
    entries.unshift(entry);
    entries.sort((a, b) => b.t - a.t);
    write();
    return entry;
  }
  function remove(id) { read(); entries = entries.filter((x) => x.id !== id); write(); }
  function all() { return read().slice(); }

  function exportJSON() { return JSON.stringify({ app: 'FishHunter', kind: 'catchlog', version: 1, exportedAt: new Date().toISOString(), entries: read() }, null, 2); }
  function importJSON(text) {
    const d = JSON.parse(text);
    const list = Array.isArray(d) ? d : d && d.entries;
    if (!Array.isArray(list)) throw new Error('FishHunterの釣果データではありません');
    read();
    const ids = new Set(entries.map((x) => x.id));
    let n = 0;
    for (const x of list) { if (x && x.id && x.t && !ids.has(x.id)) { entries.push(x); n++; } }
    entries.sort((a, b) => b.t - a.t);
    write();
    return n;
  }

  const pressureBucket = (dp3) => (dp3 == null ? null : dp3 <= -0.5 ? '下降' : dp3 >= 0.5 ? '上昇' : '安定');
  function tally(list, fn) {
    const m = {};
    list.forEach((x) => { const k = fn(x); if (k != null) m[k] = (m[k] || 0) + (x.count || 1); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }

  /** Aggregate patterns (optionally for one species). */
  function analyze(speciesId) {
    const key = speciesId || '*';
    if (statCache.has(key)) return statCache.get(key);
    const list = read().filter((x) => !speciesId || x.speciesId === speciesId);
    const fish = list.reduce((s, x) => s + (x.count || 1), 0);
    const sizes = list.map((x) => x.size).filter((x) => x > 0);
    const r = {
      entries: list.length, fish,
      maxSize: sizes.length ? Math.max(...sizes) : null,
      avgSize: sizes.length ? Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 10) / 10 : null,
      byLight: tally(list, (x) => x.cond && x.cond.light),
      byTide: tally(list, (x) => x.cond && x.cond.tide),
      byPressure: tally(list, (x) => x.cond && pressureBucket(x.cond.dp3)),
      bySpot: tally(list, (x) => x.spotId),
      bySpecies: tally(list, (x) => x.speciesId),
      byMethod: tally(list, (x) => x.method || null),
      byColor: tally(list, (x) => x.lureColor || null),
      avgScore: (() => { const s = list.map((x) => x.cond && x.cond.score).filter((v) => v != null); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null; })()
    };
    statCache.set(key, r);
    return r;
  }

  /** Bonus (0..6) when the current conditions match your proven pattern. Needs ≥3 entries. */
  function personalBoost(speciesId, c) {
    const a = analyze(speciesId);
    if (a.entries < 3 || !c) return null;
    const share = (pairs, k) => { const tot = pairs.reduce((s, p) => s + p[1], 0); const hit = pairs.find((p) => p[0] === k); return tot && hit ? hit[1] / tot : 0; };
    const sl = share(a.byLight, c.light && c.light.label);
    const st = share(a.byTide, c.tide && c.tide.name);
    const sp = share(a.byPressure, pressureBucket(c.dp3));
    let bonus = 0; const why = [];
    if (sl >= 0.4) { bonus += 3 * sl; why.push(`${c.light.label}（実績の${Math.round(sl * 100)}%）`); }
    if (st >= 0.4) { bonus += 2 * st; why.push(`${c.tide.name}（${Math.round(st * 100)}%）`); }
    if (sp >= 0.5) { bonus += 1.5 * sp; why.push(`気圧${pressureBucket(c.dp3)}（${Math.round(sp * 100)}%）`); }
    if (!bonus) return null;
    return { bonus: Math.min(6, bonus), note: why.join('・') };
  }

  FH.catchlog = { add, remove, all, analyze, personalBoost, snapshot, exportJSON, importJSON, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
