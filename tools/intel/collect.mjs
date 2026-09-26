// FishHunter catch-intel collector.
//   node tools/intel/collect.mjs [out.json]
// Pulls public syndication feeds (RSS/Atom) and the Bluesky public search API,
// turns reports into structured catches, and aggregates per spot / area.
// Politeness: identified UA, robots-respecting sources only (see sources.json),
// sequential requests with a delay, short excerpts + links only.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { mergeArchive, buildHotspots, coverage } from './archive.mjs';
import { extractCatches, extractTime, extractColorNotes, extractNotices, extractVisitors, matchSpots, snippet, stripHtml, normalize } from './extract.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools/intel/sources.json'), 'utf8'));
const OUT = process.argv[2] || path.join(root, 'data/intel.json');
const UA = 'FishHunter/2.0 (+https://kt247240.github.io/fishhunter/; catch-intel collector)';
const DAY = 86400e3;
const NOW = Date.now();
const MAX_AGE = 30 * DAY;

// Spot knowledge base from the app itself.
const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/spots.js'), 'utf8'), ctx);
const SPOTS = ctx.FH.SPOTS;
const AREA_WORDS = [
  ['上越', /上越|糸魚川|能生|名立|直江津|親不知/], ['中越', /柏崎|長岡|出雲崎|寺泊|燕|三条|魚沼/], ['下越', /新潟市|新潟東港|新潟西港|村上|新発田|聖籠|胎内|岩船/],
  ['佐渡', /佐渡/], ['北信', /野尻湖|長野市|信濃町|須坂|飯山/], ['中信', /安曇野|松本|大町|木崎湖|青木湖|梓川/], ['東信', /上田|佐久|小海|松原湖/], ['南信', /諏訪|伊那|木曽|天竜/]
];

const BOT_RE = /記事の要約|をお届け|お伝えします|振り返|に関する記事|明日の朝まずめ|明朝の|釣り情報|最新釣果|最適な時間帯|#PR|プレゼント|キャンペーン/;
const BOAT_RE = /沖で|沖では|沖の|[^\s]沖 |船釣り|遊漁船|乗合|ジギング船|タイラバ船|丸さん|ティップラン|ボートで/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, accept) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: accept || '*/*', 'accept-language': 'ja,en;q=0.7' }, signal: ctl.signal, redirect: 'follow' });
    return r;
  } finally { clearTimeout(t); }
}

function parseFeed(xml) {
  const items = [];
  const blocks = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g), ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const tag = (b, n) => { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)); return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : ''; };
  for (const b of blocks) {
    const link = tag(b, 'link') || ((b.match(/<link[^>]+href="([^"]+)"/) || [])[1] || '');
    const html = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary');
    const date = Date.parse(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'));
    items.push({ title: stripHtml(tag(b, 'title')).trim(), url: link.trim(), date: isFinite(date) ? date : null, text: stripHtml(html) });
  }
  return items;
}

function areaOf(text, fallback) {
  const hit = AREA_WORDS.find(([, re]) => re.test(text));
  return hit ? hit[0] : fallback || null;
}

const INLAND = new Set(['北信', '中信', '東信', '南信']);
const SEA_ONLY = new Set(ctx.FH.SPECIES.filter((s) => s.habitat.every((h) => h === 'sea')).map((s) => s.id));

function toReport(src, it, extra = {}) {
  const full = `${it.title}\n${it.text}`;
  const catches = extra.catches || extractCatches(full);
  const spots = [...new Set([...(src.spots || []), ...matchSpots(full, SPOTS)])];
  let area = areaOf(full, null) || (spots[0] && SPOTS.find((s) => s.id === spots[0]).area) || src.area || null;
  // An inland shop reporting a sea trip without naming the place: don't pin it to the shop's area.
  if (!areaOf(full, null) && !spots.length && INLAND.has(area) && catches.some((c) => SEA_ONLY.has(c.sp))) area = null;
  const { catches: _c, ...rest } = extra;
  // Shops sometimes report boat trips: keep them, but out of the shore statistics.
  const type = src.type !== 'boat' && BOAT_RE.test(full) ? 'boat' : src.type;
  return {
    id: Buffer.from(it.url || it.title).toString('base64url').slice(-24),
    src: src.id, srcName: src.name, type,
    title: snippet(it.title, 60), url: it.url, date: it.date,
    area, spots, text: snippet(it.text, 160),
    catches, time: extractTime(it.title, it.text), colors: extractColorNotes(it.text),
    notices: src.type === 'coop' || src.type === 'official' ? extractNotices(it.title, it.text) : [],
    ...(src.type === 'official' && extractVisitors(it.text) != null ? { visitors: extractVisitors(it.text) } : {}),
    ...rest
  };
}
// Keep reports that carry information and are inside Niigata / Nagano.
const useful = (r) => (r.catches.length || r.notices.length || r.obs) && (r.area || r.spots.length);

// Reports older than MAX_AGE found while back-filling: archive only (not in intel.json).
const HISTORY = [];
let ARCHIVE_COVERAGE = {};

async function collectRss(src) {
  const items = [];
  // A source with deepPages is paged further back once, until the archive holds ~45 days of it.
  const deep = src.deepPages && !(ARCHIVE_COVERAGE[src.id] <= NOW - 45 * DAY);
  const pages = deep ? src.deepPages : src.pages || 1;
  for (let page = 1; page <= pages; page++) {
    const url = page === 1 ? src.url : src.url + (src.url.includes('?') ? '&' : '?') + 'paged=' + page;
    const r = await get(url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5');
    if (!r.ok) { if (page === 1) throw new Error('HTTP ' + r.status); break; }
    items.push(...parseFeed(await r.text()));
    if (page < pages) await sleep(1500);
  }
  const tf = src.titleFilter ? new RegExp(src.titleFilter) : null;
  if (deep) HISTORY.push(...items.filter((it) => it.date && NOW - it.date > MAX_AGE && (!tf || tf.test(it.title))).map((it) => toReport(src, it)).filter(useful));
  return items.filter((it) => it.date && NOW - it.date <= MAX_AGE && (!tf || tf.test(it.title))).map((it) => toReport(src, it)).filter(useful);
}

/* ───────── HTML parsers for sources without feeds ───────── */
const PARSERS = {
  // 上州屋: one <div class="choka__body"> per report with "YYYY年MM月DD日の釣果", 釣り場 and comment.
  johshuya(html, src) {
    return html.split('<div class="choka__body">').slice(1, 11).map((b, i) => {
      const t = normalize(stripHtml(b)).replace(/\n\s*\n+/g, '\n');
      const m = t.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日の釣果/);
      if (!m) return null;
      const place = (t.match(/釣り場\s*\n?\s*([^\n]{1,30})/) || [])[1] || '';
      const body = t.slice(t.indexOf('釣り人')).replace(/^釣り人\s*\n?[^\n]*\n/, '');
      const pl = place.trim() && !/^釣り人/.test(place.trim()) ? place.trim() + ' の釣果' : '店舗の釣果情報';
      return { title: pl, url: src.url + '#p' + String(i + 1).padStart(2, '0'), date: Date.UTC(+m[1], +m[2] - 1, +m[3], 3), text: place + '\n' + body };
    }).filter(Boolean);
  },
  // 野尻湖マリーナ: daily blocks "MM月DD日（曜）天候…水温 24℃…スモールマウス：30cm～46cm ？匹～6匹 コメント…"
  nojiriko(html, src) {
    const t = normalize(stripHtml(html)).replace(/\s+/g, ' ');
    const year = new Date(NOW + 9 * 3600e3).getUTCFullYear();
    const parts = t.split(/(?=(\d{2})月(\d{2})日\s*\([月火水木金土日]\))/).filter((x) => /^\d{2}月\d{2}日/.test(x));
    return parts.slice(0, 10).map((p) => {
      const d = p.match(/^(\d{2})月(\d{2})日/);
      let date = Date.UTC(year, +d[1] - 1, +d[2], 3);
      if (date > NOW + DAY) date = Date.UTC(year - 1, +d[1] - 1, +d[2], 3);
      const wt = p.match(/水温\s*(\d{1,2}(?:\.\d)?)\s*(?:℃|°C|度)/);
      const clarity = (p.match(/水質\s*(\S+?)\s*(?=平均釣果|コメント)/) || [])[1] || null;
      const sm = p.match(/スモールマウス:\s*(\d{1,2})cm~(\d{1,2})cm\s*(\S*?)匹~(\d{1,2})匹/);
      const lg = p.match(/ラージマウス:\s*(\d{1,2})cm~(\d{1,2})cm\s*(\S*?)匹~(\d{1,2})匹/);
      const comment = (p.split('コメント')[1] || '').trim();
      const catches = [];
      const mk = (m, alias) => catches.push({ sp: 'bass', name: 'スモールマウスバス', alias, count: +m[4] || null, min: +m[1], max: +m[2], method: (comment.match(/ライトリグ|ダウンショット|ネコリグ|ノーシンカー|シャッド|ミノー|ペンシル/) || [null])[0] && (/シャッド/.test(comment) && !/ライトリグ/.test(comment) ? 'シャッド' : 'ライトリグ'), mention: false });
      if (sm) mk(sm, 'スモールマウス');
      if (lg) mk(lg, 'ラージマウス');
      return {
        title: `${d[1]}/${d[2]} 野尻湖 バス釣果`, url: src.url, date, text: comment,
        extra: { catches, obs: wt ? { waterTemp: +wt[1], clarity } : null }
      };
    });
  }
};

async function collectHtml(src) {
  const r = await get(src.url, 'text/html');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const items = PARSERS[src.parser](await r.text(), src);
  return items.filter((it) => it.date && NOW - it.date <= MAX_AGE).map((it) => toReport(src, it, it.extra || {})).filter(useful);
}

/* ───────── YouTube Data API v3 (official; needs YOUTUBE_API_KEY) ─────────
 * search.list costs 100 quota units; the free quota is 10,000/day. We run the
 * queries only every 6 hours (≈4,000 units/day) and otherwise carry over the
 * previous YouTube reports from the live site. */
let PREV = null;
async function previousIntel() {
  if (PREV !== null) return PREV;
  PREV = {};
  const url = process.env.PREV_INTEL_URL;
  if (!url) return PREV;
  try { const r = await get(url + '?t=' + Date.now(), 'application/json'); if (r.ok) PREV = await r.json(); } catch (_) { /* first run */ }
  return PREV;
}

export function youtubeReports(src, items) {
  const out = [];
  for (const v of items || []) {
    const sn = v.snippet || {};
    const id = v.id && (v.id.videoId || v.id);
    const date = Date.parse(sn.publishedAt);
    if (!id || !isFinite(date) || NOW - date > 14 * DAY) continue;
    const title = decodeEntities(sn.title || '');
    const text = decodeEntities(sn.description || '');
    if (BOAT_RE.test(title + text)) continue;
    const rep = toReport(src, { title, url: 'https://www.youtube.com/watch?v=' + id, date, text }, { author: sn.channelTitle || null });
    if (rep.catches.length && (rep.spots.length || rep.area)) out.push(rep);
  }
  return out;
}
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function collectYoutube(src) {
  const key = process.env.YOUTUBE_API_KEY;
  const due = process.env.YOUTUBE_FORCE === '1' || new Date().getUTCHours() % 6 === 0;
  if (!key || !due) {
    const prev = await previousIntel();
    const carried = (prev.reports || []).filter((r) => r.src === src.id && NOW - r.date <= 14 * DAY);
    if (!key && !carried.length) throw new Error('APIキー未設定（YOUTUBE_API_KEY）');
    return carried;
  }
  const out = [];
  const seen = new Set();
  const after = new Date(NOW - 14 * DAY).toISOString();
  for (const q of src.queries) {
    const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=15&regionCode=JP&relevanceLanguage=ja' +
      `&publishedAfter=${encodeURIComponent(after)}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
    const r = await get(url, 'application/json');
    if (r.status === 403) throw new Error('YouTube API 403（キーの制限または上限）');
    if (!r.ok) { await sleep(800); continue; }
    const j = await r.json();
    for (const rep of youtubeReports(src, (j.items || []).filter((it) => !seen.has(it.id.videoId) && seen.add(it.id.videoId)))) out.push(rep);
    await sleep(800);
  }
  return out;
}

/* ───────── Instagram Graph API — hashtag search (official) ─────────
 * recent_media only returns the last 24 h, so we accumulate: carry over the
 * previous 14 days from the live intel and add what is new. Hashtag ids are
 * cached in the output to avoid re-searching (30 unique tags / 7 days). */
export function instagramReports(src, media) {
  const out = [];
  for (const m of media || []) {
    const date = Date.parse(m.timestamp);
    if (!m.permalink || !isFinite(date) || NOW - date > 14 * DAY) continue;
    const text = String(m.caption || '');
    if (BOT_RE.test(text) || BOAT_RE.test(text)) continue;
    const rep = toReport(src, { title: text.split('\n')[0].slice(0, 60), url: m.permalink, date, text }, {});
    if (rep.catches.length && (rep.spots.length || rep.area)) out.push(rep);
  }
  return out;
}

async function collectInstagram(src) {
  const uid = process.env.IG_USER_ID, token = process.env.IG_TOKEN;
  const ver = process.env.IG_GRAPH_VERSION || 'v21.0';
  const prev = await previousIntel();
  const carried = (prev.reports || []).filter((r) => r.src === src.id && NOW - r.date <= 14 * DAY);
  if (!uid || !token) {
    if (!carried.length) throw new Error('トークン未設定（IG_USER_ID / IG_TOKEN）');
    return carried;
  }
  const ids = Object.assign({}, (prev.cache && prev.cache.igHashtags) || {});
  const base = `https://graph.facebook.com/${ver}`;
  const fresh = [];
  for (const tag of src.hashtags) {
    try {
      if (!ids[tag]) {
        const r = await get(`${base}/ig_hashtag_search?user_id=${uid}&q=${encodeURIComponent(tag)}&access_token=${encodeURIComponent(token)}`, 'application/json');
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        if (j.data && j.data[0]) ids[tag] = j.data[0].id; else continue;
      }
      const r = await get(`${base}/${ids[tag]}/recent_media?user_id=${uid}&fields=id,caption,permalink,timestamp,media_type&limit=50&access_token=${encodeURIComponent(token)}`, 'application/json');
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      fresh.push(...instagramReports(src, j.data));
    } catch (e) {
      if (/token|OAuth|expired|permission/i.test(String(e.message))) throw new Error('Instagram API: ' + e.message);
    }
    await sleep(600);
  }
  CACHE.igHashtags = ids;
  const seen = new Set();
  return [...fresh, ...carried].filter((r) => !seen.has(r.url) && seen.add(r.url));
}
const CACHE = {};

async function collectBsky(src) {
  const out = [];
  const seen = new Set();
  for (const q of src.queries) {
    const url = `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=25`;
    try {
      const r = await get(url, 'application/json');
      if (!r.ok) { await sleep(1500); continue; }
      const j = await r.json();
      for (const p of j.posts || []) {
        if (seen.has(p.uri)) continue; seen.add(p.uri);
        const text = (p.record && p.record.text) || '';
        // Skip automated digests / forecast bots: we want first-hand catches only.
        if (BOT_RE.test(text) || BOAT_RE.test(text) || (p.author && /bot|news|info/i.test(p.author.handle))) continue;
        const date = Date.parse((p.record && p.record.createdAt) || p.indexedAt);
        if (!isFinite(date) || NOW - date > 14 * DAY) continue;
        const rkey = p.uri.split('/').pop();
        const rep = toReport(src, { title: text.split('\n')[0], url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`, date, text }, { author: '@' + p.author.handle });
        // SNS noise filter: needs a real catch (size/count or catch verb) and a known place.
        if (rep.catches.length && (rep.spots.length || rep.area)) out.push(rep);
      }
    } catch (_) { /* one query failing must not stop the rest */ }
    await sleep(1200);
  }
  // High-frequency posters of catch digests are aggregators, not anglers on the spot.
  const per = {};
  out.forEach((r) => { per[r.author] = (per[r.author] || 0) + 1; });
  return out.filter((r) => per[r.author] < 5);
}

function aggregate(reports, since) {
  const recent = reports.filter((r) => r.date && r.date >= since && r.type !== 'boat');
  const bucket = () => ({ reports: 0, fish: 0, maxSize: null, last: 0, methods: {}, times: {} });
  // One report = one vote per species (same rule as js/feed.js aggregate()).
  const add = (map, r, k, cs) => {
    const b = map[k] || (map[k] = Object.assign(bucket(), { sp: cs[0].sp, name: cs[0].name }));
    b.reports++;
    b.last = Math.max(b.last, r.date || 0);
    for (const c of cs) {
      b.fish += c.mention ? 0 : c.count || 1;
      if (c.max != null) b.maxSize = Math.max(b.maxSize || 0, c.max);
    }
    new Set(cs.map((c) => c.method).filter(Boolean)).forEach((m) => { b.methods[m] = (b.methods[m] || 0) + 1; });
    r.time.buckets.forEach((t) => { b.times[t] = (b.times[t] || 0) + 1; });
  };
  const spots = {}, areas = {}, all = {};
  for (const r of recent) {
    const groups = new Map();
    for (const c of r.catches) { const k = c.sp || c.name; groups.has(k) ? groups.get(k).push(c) : groups.set(k, [c]); }
    for (const [k, cs] of groups) {
      r.spots.forEach((sid) => add(spots[sid] || (spots[sid] = {}), r, k, cs));
      if (r.area) add(areas[r.area] || (areas[r.area] = {}), r, k, cs);
      add(all, r, k, cs);
    }
  }
  const list = (m) => Object.values(m).sort((a, b) => b.fish - a.fish || b.last - a.last).slice(0, 12);
  return {
    spots: Object.fromEntries(Object.entries(spots).map(([k, v]) => [k, list(v)])),
    areas: Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, list(v)])),
    all: list(all)
  };
}

/** Latest measured conditions per spot (e.g. lake water temperature from a marina log). */
function observations(list) {
  const out = {};
  for (const r of list) {
    if (!r.obs || !r.date) continue;
    for (const sid of r.spots) if (!out[sid] || out[sid].date < r.date) out[sid] = Object.assign({ date: r.date, src: r.srcName, url: r.url }, r.obs);
  }
  return out;
}

async function previousArchive() {
  const local = path.join(path.dirname(OUT), 'archive.json');
  const url = process.env.PREV_INTEL_URL && process.env.PREV_INTEL_URL.replace(/intel\.json$/, 'archive.json');
  if (url) {
    try { const r = await get(url + '?t=' + Date.now(), 'application/json'); if (r.ok) return await r.json(); } catch (_) { /* first run */ }
  }
  try { return JSON.parse(fs.readFileSync(local, 'utf8')); } catch (_) { return { records: [] }; }
}

async function main() {
  const reports = [];
  const health = [];
  const prevArchive = await previousArchive();
  ARCHIVE_COVERAGE = coverage(prevArchive);
  for (const src of cfg.sources) {
    const t0 = Date.now();
    try {
      const r = src.mode === 'rss' ? await collectRss(src) : src.mode === 'html' ? await collectHtml(src) : src.mode === 'bsky' ? await collectBsky(src) : src.mode === 'youtube' ? await collectYoutube(src) : src.mode === 'instagram' ? await collectInstagram(src) : [];
      reports.push(...r);
      health.push({ id: src.id, name: src.name, type: src.type, ok: true, count: r.length, ms: Date.now() - t0 });
    } catch (e) {
      health.push({ id: src.id, name: src.name, type: src.type, ok: false, error: String(e.message || e), ms: Date.now() - t0 });
    }
    await sleep(1500);
  }
  // De-duplicate by URL, newest first, cap size.
  const seen = new Set();
  const list = reports.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url)).sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 400);
  const out = {
    schema: 'fishhunter.intel/1', generated_at: new Date().toISOString(),
    policy: cfg.policy, sources: health, linkOnly: cfg.linkOnly,
    count: list.length, reports: list,
    stats: { d7: aggregate(list, NOW - 7 * DAY), d30: aggregate(list, NOW - 30 * DAY) },
    observations: observations(list),
    cache: CACHE
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  // Long-term evidence: rolling archive (carried over via the live site) → hotspots.
  const archive = mergeArchive(prevArchive, [...list, ...HISTORY], NOW);
  fs.writeFileSync(path.join(path.dirname(OUT), 'archive.json'), JSON.stringify(archive));
  const hot = buildHotspots(archive, NOW, { speciesIds: ctx.FH.SPECIES.map((s) => s.id) });
  fs.writeFileSync(path.join(path.dirname(OUT), 'hotspots.json'), JSON.stringify(hot));
  console.log(`archive: ${archive.records.length} records (${HISTORY.length} back-filled) → hotspots for ${Object.keys(hot.spots).length} spots`);
  console.log(JSON.stringify({ out: OUT, reports: list.length, catches: list.reduce((n, r) => n + r.catches.length, 0), sources: health }, null, 1));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
