// FishHunter back-test: do high scores line up with days people actually caught fish?
//   node tools/eval/backtest.mjs [--pages 20] [--refresh]
//
// Ground truth: daily catch posts of the two managed piers (ハッピーフィッシング直江津 / 新潟東港),
// which report every open day with counts per species. Their public RSS is paged back ~3 months.
// Conditions: Open-Meteo forecast API with past_days=92 (archived best-match forecast), i.e. the
// same kind of data the app scores live.
// Per species we compare the engine's mean score during opening hours (05–17 JST) with the day's
// reported catch (log fish count, and presence), and do the same for every single factor so we can
// see which inputs carry signal. Everything is cached under data/eval/ (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { extractCatches, extractVisitors, stripHtml } from '../intel/extract.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const CACHE = path.join(root, 'data/eval');
fs.mkdirSync(CACHE, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PAGES = +arg('--pages', 20);
const REFRESH = process.argv.includes('--refresh');
const UA = 'FishHunter/2.0 (+https://kt247240.github.io/fishhunter/; accuracy back-test)';
const DAY = 86400e3, H = 3600e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = { console, setTimeout, clearTimeout, performance, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['diagnostics', 'spots', 'astro', 'engine']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const FH = ctx.FH, E = FH.engine;

const PIERS = [
  { spot: 'naoetsu', feed: 'https://happyfishing-n.jp/feed/' },
  { spot: 'niigata-east', feed: 'https://happyfishing.jp/feed/' }
];

async function cached(name, fn) {
  const f = path.join(CACHE, name);
  if (!REFRESH && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

async function fetchText(url) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (k === 2) throw e; await sleep(2000 * (k + 1)); }
  }
}

/** Daily ground truth per pier: { 'YYYY-MM-DD': { sp: fishCount, _visitors } } */
async function history(p) {
  return cached(`history-${p.spot}.json`, async () => {
    const items = [];
    for (let page = 1; page <= PAGES; page++) {
      const xml = await fetchText(page === 1 ? p.feed : p.feed + '?paged=' + page);
      if (!xml) break;
      for (const b of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
        const tag = (n) => ((b[1].match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
        items.push({ title: stripHtml(tag('title')), date: Date.parse(tag('pubDate')), text: stripHtml(tag('content:encoded') || tag('description')) });
      }
      process.stderr.write(`  ${p.spot} page ${page}: ${items.length} posts\n`);
      await sleep(1500);
    }
    const days = {};
    for (const it of items) {
      if (!/釣果/.test(it.title) || !isFinite(it.date)) continue;
      const d = new Date(it.date + 9 * H).toISOString().slice(0, 10);
      const day = days[d] || (days[d] = { _posts: 0 });
      day._posts++;
      const v = extractVisitors(it.text); if (v) day._visitors = Math.max(day._visitors || 0, v);
      for (const c of extractCatches(it.title + '\n' + it.text)) {
        if (!c.sp) continue;
        day[c.sp] = (day[c.sp] || 0) + (c.mention ? 0.5 : c.count || 1);
      }
    }
    return days;
  });
}

async function weather(spotIds) {
  return cached('weather.json', async () => {
    const spots = spotIds.map((id) => FH.spotById[id]);
    const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const wx = JSON.parse(await fetchText('https://api.open-meteo.com/v1/forecast?' + q({
      latitude: spots.map((s) => s.lat).join(','), longitude: spots.map((s) => s.lon).join(','),
      hourly: 'temperature_2m,precipitation,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code',
      wind_speed_unit: 'ms', timezone: 'Asia/Tokyo', timeformat: 'unixtime', past_days: 92, forecast_days: 1
    })));
    const sea = spots.map((s) => { const f = ((s.face || 0) * Math.PI) / 180; return { lat: s.lat + 0.04 * Math.cos(f), lon: s.lon + 0.05 * Math.sin(f) }; });
    const mar = JSON.parse(await fetchText('https://marine-api.open-meteo.com/v1/marine?' + q({
      latitude: sea.map((s) => s.lat.toFixed(3)).join(','), longitude: sea.map((s) => s.lon.toFixed(3)).join(','),
      hourly: 'wave_height,wave_direction,wave_period,swell_wave_height,sea_surface_temperature',
      timezone: 'Asia/Tokyo', timeformat: 'unixtime', past_days: 92, forecast_days: 1
    })));
    const data = { wx: {}, marine: {} };
    [].concat(wx).forEach((row, i) => { const h = row.hourly; data.wx[spotIds[i]] = { time: h.time.map((t) => t * 1000), temp: h.temperature_2m, precip: h.precipitation, pressure: h.pressure_msl, cloud: h.cloud_cover, wind: h.wind_speed_10m, windDir: h.wind_direction_10m, gust: h.wind_gusts_10m, code: h.weather_code }; });
    [].concat(mar).forEach((row, i) => { const h = row.hourly; data.marine[spotIds[i]] = { time: h.time.map((t) => t * 1000), wave: h.wave_height, waveDir: h.wave_direction, wavePeriod: h.wave_period, swell: h.swell_wave_height, sst: h.sea_surface_temperature }; });
    return data;
  });
}

function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; }
  return r;
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const spearman = (x, y) => pearson(rank(x), rank(y));
/** AUC: P(score on a catch day > score on a blank day). */
function auc(scores, pos) {
  const P = scores.filter((_, i) => pos[i]), N = scores.filter((_, i) => !pos[i]);
  if (!P.length || !N.length) return null;
  let s = 0; for (const p of P) for (const q of N) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (P.length * N.length);
}
const f2 = (x) => (x == null ? '  —  ' : (x >= 0 ? ' ' : '') + x.toFixed(2));

/** Mean score and mean factor values over 05–17 JST of one day. */
function dayProfile(spot, sp, data, dateStr) {
  const t0 = Date.parse(dateStr + 'T05:00:00+09:00');
  let s = 0, n = 0; const f = {};
  for (let h = 0; h <= 12; h++) {
    const c = E.conditions(spot, t0 + h * H, data);
    if (!c.hasWx) continue;
    const r = E.score(spot, sp, c);
    s += r.score; n++;
    for (const x of r.factors) if (x.value != null) f[x.key] = (f[x.key] || 0) + x.value;
  }
  if (!n) return null;
  for (const k in f) f[k] /= n;
  return { score: s / n, f };
}

const EVAL_SPECIES = ['aji', 'saba', 'aori', 'kurodai', 'inada', 'kawahagi', 'madai', 'kisu'];

// --tune: candidate parameter changes, scored on the same data (applied to the species table in-place).
const SEA = () => EVAL_SPECIES.map((id) => FH.speciesById[id]);
const VARIANTS = {
  'base': () => {},
  'warm-tolerant': () => SEA().forEach((sp) => { sp.temp = [sp.temp[0], sp.temp[1], sp.temp[2] + 2, sp.temp[3] + 4]; }),
  'stain-aji-saba': () => ['aji', 'saba'].forEach((id) => { FH.speciesById[id].water = 'stain'; }),
  'wavier': () => ['aji', 'saba', 'kurodai'].forEach((id) => { const w = FH.speciesById[id].wave; FH.speciesById[id].wave = [w[0], w[1] + 0.3, w[2] + 0.2]; }),
};
VARIANTS['all'] = () => { VARIANTS['warm-tolerant'](); VARIANTS['stain-aji-saba'](); VARIANTS['wavier'](); };

async function main() {
  const hist = {};
  for (const p of PIERS) hist[p.spot] = await history(p);
  const data = await weather(PIERS.map((p) => p.spot));
  if (process.argv.includes('--tune')) {
    const snap = JSON.stringify(EVAL_SPECIES.map((id) => FH.speciesById[id]));
    for (const [name, patch] of Object.entries(VARIANTS)) {
      JSON.parse(snap).forEach((o) => Object.assign(FH.speciesById[o.id], o));
      patch();
      const o = evaluate(hist, data);
      console.log(`${name.padEnd(16)} 日ρ=${f2(o.meanRhoDay)}  ρ=${f2(o.meanRho)}  AUC=${f2(o.meanAuc)}  ρ/人=${f2(o.meanRhoCpue)}   ` + o.species.map((s) => s.sp + ':' + f2(s.rho).trim() + '/' + f2(s.rhoDay).trim()).join(' '));
    }
    return;
  }
  const out = evaluate(hist, data);
  console.log(out.lines.join('\n'));
  console.log(`\n加重平均 日ρ=${f2(out.meanRhoDay)}  ρ=${f2(out.meanRho)}  AUC=${f2(out.meanAuc)}  ρ/人=${f2(out.meanRhoCpue)}  （ρ>0・AUC>0.5 なら「スコアが高い日ほど釣れていた」）`);
  delete out.lines;
  fs.writeFileSync(path.join(CACHE, 'report.json'), JSON.stringify(out, null, 1));
}

function evaluate(hist, data) {
  const wxStart = data.wx[PIERS[0].spot].time[0];
  const out = { generated_at: new Date().toISOString(), species: [] };
  const lines = [];
  for (const spId of EVAL_SPECIES) {
    const sp = FH.speciesById[spId];
    const rows = [];
    for (const p of PIERS) {
      const spot = FH.spotById[p.spot];
      if (!spot.species.includes(spId)) continue;
      for (const [d, day] of Object.entries(hist[p.spot])) {
        if (Date.parse(d + 'T00:00:00+09:00') < wxStart + 3 * DAY) continue;
        const prof = dayProfile(spot, sp, data, d);
        if (!prof) continue;
        const fish = day[spId] || 0;
        rows.push({ spot: p.spot, d, fish, cpue: day._visitors ? fish / day._visitors : null, ...prof });
      }
    }
    if (rows.length < 8) continue;
    const y = rows.map((r) => Math.log1p(r.fish)), pos = rows.map((r) => r.fish > 0);
    const sc = rows.map((r) => r.score);
    // Day-to-day skill: remove each pier's ±7-day running mean so the season does not dominate.
    const anom = (get) => rows.map((r) => {
      const near = rows.filter((q) => q.spot === r.spot && Math.abs(Date.parse(q.d) - Date.parse(r.d)) <= 7 * DAY);
      return get(r) - near.reduce((a, q) => a + get(q), 0) / near.length;
    });
    const ya = anom((r) => Math.log1p(r.fish));
    const fac = {};
    for (const k of Object.keys(rows[0].f)) fac[k] = spearman(anom((r) => r.f[k] ?? 0), ya);
    const cp = rows.filter((r) => r.cpue != null);
    const res = { sp: spId, name: sp.name, days: rows.length, catchDays: pos.filter(Boolean).length, rho: spearman(sc, y), auc: auc(sc, pos), rhoCpue: spearman(cp.map((r) => r.score), cp.map((r) => r.cpue)), rhoDay: spearman(anom((r) => r.score), ya), factors: fac };
    out.species.push(res);
    lines.push(`${sp.name.padEnd(14, '　')} n=${String(rows.length).padStart(3)} 釣果日=${String(res.catchDays).padStart(3)}  ρ=${f2(res.rho)}  AUC=${f2(res.auc)}  ρ/人=${f2(res.rhoCpue)}  日ρ=${f2(res.rhoDay)} | ` +
      Object.entries(fac).map(([k, v]) => `${k}:${f2(v)}`).join(' '));
  }
  const w = out.species.filter((s) => s.rho != null);
  out.meanRho = w.reduce((a, s) => a + s.rho * s.days, 0) / w.reduce((a, s) => a + s.days, 0);
  const wa = out.species.filter((s) => s.auc != null);
  out.meanAuc = wa.reduce((a, s) => a + s.auc * s.days, 0) / wa.reduce((a, s) => a + s.days, 0);
  const wc = out.species.filter((s) => s.rhoCpue != null);
  out.meanRhoCpue = wc.reduce((a, s) => a + s.rhoCpue * s.days, 0) / wc.reduce((a, s) => a + s.days, 0);
  const wd = out.species.filter((s) => s.rhoDay != null);
  out.meanRhoDay = wd.reduce((a, s) => a + s.rhoDay * s.days, 0) / wd.reduce((a, s) => a + s.days, 0);
  out.lines = lines;
  return out;
}
main().catch((e) => { console.error(e); process.exit(1); });
