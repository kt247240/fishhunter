// FishHunter engine tests — run with `node tools/test-engine.mjs`.
// Loads the browser modules into a VM context with synthetic weather data,
// so it needs no network and is deterministic.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const mem = new Map();
const ctx = {
  console, setTimeout, clearTimeout, performance,
  localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['diagnostics', 'spots', 'astro', 'weather', 'feed', 'catchlog', 'engine']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
const FH = ctx.FH;
const H = 3600e3;

/** Constant-condition hourly series around `center`, with optional per-hour overrides. */
function synth(center, { wx = {}, marine = {}, spots = FH.SPOTS } = {}) {
  const t0 = Math.floor(center / H) * H - 72 * H;
  const time = Array.from({ length: 170 }, (_, i) => t0 + i * H);
  const fill = (v) => time.map((t, i) => (typeof v === 'function' ? v(t, i) : v));
  const W = { temp: 20, precip: 0, pressure: 1013, cloud: 30, wind: 3, windDir: 150, gust: 5, code: 1, ...wx };
  const M = { wave: 0.5, waveDir: 315, wavePeriod: 6, swell: 0.3, sst: 20, ...marine };
  const data = { wx: {}, marine: {}, fetchedAt: center };
  for (const s of spots) {
    data.wx[s.id] = Object.fromEntries([['time', time], ...Object.entries(W).map(([k, v]) => [k, fill(v)])]);
    if (s.water === 'sea') data.marine[s.id] = Object.fromEntries([['time', time], ...Object.entries(M).map(([k, v]) => [k, fill(v)])]);
  }
  return data;
}

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name); throw e; } };
const A = FH.astro, E = FH.engine;
const naoetsu = FH.spotById.naoetsu;

console.log('astro');
test('Naoetsu sunrise/sunset on 2026-09-25 match almanac (±5 min)', () => {
  const s = A.sunTimes(new Date('2026-09-25T03:00:00Z'), naoetsu.lat, naoetsu.lon);
  const hm = (d) => { const p = A.jstParts(d); return p.h * 60 + p.min; };
  assert.ok(Math.abs(hm(s.rise) - (5 * 60 + 36)) <= 5, 'rise ' + hm(s.rise));
  assert.ok(Math.abs(hm(s.set) - (17 * 60 + 40)) <= 5, 'set ' + hm(s.set));
});
test('moon age at full moon 2026-09-26 16:49Z ≈ 14.8', () => {
  const age = A.moonAge(new Date('2026-09-26T16:49:00Z'));
  assert.ok(age > 14 && age < 15.8, String(age));
  assert.equal(A.tideName(new Date('2026-09-26T16:49:00Z')).name, '大潮');
});
test('new moon day is 大潮', () => assert.equal(A.tideName(new Date('2026-10-10T12:00:00Z')).name, '大潮'));
test('solunar yields major periods (moon transits) each day', () => {
  const s = A.solunar(new Date('2026-09-25T03:00:00Z'), naoetsu.lat, naoetsu.lon);
  assert.ok(s.major.length >= 2);
});

console.log('engine');
const autumnNoon = Date.parse('2026-10-05T03:00:00Z');
test('calm autumn morning mazume scores Aori high', () => {
  const data = synth(autumnNoon);
  const rise = A.sunTimes(new Date(autumnNoon), naoetsu.lat, naoetsu.lon).rise.getTime();
  const r = E.score(naoetsu, FH.speciesById.aori, E.conditions(naoetsu, rise, data));
  assert.ok(r.score >= 65, 'score ' + r.score);
  assert.equal(r.safety.level, 0);
});
test('high waves force danger and cap score ≤12', () => {
  const data = synth(autumnNoon, { marine: { wave: 3.2 } });
  const r = E.score(naoetsu, FH.speciesById.aori, E.conditions(naoetsu, autumnNoon, data));
  assert.equal(r.safety.level, 2);
  assert.ok(r.score <= 12);
});
test('thunderstorm code triggers danger inland too', () => {
  const s = FH.spotById.nojiri;
  const data = synth(autumnNoon, { wx: { code: 95 } });
  assert.equal(E.score(s, FH.speciesById.bass, E.conditions(s, autumnNoon, data)).safety.level, 2);
});
test('off-season species is suppressed (Aori in February)', () => {
  const feb = Date.parse('2026-02-10T03:00:00Z');
  const r = E.score(naoetsu, FH.speciesById.aori, E.conditions(naoetsu, feb, synth(feb, { marine: { sst: 11 } })));
  assert.ok(r.score < 20, 'score ' + r.score);
});
test('river flood rain → danger; moderate rain after → better than drought for trout', () => {
  const s = FH.spotById.uonogawa, sp = FH.speciesById.yamame;
  const may = Date.parse('2026-05-15T03:00:00Z');
  const flood = synth(may, { wx: { precip: 4, temp: 14 } });
  assert.equal(E.score(s, sp, E.conditions(s, may, flood)).safety.level, 2);
  const tri = (t) => (t < may - 30 * H && t > may - 60 * H ? 0.5 : 0); // ~15mm, 1–2 days ago
  const stained = E.score(s, sp, E.conditions(s, may, synth(may, { wx: { precip: tri, temp: 14 } })));
  const dry = E.score(s, sp, E.conditions(s, may, synth(may, { wx: { precip: 0, temp: 14 } })));
  assert.ok(stained.score > dry.score, `${stained.score} > ${dry.score}`);
});
test('falling pressure beats sharply rising pressure', () => {
  const fall = synth(autumnNoon, { wx: { pressure: (t) => 1015 - (t - autumnNoon) / H * 0.4 } });
  const rise = synth(autumnNoon, { wx: { pressure: (t) => 1015 + (t - autumnNoon) / H * 0.8 } });
  const sp = FH.speciesById.seabass;
  assert.ok(E.score(naoetsu, sp, E.conditions(naoetsu, autumnNoon, fall)).score > E.score(naoetsu, sp, E.conditions(naoetsu, autumnNoon, rise)).score);
});
test('windows() finds a contiguous peak block and skips danger hours', () => {
  const data = synth(autumnNoon);
  const ser = E.series(naoetsu, FH.speciesById.aori, data, autumnNoon, 48);
  const w = E.windows(ser, { min: 0, limit: 3 });
  assert.ok(w.length >= 1 && w[0].end > w[0].start && w[0].peak >= w[0].avg);
});
test('topPicks returns unique spots, ≤2 per species', () => {
  const picks = E.topPicks(synth(autumnNoon), autumnNoon, 12, 8);
  assert.equal(new Set(picks.map((p) => p.spot.id)).size, picks.length);
  const per = {}; picks.forEach((p) => { per[p.sp.id] = (per[p.sp.id] || 0) + 1; });
  assert.ok(Object.values(per).every((n) => n <= 2));
});
test('tactics adapt egi size to season and colour to night', () => {
  const data = synth(autumnNoon);
  const night = Date.parse('2026-10-05T13:00:00Z');
  const t = E.tactics(naoetsu, FH.speciesById.aori, E.conditions(naoetsu, night, data));
  assert.match(t.size, /2\.5〜3\.0号/);
  assert.match(t.color.main, /赤テープ/);
  assert.ok(t.aim.length > 0);
});
test('every spot references known species with matching habitat', () => {
  for (const s of FH.SPOTS) for (const id of s.species) {
    const sp = FH.speciesById[id];
    assert.ok(sp, `${s.id}: unknown species ${id}`);
    assert.ok(sp.habitat.includes(s.water), `${s.id}: ${id} habitat mismatch`);
  }
});

test('weekend() returns Sat/Sun with picks inside the forecast range', () => {
  const thu = Date.parse('2026-10-01T03:00:00Z'); // Thursday noon JST
  const data = synth(thu);
  const wk = E.weekend(data, thu, { limit: 2 });
  assert.equal(wk.length, 2);
  assert.equal(wk.map((d) => d.label).join(), '土,日');
  assert.equal(A.jstParts(new Date(wk[0].day)).dow, 6);
  assert.ok(wk[0].inRange && wk[0].picks.length > 0);
  assert.ok(wk[1].inRange, 'synthetic data runs 98h past Thursday noon, covering Sunday');
  const late = E.weekend(synth(Date.parse('2026-09-28T03:00:00Z')), Date.parse('2026-09-28T03:00:00Z'));
  assert.ok(!late[0].inRange && late[0].picks.length === 0, 'Monday: next weekend is beyond the data');
});
test('dangerScan() groups consecutive danger hours per spot', () => {
  const data = synth(autumnNoon, { marine: { wave: (t) => (t >= autumnNoon + 5 * H && t < autumnNoon + 9 * H ? 3 : 0.5) } });
  const d = E.dangerScan(data, autumnNoon, 24).filter((x) => x.spot.id === 'naoetsu');
  assert.equal(d.length, 1);
  assert.equal((d[0].end - d[0].start) / H, 4);
  assert.equal(d[0].reasons.join(), '高波');
});

console.log('catchlog');
test('personal pattern boosts matching conditions after 3 catches', () => {
  const data = synth(autumnNoon);
  const rise = A.sunTimes(new Date(autumnNoon), naoetsu.lat, naoetsu.lon).rise.getTime();
  const c = E.conditions(naoetsu, rise, data);
  for (let i = 0; i < 3; i++) FH.catchlog.add({ t: rise - i * 86400e3, spotId: 'naoetsu', speciesId: 'aori', count: 1, cond: FH.catchlog.snapshot(c, 70) });
  const b = FH.catchlog.personalBoost('aori', c);
  assert.ok(b && b.bonus > 0 && b.bonus <= 6);
  const round = FH.catchlog.importJSON(FH.catchlog.exportJSON());
  assert.equal(round, 0, 'import dedupes by id');
});

test('after a blow eases, sea spots get the 時化後 bonus; a flat week does not', () => {
  const now = Date.parse('2026-09-20T06:30:00+09:00');
  const calm = synth(now);
  const blown = synth(now, { marine: { wave: (t) => (t < now - 8 * H ? 2.2 : 0.8) } });
  const sp = FH.speciesById.aji;
  const a = E.score(naoetsu, sp, E.conditions(naoetsu, now, calm));
  const b = E.score(naoetsu, sp, E.conditions(naoetsu, now, blown));
  assert.ok(!a.factors.some((f) => f.key === 'after'));
  const f = b.factors.find((x) => x.key === 'after');
  assert.ok(f && f.impact > 3, JSON.stringify(f));
  assert.ok(b.score > a.score - 2, `${b.score} vs ${a.score}`);
});

test('サクラマス on a river scores 0 outside the legal window; not listed on 魚野川', () => {
  const ara = FH.spotById.arakawa, sp = FH.speciesById.sakuramasu;
  const out = E.score(ara, sp, E.conditions(ara, Date.parse('2026-06-20T07:00:00+09:00'), synth(Date.parse('2026-06-20T07:00:00+09:00'))));
  assert.equal(out.score, 0); assert.ok(out.closed);
  const inn = E.score(ara, sp, E.conditions(ara, Date.parse('2026-04-10T07:00:00+09:00'), synth(Date.parse('2026-04-10T07:00:00+09:00'), { wx: { temp: 9 } })));
  assert.ok(inn.score > 0 && !inn.closed);
  assert.ok(!FH.spotById.uonogawa.species.includes('sakuramasu'));
});
test('summer thermocline: a too-warm surface no longer zeroes the temperature factor', () => {
  const t = Date.parse('2026-08-20T06:00:00+09:00');
  const r = E.score(naoetsu, FH.speciesById.aji, E.conditions(naoetsu, t, synth(t, { marine: { sst: 29 } })));
  const f = r.factors.find((x) => x.key === 'temp');
  assert.ok(f.value > 0.3, String(f.value)); assert.match(f.note, /深め/);
  const w = Date.parse('2026-12-20T06:00:00+09:00');
  const r2 = E.score(naoetsu, FH.speciesById.aji, E.conditions(naoetsu, w, synth(w, { marine: { sst: 29 } })));
  assert.ok(r2.factors.find((x) => x.key === 'temp').value < 0.1, 'no thermocline outside Jun–Oct');
});

test('急潮【警戒】 adds a caution for the zone\'s spots only', () => {
  const t = Date.parse('2026-09-20T07:00:00+09:00'), d = synth(t);
  const keep = FH.feed.kyucho;
  FH.feed.kyucho = (id) => (id === 'naoetsu' ? { active: true, items: [{ level: '警戒' }], spots: ['naoetsu'] } : null);
  try {
    const s1 = E.safety(naoetsu, E.conditions(naoetsu, t, d));
    assert.equal(s1.level, 1); assert.match(s1.reasons.join(), /急潮【警戒】/);
    const s2 = E.safety(FH.spotById.ryotsu, E.conditions(FH.spotById.ryotsu, t, d));
    assert.ok(!s2.reasons.some((r) => /急潮/.test(r)));
  } finally { FH.feed.kyucho = keep; }
});

test('catch log: ボウズ trips count for the review but not for learned patterns', () => {
  const L = FH.catchlog;
  const base = Date.parse('2026-09-20T06:00:00+09:00');
  const mk = (d, count, score) => L.add({ t: base + d * 86400e3, spotId: 'naoetsu', speciesId: 'kisu', count, cond: { light: '朝マズメ', score } });
  mk(0, 3, 82); mk(1, 0, 88); mk(2, 0, 40); mk(3, 2, 60); mk(3, 1, 64);
  const a = L.analyze('kisu');
  assert.equal(a.entries, 3); assert.equal(a.blanks, 2); assert.equal(a.fish, 6);
  const rv = L.review('kisu');
  assert.equal(rv.trips.length, 4, 'two entries on the same day are one trip');
  const b85 = rv.buckets.find((b) => b.label === '85〜'), b70 = rv.buckets.find((b) => b.label === '70〜84');
  assert.equal(b85.n, 1); assert.equal(b85.hit, 0); assert.equal(b70.rate, 1);
  assert.equal(rv.trips.find((t) => t.score === 88).verdict, 'over');
  assert.equal(rv.trips.find((t) => t.score === 40).verdict, 'hit');
  L.all().filter((x) => x.speciesId === 'kisu').forEach((x) => L.remove(x.id));
});

test('personal pattern learns 時化後 and water temperature, not tide', () => {
  const L = FH.catchlog;
  const base = Date.parse('2026-09-01T06:00:00+09:00');
  for (let k = 0; k < 4; k++) L.add({ t: base + k * 86400e3, spotId: 'naoetsu', speciesId: 'mejina', count: 2, cond: { light: '日中', tide: ['大潮', '小潮', '中潮', '長潮'][k], waterTemp: 22 + k * 0.3, wave: 0.6, wavePrev: 1.6 } });
  const c = { light: { label: '日中' }, tide: { name: '若潮' }, waterTemp: 22.4, wave: 0.7, wavePrev: 1.5, dp3: 0 };
  const b = L.personalBoost('mejina', c);
  assert.ok(b && b.bonus >= 5, JSON.stringify(b));
  assert.match(b.note, /時化後/); assert.match(b.note, /水温/); assert.doesNotMatch(b.note, /大潮|若潮|中潮/);
  const calm = L.personalBoost('mejina', Object.assign({}, c, { wavePrev: 0.5, waterTemp: 27 }));
  assert.ok(!calm || !/時化後|水温/.test(calm.note));
  L.all().filter((x) => x.speciesId === 'mejina').forEach((x) => L.remove(x.id));
});

test('lake water estimate uses the learned correction when present', () => {
  const noj = FH.spotById.nojiri, t = Date.parse('2026-08-10T12:00:00+09:00'), d = synth(t, { wx: { temp: 24 } });
  const raw = E.conditions(noj, t, d).waterTemp;
  const keep = FH.feed.waterBias;
  FH.feed.waterBias = (id, m) => (id === 'nojiri' && m === 8 ? 2.9 : null);
  try {
    const c = E.conditions(noj, t + 1, d);
    assert.ok(Math.abs(c.waterTemp - raw - 2.9) < 0.01, `${raw} → ${c.waterTemp}`);
    assert.ok(c.waterTempCal);
    assert.match(E.score(noj, FH.speciesById.bass, c).factors.find((f) => f.key === 'temp').note, /実測で補正/);
  } finally { FH.feed.waterBias = keep; }
});

console.log(`\nFishHunter engine tests: ${passed} passed`);
