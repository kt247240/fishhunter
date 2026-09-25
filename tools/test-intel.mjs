// Catch-intel extractor tests (synthetic samples in the formats seen in public feeds).
import assert from 'node:assert/strict';
import { extractCatches, extractTime, extractColorNotes, matchSpots } from './intel/extract.mjs';

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
  const cs = extractCatches('２８５ｍ外側 シイラ １００ｃｍ ダイニングペンシル');
  assert.equal(cs[0].sp, null); assert.equal(cs[0].name, 'シイラ'); assert.equal(cs[0].max, 100); assert.equal(cs[0].method, 'トップ');
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
console.log(`\nFishHunter intel tests: ${passed} passed`);
