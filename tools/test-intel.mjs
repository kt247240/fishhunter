// Catch-intel extractor tests (synthetic samples in the formats seen in public feeds).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { dailyMax, drift, skillFor } from './intel/skill.mjs';
import { parseLandings, landingsBySpecies, parseKaikyo } from './intel/official.mjs';
import { zoneKeys, zoneLabel, mergeArchive, buildHotspots, coverage } from './intel/archive.mjs';
import { extractColors, extractCatches, extractTime, extractColorNotes, matchSpots, positionOf, extractVisitors } from './intel/extract.mjs';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name); throw e; } };
const find = (cs, name) => cs.filter((c) => c.name === name || c.alias === name);

console.log('intel extractor');
test('line format: 魚名 サイズ 数 場所 釣法', () => {
  const cs = extractCatches('アオリイカ　１３～１４cm　９杯　先端～６５番　エギング\nサバ　２６～３０cm　５匹　３５番　遠投サビキ');
  const a = find(cs, 'アオリイカ')[0];
  assert.equal(a.sp, 'aori'); assert.equal(a.count, 9); assert.equal(a.min, 13); assert.equal(a.max, 14); assert.equal(a.method, 'エギング');
  const s = find(cs, 'サバ・イワシ')[0];
  assert.equal(s.count, 5); assert.equal(s.max, 30); assert.equal(s.method, '遠投サビキ');
});
test('inline position format and "〜40cm" as an upper bound', () => {
  const cs = extractCatches('４４５ｍ外側 クロダイ２匹～４０ｃｍ フカセ釣り ６３０ｍ外側 ヒラメ４4ｃｍ 泳がせ釣り（豆アジ）');
  const k = find(cs, 'クロダイ')[0];
  assert.equal(k.count, 2); assert.equal(k.max, 40); assert.equal(k.min, null); assert.equal(k.method, 'フカセ');
  const h = find(cs, 'ヒラメ')[0];
  assert.equal(h.max, 44); assert.equal(h.method, '泳がせ');
});
test('mere mentions without size/count/verb are ignored', () => {
  assert.equal(extractCatches('釣り場では、ワカシ、サバ、アオリイカ など、さまざまな魚たちが待っています').length, 0);
});
test('アジング is a method, not a fish; シーバス is not バス', () => {
  const cs = extractCatches('アジングで良型がヒット。シーバス６０cm');
  assert.equal(cs.filter((c) => c.sp === 'aji').length, 0);
  assert.equal(find(cs, 'シーバス')[0].max, 60);
  assert.equal(cs.filter((c) => c.sp === 'bass').length, 0);
});
test('non-target species are kept by name', () => {
  const cs = extractCatches('５４０ｍ内側 チダイ５匹～２４ｃｍ 遠投カゴ釣り');
  assert.equal(cs[0].sp, null); assert.equal(cs[0].name, 'チダイ'); assert.equal(cs[0].max, 24); assert.equal(cs[0].count, 5);
  const sh = extractCatches('２８５ｍ外側 シイラ １００ｃｍ ダイニングペンシル')[0];
  assert.equal(sh.sp, 'shiira'); assert.equal(sh.max, 100); assert.equal(sh.method, 'トップ');
});
test('time: title wins, 午後4時 → 16', () => {
  const t = extractTime('午後の釣果', '午後４時頃から先端内側でアジが入れ食い');
  assert.equal(t.buckets.join(), '昼,夕'); assert.ok(t.hours.includes(16));
  assert.equal(extractTime('釣行記', '夕まずめに連発').buckets.join(), '夕');
});
test('colour notes across line breaks', () => {
  const n = extractColorNotes('今日はピンク系よりも、ブルー系や暗めのカラーの\n\nエギへの反応が良かったようです。');
  assert.equal(n.length, 1); assert.match(n[0], /ブルー系/);
});
test('spot matching via aliases', () => {
  const spots = [{ id: 'naoetsu', name: '直江津港', feedAliases: ['直江津'] }, { id: 'nojiri', name: '野尻湖' }];
  assert.equal(matchSpots('直江津でアジ', spots).join(), 'naoetsu');
  assert.equal(matchSpots('野尻湖でスモール', spots).join(), 'nojiri');
});
test('pier positions: metres + side, numbered posts, tip', () => {
  const a = extractCatches('４９０ｍ 外側 アジ２７ｃｍ 遠投カゴ釣り')[0];
  assert.equal(a.pos.m, 490); assert.equal(a.pos.side, '外側');
  const b = extractCatches('サバ　２６～３０cm　５匹　３，３５番　遠投サビキ')[0];
  assert.equal(b.pos.no.join(), '3,35');
  const c = extractCatches('イナダ　５３cm　１匹　先端　泳がせ')[0];
  assert.equal(c.pos.tip, true);
  assert.equal(positionOf('足元で'), null);
});
test('visitor count', () => {
  assert.equal(extractVisitors('本日の入場者数：６６名'), 66);
  assert.equal(extractVisitors('入場者数：１１０'), 110);
});
const { youtubeReports, instagramReports } = await import('./intel/collect.mjs');
test('YouTube search items → first-hand shore catch reports only', () => {
  const now = new Date().toISOString();
  const src = { id: 'youtube', name: 'YouTube', type: 'video' };
  const items = [
    { id: { videoId: 'a1' }, snippet: { publishedAt: now, title: '直江津港でアジ入れ食い！サビキで30匹', description: '夕まずめに25cmの良型も', channelTitle: 'ANONチャンネル' } },
    { id: { videoId: 'b2' }, snippet: { publishedAt: now, title: '直江津沖の船釣りでマダイ', description: '遊漁船で出船', channelTitle: 'X' } },
    { id: { videoId: 'c3' }, snippet: { publishedAt: now, title: '新作ルアー紹介', description: '釣りに行きたい', channelTitle: 'Y' } },
    { id: { videoId: 'd4' }, snippet: { publishedAt: '2020-01-01T00:00:00Z', title: '直江津でアジ30匹', description: '', channelTitle: 'Z' } }
  ];
  const r = youtubeReports(src, items);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'https://www.youtube.com/watch?v=a1');
  assert.ok(r[0].spots.includes('naoetsu'));
  assert.equal(r[0].catches.find((c) => c.sp === 'aji').count, 30);
  assert.equal(r[0].author, 'ANONチャンネル');
});
test('Instagram hashtag media → catches with permalink, old/boat posts dropped', () => {
  const now = new Date().toISOString();
  const src = { id: 'instagram', name: 'Instagram', type: 'sns' };
  const r = instagramReports(src, [
    { permalink: 'https://www.instagram.com/p/AAA/', timestamp: now, caption: '今朝の直江津港🎣\nアオリイカ 3杯 胴長15cm #直江津釣り' },
    { permalink: 'https://www.instagram.com/p/BBB/', timestamp: now, caption: '遊漁船で直江津沖へ マダイ 50cm' },
    { permalink: 'https://www.instagram.com/p/CCC/', timestamp: '2020-01-01T00:00:00+0000', caption: '直江津でアジ20匹' }
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'https://www.instagram.com/p/AAA/');
  assert.equal(r[0].catches[0].sp, 'aori'); assert.equal(r[0].catches[0].count, 3);
});
test('a size after an unlisted fish or the next position is not given to the previous fish', () => {
  const cs = extractCatches('15時過ぎから アジが550m~先端内側で釣れだしてきた 260m内側 ハモ62cm 遠投カゴ釣り 355m内側 サバ3匹 ~34cm');
  const aji = cs.find((c) => c.sp === 'aji');
  assert.ok(!aji || aji.max == null, JSON.stringify(aji));
  assert.equal(cs.find((c) => c.alias === 'ハモ').max, 62);
  assert.equal(extractCatches('アジ サイズ30cm 5匹')[0].max, 30);
});
test('colours: winners vs losers around よりも, species via エギ, no 色んな/色々', () => {
  assert.equal(JSON.stringify(extractColors('今日はピンク系やオレンジ系よりも、ブルー系や暗めのカラーのエギへの反応が良かったようです')),
    JSON.stringify([['aori', 'ピンク', -1], ['aori', 'オレンジ', -1], ['aori', '青', 1], ['aori', 'ダーク系', 1]]));
  assert.equal(extractColors('今日はピンク系やオレンジ系よりも、ブルー系や暗めのカラーの\n\nエギへの反応が良かったようです').length, 4);
  assert.equal(extractColors('朝からカワハギやシマダイなど色々な魚が釣れて賑わい').length, 0);
  assert.equal(extractColors('青物が釣れています。黒鯛もヒット').length, 0);
  assert.equal(extractColorNotes('色んな魚が釣れて楽しい一日。赤金のエギに反応が良かった').length, 1);
});
test('hopes, targets, sightings and blanks are not catches', () => {
  const names = (t) => extractCatches(t).map((c) => c.alias).join(',');
  assert.equal(names('回遊魚が釣れているので、青物が釣れるかもしれませんので期待大ですね'), '');
  assert.equal(names('県内外からアオリイカやサバを狙って来場された皆さんが釣果を上げていました'), '');
  assert.equal(names('サワラやイナダのナブラが見られます'), '');
  assert.equal(names('大濁りでアオリイカは非常に厳しく釣果無し'), '');
  assert.equal(names('アジは釣れませんでした'), '');
  assert.equal(names('ここ最近、アオリイカの釣果がイマイチ'), '');
  assert.equal(names('帰りにアオリイカの様子も見てきました'), '');
  assert.equal(names('ヤマメ発眼卵放流のお知らせです。釣れたらキャッチ'), '');
  assert.equal(names('アジやサバもまだ数は少ないものの釣れ始めました'), 'アジ,サバ');
  assert.equal(names('本日の釣果はアジ、サバ'), 'アジ,サバ');
  assert.equal(names('昨日はアオリイカが絶好調で、多くの釣果が見られました'), 'アオリイカ');
});
test('a bare mention is dropped when the same report lists that fish with a size/count', () => {
  const cs = extractCatches('アオリイカは昨日に続き好調で釣れています。\nアオリイカ 12~17cm 44杯 47番 エギング');
  assert.equal(cs.length, 1); assert.equal(cs[0].count, 44);
});

test('archive: zones, merge, and evidence counted in days', () => {
  assert.deepEqual([...zoneKeys({ m: 460, side: '外側' })], ['m4:o']);
  assert.equal(zoneKeys({ no: [3, 8, 46] }).join(), 'n0,n4');
  assert.equal(zoneLabel('m4:o'), '400〜499m 外側'); assert.equal(zoneLabel('tip:i'), '先端 内側'); assert.equal(zoneLabel('n4'), '41〜50番');
  const now = Date.parse('2026-09-26T12:00:00+09:00');
  const rep = (id, daysAgo, catches) => ({ id, date: now - daysAgo * 86400e3, src: 'hf', type: 'official', area: '上越', spots: ['naoetsu'], time: { buckets: ['朝'] }, catches });
  const aji = (count, pos) => ({ sp: 'aji', name: 'アジ', count, max: 25, method: 'サビキ', mention: false, pos });
  const prev = mergeArchive(null, [rep('a', 40, [aji(30, { m: 610, side: '内側' })]), rep('old', 500, [aji(1)])], now);
  assert.equal(prev.records.length, 1, 'records past KEEP_DAYS are dropped');
  const arc = mergeArchive(prev, [rep('b', 2, [aji(3, { m: 650, side: '内側' }), aji(2, { tip: true, side: '外側' })]), rep('c', 2, [aji(1, { m: 620, side: '内側' })]),
    rep('d', 1, [{ sp: 'aji', name: 'アジ', mention: true }])], now);
  assert.equal(arc.records.length, 3, 'mention-only report is not archived');
  assert.ok(coverage(arc).hf <= now - 40 * 86400e3);
  const h = buildHotspots(arc, now, { speciesIds: ['aji'] });
  const P = h.spots.naoetsu.sp.aji;
  assert.equal(P.days, 2, 'two report days, not three reports or 36 fish');
  assert.equal(P.d14, 1);
  assert.equal(P.zones[0].z, 'm6:i'); assert.equal(P.zones[0].days, 2);
  assert.equal(h.rank.aji[0].spot, 'naoetsu');
  const withCol = mergeArchive(arc, [Object.assign(rep('e', 1, []), { colorHits: [['aori', '青', 1], ['aori', 'ピンク', -1]] })], now);
  const hc = buildHotspots(withCol, now);
  assert.equal(JSON.stringify(hc.spots.naoetsu.colors.aori), JSON.stringify([['青', 1, 0], ['ピンク', 0, 1]]));
});

test('insight: analogs prefer same season + similar sea; season flow; crowd', () => {
  const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/insight.js', import.meta.url), 'utf8'), ctx);
  const I = ctx.FH.insight;
  const day = (d, wv, f, v = null, dow = 3) => ({ s: 'x', d, dow, v, c: { wv, wd: 3, sst: 25, prev: wv, on: 0 }, f });
  const book = { days: [
    day('2026-09-20', 1.2, { aji: [30, 25, 'm6:i'] }, 120, 6), day('2026-09-19', 0.3, { saba: [5, 30, null] }, 60, 5),
    day('2026-07-01', 1.2, { saba: [9, 30, null] }, 50, 3), day('2026-09-22', 1.1, { aji: [10, 24, 'm6:i'] }, 70, 1)
  ] };
  const near = I.analogs(book, 'x', { wv: 1.2, wd: 3, sst: 25, prev: 1.2, on: 0 }, '2026-09-24', 2);
  assert.equal(near.map((n) => n.e.d).join(), '2026-09-22,2026-09-20');
  const lf = I.lift(book, 'x', near, 1);
  assert.equal(lf[0].sp, 'aji'); assert.equal(lf[0].hit, 2); assert.equal(lf[0].zone, 'm6:i');
  const ss = I.season(book, 'x', 'aji', 4, Date.parse('2026-09-24T12:00:00+09:00'));
  assert.equal(ss[3].hit, 1); assert.equal(ss[2].hit, 1); assert.equal(ss[2].days, 2);
  assert.equal(I.crowd(book, 'x', 6, Date.parse('2026-09-24T12:00:00+09:00')).sat, 120);
  assert.equal(I.zoneLabel('m6:i'), '600〜699m 内側');
  // migration: B leads A by 3 days on a synthetic run; arrivals after a ≥14-day blank
  const mk = [];
  for (let i = 0; i < 80; i++) {
    const d = new Date(Date.UTC(2026, 6, 1) + i * 864e5).toISOString().slice(0, 10);
    const run = (k) => (Math.sin((i - k) / 6) > 0.3 ? { aori: [5, 12, null] } : {});
    mk.push({ s: 'A', d, dow: 1, c: {}, f: i >= 20 ? run(3) : {} }, { s: 'B', d, dow: 1, c: {}, f: i >= 20 ? run(0) : {} });
  }
  const mg = I.migration({ days: mk }, 'aori', ['A', 'B'], Date.UTC(2026, 8, 18));
  assert.equal(mg.lead.from, 'B'); assert.equal(mg.lead.days, 3);
  assert.ok(mg.spots[0].arrivals.length >= 1);
  // storm curve: catches doubled on days 0–2 after a blow
  const sb = [];
  for (let i = 0; i < 60; i++) {
    const ss = i % 10; const d = new Date(Date.UTC(2026, 6, 1) + i * 864e5).toISOString().slice(0, 10);
    sb.push({ s: 'P', d, dow: 1, c: { ss }, f: { aji: [ss <= 2 ? 40 : 10, null, null] } });
  }
  const sc = I.stormCurve({ days: sb }, 'P', 'aji');
  assert.ok(sc.find((b) => b.key === '0-1').mult > 1.5, JSON.stringify(sc));
  assert.ok(sc.find((b) => b.key === '4-6').mult < 1);
  // days since storm from a marine series
  const t0 = Date.parse('2026-09-10T00:00:00+09:00');
  const marine = { P: { time: Array.from({ length: 24 * 8 }, (_, h) => t0 + h * 3600e3), wave: Array.from({ length: 24 * 8 }, (_, h) => (h >= 24 && h < 36 ? 2.0 : 0.5)) } };
  assert.equal(I.daysSinceStorm({ id: 'P' }, '2026-09-14', { marine }), 3);
});

test('forecast drift: daytime max per day, bias and MAE by lead', () => {
  const t0 = Date.parse('2026-09-01T00:00:00+09:00');
  const n = 24 * 12;
  const time = Array.from({ length: n }, (_, h) => t0 + h * 3600e3);
  const wind = time.map((_, h) => 5 + (h % 24 === 12 ? 3 : 0));        // daytime max 8
  const prev3 = time.map((_, h) => 4 + (h % 24 === 12 ? 2.5 : 0));     // daytime max 6.5 → −1.5
  const hourly = { time, wind_speed_10m: wind, wind_speed_10m_previous_day3: prev3 };
  assert.equal(dailyMax(hourly, 'wind_speed_10m')['2026-09-02'], 8);
  const k = skillFor(hourly, 'wind_speed_10m');
  assert.equal(k[3].bias, -1.5); assert.equal(k[3].mae, 1.5); assert.equal(k[3].n, 12);
  assert.equal(k[1], undefined);
  assert.equal(drift({ a: 1 }, { a: 2 }), null, 'too few days');
});

test('official: set-net landings CSV and 海況情報 text', () => {
  const csv = ['定置網（単位：トン）,,,', ',マアジ,サバ類,イナダ,大ブリ,その他,計', '両津湾,1.4,0.4,0.1,0.0,2.3,4.2', '新潟,11.8,3.4,0.1,0.0,0.3,15.6', '糸魚川,4.4,0.1,0.4,0.0,1.0,5.9',
    '計,17.6,3.9,0.6,0.0,3.6,25.7', '前年,26.7,19.3,3.6,0.0,8.4,58', '5年平均,32.1,12.1,8.9,0.0,15.7,68.8', ',,,', 'まき網（単位：トン）,,,'].join('\n');
  const tab = parseLandings(csv);
  assert.equal(tab.total['マアジ'], 17.6); assert.equal(tab.avg5['イナダ'], 8.9);
  const by = landingsBySpecies(tab);
  assert.equal(by.aji.t, 17.6); assert.equal(by.aji.areas['下越'], 11.8); assert.equal(by.aji.areas['佐渡'], 1.4); assert.equal(by.inada.t, 0.6);
  const k = parseKaikyo('◎ ９月の沿岸水温（観測月日：8 月 24 日～27 日） ［水温］ 表層(0ｍ)、50ｍ層、100ｍ層の平均水温は それぞれ 28.6℃、21.3℃、15.4℃でした。 ［平年差］ 表層(0ｍ)は“かなり高め”、50ｍ層と 100ｍ層は“やや高め”でした。 ◎ 海の天気予報');
  assert.equal(k.t0, 28.6); assert.equal(k.t50, 21.3); assert.equal(k.t100, 15.4);
  assert.equal(k.anomaly.t0, 'かなり高め'); assert.equal(k.anomaly.t50, 'やや高め');
  assert.deepEqual([...k.obs.from, ...k.obs.to], [8, 24, 8, 27]);
});

console.log(`\nFishHunter intel tests: ${passed} passed`);
