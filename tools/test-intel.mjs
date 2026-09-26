// Catch-intel extractor tests (synthetic samples in the formats seen in public feeds).
import assert from 'node:assert/strict';
import { extractCatches, extractTime, extractColorNotes, matchSpots, positionOf, extractVisitors } from './intel/extract.mjs';

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
console.log(`\nFishHunter intel tests: ${passed} passed`);
