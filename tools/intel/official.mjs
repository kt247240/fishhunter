// FishHunter official data → data/official.json
//  • 新潟県水産海洋研究所 水揚げ情報（定置網, monthly CSV）   — 新潟県オープンデータ, CC BY 4.0
//  • 新潟県水産海洋研究所 海況情報（monthly PDF: 0/50/100 m means + 平年差） — 新潟県オープンデータ, CC BY 4.0
//  • River discharge at the main river mouths — GloFAS via Open-Meteo Flood API, CC BY 4.0
// (川の防災情報 / river.go.jp forbids tool-based retrieval, so it is not used.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const UA = 'FishHunter/2.0 (+https://kt247240.github.io/fishhunter/; official open data)';
const BASE = 'https://www.pref.niigata.lg.jp';
const DAY = 86400e3;

// Set-net columns → app species (others kept by name).
const LANDING_SP = { マアジ: 'aji', サバ類: 'saba', イワシ類: 'saba', イナダ: 'inada', 小ブリ: 'inada', 中ブリ: 'inada', 大ブリ: 'inada', サワラ: 'sagoshi', マダイ: 'madai', ヒラメ: 'hirame' };
const PORT_AREA = { 両津湾: '佐渡', 山北: '下越', 岩船: '下越', 新潟: '下越', 糸魚川: '上越', 青海町: '上越' };

export const RIVERS = [
  { id: 'hime', name: '姫川', lat: 37.025, lon: 137.775, spots: ['himeko'] },
  { id: 'seki', name: '関川', lat: 37.175, lon: 138.175, spots: ['naoetsu', 'kuroi'] },
  { id: 'bunsui', name: '大河津分水（信濃川）', lat: 37.625, lon: 138.775, spots: ['ohkouzu', 'teradomari'] },
  { id: 'niigata', name: '信濃川・阿賀野川', lat: 37.925, lon: 139.075, spots: ['niigata-west', 'aganogawa'] },
  { id: 'arakawa', name: '荒川', lat: 38.175, lon: 139.375, spots: ['iwafune', 'arakawa'] }
];

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r;
}
const links = (html, re) => [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => ({ href: m[1], text: m[2].trim() })).filter((l) => re.test(l.href + ' ' + l.text));

/** Parse one monthly landings CSV (already decoded) → set-net block. */
export function parseLandings(csv) {
  const rows = csv.split(/\r?\n/).map((l) => l.split(','));
  const start = rows.findIndex((r) => /^定置網/.test(r[0]));
  if (start < 0) return null;
  const head = rows[start + 1];
  const out = { ports: {}, total: {}, prev: {}, avg5: {} };
  for (let i = start + 2; i < rows.length && rows[i][0]; i++) {
    const [name, ...vals] = rows[i];
    const rec = {};
    head.forEach((h, k) => { if (k > 0 && h && h !== '計' && h !== 'その他') rec[h] = +vals[k - 1] || 0; });
    if (name === '計') out.total = rec; else if (name === '前年') out.prev = rec; else if (name === '5年平均') out.avg5 = rec; else out.ports[name] = rec;
  }
  return out;
}

/** Sum a parsed set-net table into app species: { sp: { t, prev, avg5, areas: {上越: t…} } }. */
export function landingsBySpecies(tab) {
  const out = {};
  for (const [col, sp] of Object.entries(LANDING_SP)) {
    const o = out[sp] || (out[sp] = { t: 0, prev: 0, avg5: 0, areas: {} });
    o.t += tab.total[col] || 0; o.prev += tab.prev[col] || 0; o.avg5 += tab.avg5[col] || 0;
    for (const [port, rec] of Object.entries(tab.ports)) { const a = PORT_AREA[port]; if (a) o.areas[a] = (o.areas[a] || 0) + (rec[col] || 0); }
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  for (const o of Object.values(out)) { o.t = r1(o.t); o.prev = r1(o.prev); o.avg5 = r1(o.avg5); for (const a in o.areas) o.areas[a] = r1(o.areas[a]); }
  return out;
}

/** Parse 海況情報 text: layer means, 平年差 wording and observation dates. */
export function parseKaikyo(text) {
  const t = text.normalize("NFKC").replace(/°C/g, "℃").replace(/\s+/g, " ");
  const m = t.match(/表層\(0m\)、50m層、100m層の平均水温は\s*それぞれ\s*([\d.]+)℃、([\d.]+)℃、([\d.]+)℃/);
  if (!m) return null;
  const obs = t.match(/観測月日:\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*~\s*(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日/);
  const an = (t.match(/\[平年差\]\s*([^[◎]{4,120})/) || [])[1] || '';
  const word = (layer) => { const r = new RegExp(layer + '[^“”"]{0,20}[“"]([^”"]+)[”"]'); return (an.match(r) || [])[1] || null; };
  const w50 = word('50m') || word('50m層と'), w0 = word('表層\\(0m\\)');
  return {
    t0: +m[1], t50: +m[2], t100: +m[3],
    anomaly: { t0: w0, t50: w50, t100: word('100m') || w50 },
    obs: obs ? { from: [+obs[1], +obs[2]], to: [+(obs[3] || obs[1]), +obs[4]] } : null,
    summary: an.trim().slice(0, 80)
  };
}

// 急潮情報 zones → spots (Sado tips go to both Sado zones: the notice text decides, we stay cautious).
export const KYUCHO_ZONES = {
  佐渡西岸: ['ogi', 'washizaki'], 佐渡東岸: ['ryotsu', 'washizaki', 'ogi'],
  新潟北部: ['sasagawa', 'iwafune', 'niigata-east', 'aganogawa', 'niigata-west'],
  新潟南部: ['ohkouzu', 'teradomari', 'izumozaki', 'kashiwazaki', 'kujiranami', 'kakizaki', 'kuroi', 'naoetsu', 'nadachi', 'tsutsuishi', 'nou-port', 'himeko', 'oyashirazu']
};
/**
 * Parse the 急潮情報 top page: only the fact that a notice is out (level, title, date, link) is kept.
 * → { active, items: [{ level: '警戒'|'注意'|'経過', title, url }], zones: [...] }
 */
export function parseKyucho(html, base = BASE) {
  const i = html.indexOf('現在発表している急潮情報'), j = html.indexOf('過去に発表した急潮情報', i + 1);
  if (i < 0) return null;
  const sec = html.slice(i, j > i ? j : i + 4000);
  const text = sec.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (/発表している急潮情報はありません/.test(text)) return { active: false, items: [], zones: [] };
  const items = [...sec.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => {
    const title = m[2].replace(/\s+/g, ' ').trim();
    const level = /警戒/.test(title) ? '警戒' : /注意/.test(title) ? '注意' : /経過/.test(title) ? '経過' : '情報';
    return { level, title: title.slice(0, 80), url: new URL(m[1], base + '/site/suisan-kenkyu/').href };
  });
  const zones = Object.keys(KYUCHO_ZONES).filter((z) => text.includes(z));
  return { active: true, items, zones };
}

async function kyucho() {
  const page = `${BASE}/site/suisan-kenkyu/kyucho.html`;
  const k = parseKyucho(await (await get(page)).text());
  if (!k) throw new Error('page layout changed');
  const spots = k.active ? [...new Set((k.zones.length ? k.zones : Object.keys(KYUCHO_ZONES)).flatMap((z) => KYUCHO_ZONES[z]))] : [];
  return Object.assign(k, { page, spots, checked: new Date().toISOString() });
}

async function landings(year) {
  const html = await (await get(`${BASE}/site/suisan-kenkyu/${year}mizuage.html`)).text();
  const csvs = links(html, /\.csv/).filter((l) => /(\d{1,2})月/.test(l.text));
  if (!csvs.length) return null;
  const last = csvs[csvs.length - 1];
  const month = +last.text.match(/(\d{1,2})月/)[1];
  const buf = Buffer.from(await (await get(BASE + last.href)).arrayBuffer());
  const tab = parseLandings(new TextDecoder('shift_jis').decode(buf));
  if (!tab) return null;
  return { year, month, url: BASE + last.href, page: `${BASE}/site/suisan-kenkyu/${year}mizuage.html`, species: landingsBySpecies(tab) };
}

async function kaikyo(year) {
  const page = `${BASE}/site/suisan-kenkyu/${year}kaikyou.html`;
  const html = await (await get(page)).text();
  const pdfs = links(html, /\.pdf/).filter((l) => /^\d{1,2}月/.test(l.text) && !/水深別/.test(l.text));
  if (!pdfs.length) return null;
  const last = pdfs[pdfs.length - 1];
  const month = +last.text.match(/(\d{1,2})月/)[1];
  const file = path.join(os.tmpdir(), 'fh-kaikyo.pdf');
  fs.writeFileSync(file, Buffer.from(await (await get(BASE + last.href)).arrayBuffer()));
  const text = execFileSync('python3', [new URL('./pdftext.py', import.meta.url).pathname, file], { encoding: 'utf8', timeout: 60000 });
  const k = parseKaikyo(text);
  return k ? Object.assign({ year, month, url: BASE + last.href, page }, k) : null;
}

async function rivers(now) {
  const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const start = new Date(now - 90 * DAY).toISOString().slice(0, 10), end = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  const arr = [].concat(await (await get('https://flood-api.open-meteo.com/v1/flood?' + q({
    latitude: RIVERS.map((r) => r.lat).join(','), longitude: RIVERS.map((r) => r.lon).join(','), daily: 'river_discharge', start_date: start, end_date: end
  }))).json());
  const today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  return RIVERS.map((r, i) => {
    const d = arr[i].daily;
    const past = d.time.map((t, k) => [t, d.river_discharge[k]]).filter(([t, v]) => t <= today && v != null);
    const sorted = past.map(([, v]) => v).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const series = d.time.map((t, k) => [t, d.river_discharge[k]]).filter(([t, v]) => v != null && t >= new Date(now - 14 * DAY).toISOString().slice(0, 10));
    return Object.assign({}, r, { median: Math.round(median), series: series.map(([t, v]) => [t, Math.round(v)]) });
  });
}

export async function collectOfficial(outDir, now = Date.now(), prev = null) {
  const year = new Date(now + 9 * 3600e3).getUTCFullYear();
  const out = { schema: 'fishhunter.official/1', generated_at: new Date(now).toISOString(), credits: [], errors: [] };
  const tryYears = async (fn) => { try { return (await fn(year)) || (await fn(year - 1)); } catch (e) { try { return await fn(year - 1); } catch (_) { throw e; } } };
  try { out.landings = await tryYears(landings); if (out.landings) out.credits.push('新潟県水産海洋研究所「水揚げ情報」（新潟県オープンデータ, CC BY 4.0）を加工'); } catch (e) { out.errors.push('landings: ' + e.message); }
  try { out.kaikyo = await tryYears(kaikyo); if (out.kaikyo) out.credits.push('新潟県水産海洋研究所「海況情報」（新潟県オープンデータ, CC BY 4.0）を加工'); } catch (e) { out.errors.push('kaikyo: ' + e.message); }
  try { out.kyucho = await kyucho(); } catch (e) { out.errors.push('kyucho: ' + e.message); }
  try { out.rivers = await rivers(now); out.credits.push('河川流量: GloFAS（Copernicus）via Open-Meteo Flood API, CC BY 4.0'); } catch (e) { out.errors.push('rivers: ' + e.message); }
  // A source that failed this time keeps its last good value (flagged stale).
  for (const k of ['landings', 'kaikyo', 'rivers']) if (!out[k] && prev && prev[k]) { out[k] = prev[k]; out.stale = [...(out.stale || []), k]; }
  if (out.stale) out.credits = [...new Set([...out.credits, ...((prev && prev.credits) || [])])];
  fs.writeFileSync(path.join(outDir, 'official.json'), JSON.stringify(out));
  return out;
}
