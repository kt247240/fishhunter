// FishHunter catch-intel extractor: free-text fishing reports → structured catches.
// Pure functions, no network. Used by tools/intel/collect.mjs and the tests.

// FishHunter species ids + aliases (longest alias wins; masks shorter overlaps).
export const SPECIES = [
  ['aori', 'アオリイカ', ['アオリイカ', 'アオリ', '新子イカ']],
  ['aji', 'アジ', ['尺アジ', '豆アジ', '小アジ', '中アジ', '小あじ', '豆あじ', 'アジ', '鯵', 'あじ']],
  ['saba', 'サバ・イワシ', ['サバ', '鯖', 'イワシ', '鰯', 'サッパ']],
  ['inada', 'イナダ・ワラサ（ブリ）', ['ワカシ', 'イナダ', 'ワラサ', 'フクラギ', 'ツバス', 'ブリ', '青物']],
  ['sagoshi', 'サゴシ・サワラ', ['サゴシ', 'サワラ']],
  ['seabass', 'シーバス', ['シーバス', 'スズキ', 'セイゴ', 'フッコ']],
  ['kurodai', 'クロダイ', ['クロダイ', 'チヌ', 'カイズ', '黒鯛']],
  ['madai', 'マダイ', ['マダイ', '真鯛', 'チャリコ']],
  ['kisu', 'シロギス', ['シロギス', 'キス', 'ピンギス']],
  ['hirame', 'ヒラメ', ['ヒラメ', 'ソゲ', 'マゴチ']],
  ['kasago', 'カサゴ・メバル（根魚）', ['カサゴ', 'ガシラ', 'メバル', 'ソイ', 'アイナメ', 'キジハタ', 'アコウ', '根魚']],
  ['sakuramasu', 'サクラマス', ['サクラマス']],
  ['yamame', 'ヤマメ・アマゴ', ['ヤマメ', 'アマゴ']],
  ['iwana', 'イワナ', ['イワナ', '岩魚']],
  ['niji', 'ニジマス（大型）', ['ニジマス', 'レインボートラウト', 'レインボー', 'ドナルドソン']],
  ['ayu', 'アユ', ['アユ', '鮎']],
  ['bass', 'スモールマウスバス', ['スモールマウスバス', 'スモールマウス', 'ブラックバス', 'スモール', 'ラージ']],
  ['wakasagi', 'ワカサギ', ['ワカサギ', 'わかさぎ']]
];
// Non-target species still worth counting ("what is biting").
export const OTHER = ['シイラ', 'メジナ', 'グレ', 'チダイ', 'イシダイ', 'シマダイ', 'カワハギ', 'ウマズラハギ', 'オキザヨリ', 'サヨリ', 'カマス',
  'タチウオ', 'カンパチ', 'ハゼ', 'カレイ', 'ホッケ', 'ヤリイカ', 'スルメイカ', 'マイカ', 'ヒイカ', 'コウイカ', 'ヘラブナ', 'ウグイ', 'ナマズ', 'ソウダガツオ', 'ペンペン'];

const METHODS = [
  ['エギング', /エギング|エギ(?!ン)/], ['ショアジギング', /ショアジギ|メタルジグ|ジグ(?!サビキ|単)/], ['ジグサビキ', /ジグサビキ/],
  ['遠投サビキ', /遠投サビキ/], ['サビキ', /サビキ/], ['遠投カゴ', /遠投カゴ|カゴ釣り|カゴ/], ['フカセ', /フカセ/], ['ダンゴ', /ダンゴ/],
  ['泳がせ', /泳がせ|のませ/], ['ヘチ・落とし込み', /ヘチ|落とし込み|前打ち/], ['投げ釣り', /投げ釣り|ちょい投げ/],
  ['アジング', /アジング|ジグ単/], ['メバリング', /メバリング/], ['ワーム', /ワーム/], ['ミノー', /ミノー/], ['トップ', /ペンシル|ポッパー|トップ/],
  ['バイブレーション', /バイブ/], ['ライトリグ', /ライトリグ|ダウンショット|ネコリグ|ノーシンカー/], ['シャッド', /シャッド/], ['フライ', /フライ(?!ト)/], ['テンカラ', /テンカラ/], ['ギャング針', /ギャング/], ['ウキ釣り', /ウキ釣り|電気ウキ/], ['友釣り', /友釣り/], ['ドーム船', /ドーム船/]
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALL = [
  ...SPECIES.flatMap(([id, , al]) => al.map((a) => ({ a, id }))),
  ...OTHER.map((a) => ({ a, id: null, other: a }))
].sort((x, y) => y.a.length - x.a.length);
// Guard common false positives: アジング (method), シーバス vs バス handled by longest-first; スモール alone must be followed by fish context.
const SPECIES_RE = new RegExp(ALL.map((x) => esc(x.a) + (x.a === 'アジ' ? '(?!ング)' : '') + (x.a === 'スモール' || x.a === 'ラージ' ? '(?=\\s*\\d|マウス|サイズ)' : '')).join('|'), 'g');
const byAlias = Object.fromEntries(ALL.map((x) => [x.a, x]));

export function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[～〜]/g, '~')
    .replace(/ｍ/g, 'm')
    .replace(/[ \t 　]+/g, ' ')
    .replace(/\r/g, '');
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

const CATCH_VERB = /釣れ|釣果|ヒット|キャッチ|ゲット|GET|上が(り|っ)|釣り上げ|確保|入れ食い|爆釣|連発/;

/** Split normalized text into catch-sized segments. */
function segments(t) {
  return t
    .split(/\n+|。|!|！|★|【|】|※/)
    .flatMap((s) => s.split(/\s(?=\d{2,3}m\s|先\s?端\s)/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

/** Extract structured catches from one report's text. */
export function extractCatches(text) {
  const t = normalize(text);
  const out = [];
  for (const seg of segments(t)) {
    const hits = [...seg.matchAll(SPECIES_RE)].map((m) => ({ alias: m[0], index: m.index }));
    if (!hits.length) continue;
    const segMethod = METHODS.find(([, re]) => re.test(seg));
    const verb = CATCH_VERB.test(seg);
    hits.forEach((h, i) => {
      const tail = seg.slice(h.index + h.alias.length, i + 1 < hits.length ? hits[i + 1].index : seg.length);
      const size = tail.match(/(?:(\d{1,3}(?:\.\d)?)\s*~\s*)?(\d{1,3}(?:\.\d)?)\s*cm/i);
      const cnt = tail.match(/(\d{1,3})\s*(匹|本|杯|尾|枚)/);
      if (!size && !cnt && !verb) return; // a mere mention ("〜が待っています")
      const info = byAlias[h.alias];
      let min = null, max = null;
      if (size) {
        const hi = parseFloat(size[2]);
        const upTo = !size[1] && /~\s*$/.test(tail.slice(0, size.index));
        max = hi;
        min = size[1] ? Math.min(parseFloat(size[1]), hi) : upTo ? null : hi;
        if (max > 250) { min = max = null; }
      }
      const methodInTail = METHODS.find(([, re]) => re.test(tail));
      out.push({
        sp: info.id, name: info.id ? SPECIES.find((s) => s[0] === info.id)[1] : info.other, alias: h.alias,
        count: cnt ? parseInt(cnt[1], 10) : null, min, max,
        method: (methodInTail || segMethod || [null])[0],
        mention: !size && !cnt
      });
    });
  }
  // Merge exact duplicates within a report (same species, size, method).
  const seen = new Set();
  return out.filter((c) => { const k = [c.sp || c.name, c.count, c.min, c.max, c.method].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Time-of-day hints: from title ("午前の釣果") and text ("6時頃", "夕まずめ"). */
export function extractTime(title, text) {
  const tt = normalize(title);
  const t = normalize(title + ' ' + text);
  const buckets = new Set();
  if (/午前/.test(tt)) return { buckets: ['朝'], hours: hoursOf(t) };
  if (/午後/.test(tt)) return { buckets: ['昼', '夕'], hours: hoursOf(t) };
  if (/午前|朝まずめ|朝マズメ|朝マヅメ|早朝|明け方/.test(t)) buckets.add('朝');
  if (/午後|日中|昼/.test(t)) buckets.add('昼');
  if (/夕まずめ|夕マズメ|夕マヅメ|夕方|日没/.test(t)) buckets.add('夕');
  if (/夜|ナイト|深夜|常夜灯/.test(t)) buckets.add('夜');
  return { buckets: [...buckets], hours: hoursOf(t) };
}
function hoursOf(t) {
  const hours = [...t.matchAll(/(午後|夕方|夜)?\s*([01]?\d|2[0-3])時(?:頃|過ぎ|半|から|~)?/g)]
    .map((m) => (m[1] && +m[2] < 12 ? +m[2] + 12 : +m[2])).filter((h) => h >= 3 && h <= 23);
  return [...new Set(hours)].slice(0, 6);
}

/** Colour insights: sentences that talk about which colour worked. */
export function extractColorNotes(text) {
  const t = normalize(text).replace(/\n+/g, '');
  return t.split(/。|!|！/).map((s) => s.trim())
    .filter((s) => /(カラー|色|系)/.test(s) && /(反応|釣れ|ヒット|良|当たり|効)/.test(s) && s.length <= 120)
    .slice(0, 3);
}

/** Which FishHunter spots does this text mention? spots: [{id, name, feedAliases}] */
export function matchSpots(text, spots) {
  const t = normalize(text);
  return spots.filter((s) => [s.name, ...(s.feedAliases || [])].some((a) => a && t.includes(normalize(a)))).map((s) => s.id);
}

export function snippet(text, n = 140) {
  const t = normalize(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Notices from managers / co-ops: openings, closures, stocking, access. */
export function extractNotices(title, text) {
  const t = normalize(title + '。' + text).replace(/\n+/g, '。');
  const KEY = /解禁|禁漁|放流|遊漁券|立入禁止|立ち入り禁止|通行止|閉鎖|休業|休館|営業(開始|終了|時間)|中止|延期|結氷|氷上|ドーム船|釣り場(開放|閉鎖)|工事/;
  const out = [];
  for (const s of t.split(/。|!|！/)) {
    const x = s.trim();
    if (x.length >= 6 && x.length <= 90 && KEY.test(x) && !out.includes(x)) out.push(x);
    if (out.length >= 3) break;
  }
  return out;
}
