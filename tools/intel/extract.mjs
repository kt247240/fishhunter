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
  ['wakasagi', 'ワカサギ', ['ワカサギ', 'わかさぎ']],
  ['mejina', 'メジナ', ['メジナ', 'グレ', '口太']],
  ['kawahagi', 'カワハギ', ['カワハギ', 'ウマズラハギ', 'ウマヅラ']],
  ['shiira', 'シイラ', ['シイラ', 'ペンペン', 'マヒマヒ']]
];
// Non-target species still worth counting ("what is biting").
export const OTHER = ['チダイ', 'イシダイ', 'シマダイ', 'オキザヨリ', 'サヨリ', 'カマス',
  'タチウオ', 'カンパチ', 'ハゼ', 'カレイ', 'ホッケ', 'ヤリイカ', 'スルメイカ', 'マイカ', 'ヒイカ', 'コウイカ', 'ヘラブナ', 'ウグイ', 'ナマズ', 'ソウダガツオ', 'ハモ', 'ヒイラギ', 'フグ', 'ボラ', 'エイ', 'ダツ', 'ベラ', 'キュウセン', 'メッキ', 'カンパチ'];
// A size right after some other katakana word ("ハモ62cm") belongs to that unlisted fish, not the one before.
const FOREIGN_SIZE = /(?<![ァ-ヶー])(?!サイズ|マックス|キロ|センチ|ポツポツ|ボチボチ)[ァ-ヶー]{2,}(?=\s*\d{1,3}(?:\.\d)?\s*cm)/i;

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
// "先端" starts a new catch only when a fish name follows it (直江津 style); otherwise it is a trailing position (東港 style).
const TIP_SPLIT = new RegExp('\\s(?=先\\s?端\\s*(?:内側|外側)?\\s*(?:' + ALL.map((x) => esc(x.a)).join('|') + '))');

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
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

const CATCH_VERB = /釣れ|釣果|ヒット|キャッチ|ゲット|GET|上が(り|っ)|釣り上げ|確保|入れ食い|爆釣|連発/;
// Words that turn a bare mention into a non-catch: targeting, sightings, hopes/forecasts, blanks.
const NOT_CAUGHT = /狙(い|っ|う|え)|ナブラ|見(た|られ|え|かけ)|姿を|期待|かも|でしょう|そろそろ|例年|予想|予報|釣果(無|な)し|釣れ(ず|な|ませ)|ボウズ|不発|厳し|イマイチ|いまいち|渋|反応(無|な)|待って|様子|放流|お知らせ/;
const HEDGE = /^.{0,8}?(かも|でしょう|はず|予定|そう(です|な)|たら|れば|ません|ない|ず)|^.{0,3}(イマイチ|いまいち|渋|無し|なし|ゼロ|厳し|不調|低調)/;
/**
 * Is a bare mention (no size/count) actually reported as caught? Looks at the first predicate after
 * the fish name: "アジが釣れ始めました" → yes; "青物が釣れるかもしれません", "アオリイカやサバを狙って",
 * "ナブラが見られ", "釣果無し" → no.
 */
function caughtAfter(rest, before) {
  const pos = rest.match(CATCH_VERB), neg = rest.match(NOT_CAUGHT);
  if (!pos) return CATCH_VERB.test(before) && !neg; // "本日の釣果：アジ、サバ

  if (neg && neg.index < pos.index) return false;
  return !HEDGE.test(rest.slice(pos.index + pos[0].length));
}

/** Split normalized text into catch-sized segments. */
function segments(t) {
  return t
    .split(/\n+|。|!|！|★|【|】|※/)
    .flatMap((s) => s.split(/\s(?=\d{2,3}m(?:\s|内側|外側))/))
    .flatMap((s) => s.split(TIP_SPLIT))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

/** Extract structured catches from one report's text. */
export function extractCatches(text) {
  const t = normalize(text);
  const out = [];
  let last = null;
  for (const seg of segments(t)) {
    const hits = [...seg.matchAll(SPECIES_RE)].map((m) => ({ alias: m[0], index: m.index }));
    if (!hits.length) {
      // "アジ入れ食い！サビキで30匹": a count/size sentence right after a bare mention belongs to that fish.
      if (last && last.mention) {
        const cnt = seg.match(/(\d{1,3})\s*(匹|本|杯|尾|枚)/);
        const size = seg.match(/(\d{1,3}(?:\.\d)?)\s*cm/i);
        if (cnt || size) {
          if (cnt) last.count = parseInt(cnt[1], 10);
          if (size) { last.max = parseFloat(size[1]); last.min = last.min == null ? last.max : last.min; }
          const m = METHODS.find(([, re]) => re.test(seg));
          if (m && !last.method) last.method = m[0];
          last.mention = false;
        }
      }
      last = null;
      continue;
    }
    const segMethod = METHODS.find(([, re]) => re.test(seg));
    const segPos = positionOf(seg.slice(0, hits[0].index)) || null;
    const verb = CATCH_VERB.test(seg);
    hits.forEach((h, i) => {
      let tail = seg.slice(h.index + h.alias.length, i + 1 < hits.length ? hits[i + 1].index : seg.length);
      const foreign = tail.match(FOREIGN_SIZE);
      if (foreign) tail = tail.slice(0, foreign.index);
      const size = tail.match(/(?:(\d{1,3}(?:\.\d)?)\s*~\s*)?(\d{1,3}(?:\.\d)?)\s*cm/i);
      const cnt = tail.match(/(\d{1,3})\s*(匹|本|杯|尾|枚)/);
      if (!size && !cnt && (!verb || !caughtAfter(seg.slice(h.index + h.alias.length), seg.slice(0, h.index)))) return; // a mere mention ("〜が待っています", "〜狙い", "〜かも")
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
      const pos = positionOf(tail) || segPos;
      out.push(last = {
        sp: info.id, name: info.id ? SPECIES.find((s) => s[0] === info.id)[1] : info.other, alias: h.alias,
        count: cnt ? parseInt(cnt[1], 10) : null, min, max,
        method: (methodInTail || segMethod || [null])[0],
        mention: !size && !cnt,
        ...(pos ? { pos } : {})
      });
    });
  }
  // Merge exact duplicates within a report (same species, size, method), and drop bare mentions of a
  // species that the same report also lists with a size/count (the intro line repeats the detail lines).
  const seen = new Set();
  const concrete = new Set(out.filter((c) => !c.mention).map((c) => c.sp || c.name));
  return out.filter((c) => {
    if (c.mention && concrete.has(c.sp || c.name)) return false;
    const k = [c.sp || c.name, c.count, c.min, c.max, c.method].join('|'); if (seen.has(k)) return false; seen.add(k); return true;
  });
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
    .map((s) => [s, s.replace(/色[んいな々]|色々|景色|特色|黄色線|青物|黒鯛|青空|白波/g, '')])
    .filter(([s, c]) => COLOR_CTX.test(c) && POS.test(c) && s.length <= 120 && COLOR_RE.test(c)).map(([s]) => s)
    .slice(0, 3);
}

// Lure / egi colours, normalised to a small set of families.
const COLORS = [
  ['ピンク', /ピンク/], ['オレンジ', /オレンジ/], ['赤', /(?<!赤)赤(?!金)|レッド/], ['金', /赤金|金テープ|ゴールド|(?<![赤])金(?!曜)/], ['銀', /銀|シルバー|ホロ/],
  ['緑', /緑|グリーン|オリーブ/], ['青', /(?<!青)青(?!物|空|イソメ)|ブルー/], ['紫', /紫|パープル/], ['ケイムラ', /ケイムラ|UV/], ['夜光', /グロー|夜光|蓄光/],
  ['チャート', /チャート/], ['白', /白|ホワイト/], ['黒', /黒(?!鯛)|ブラック/], ['茶', /茶|ブラウン|マーブル/], ['ダーク系', /暗め|ダーク|地味/], ['明るい系', /明るめ|派手|アピール系/], ['ナチュラル', /ナチュラル|イワシカラー|アジカラー/]
];
const COLOR_RE = new RegExp(COLORS.map(([, re]) => re.source).join('|'));
const COLOR_CTX = /カラー|色|系|エギ|ジグ|ルアー|ワーム|ミノー|テープ/;
const POS = /反応が?(良|よ)|釣れ|ヒット|当たり|効い|好調|実績|強い/;

/**
 * Structured colour evidence: [[speciesId|null, colour, +1|-1]].
 * "ピンク系やオレンジ系よりも、ブルー系や暗めのカラーのエギへの反応が良かった" → ピンク −1, オレンジ −1, 青 +1, ダーク系 +1 (aori, via エギ).
 */
export function extractColors(text) {
  const out = [];
  const t = normalize(text).replace(/\n+/g, ''); // blog HTML breaks lines mid-sentence
  for (const raw of t.split(/。|!|！|？|\?/)) {
    const sen = raw.replace(/色[んいな々]|色々|景色|特色|黄色線|青物|黒鯛|青空|白波/g, '');
    if (sen.length > 140 || !COLOR_CTX.test(sen) || !POS.test(sen) || !COLOR_RE.test(sen)) continue;
    const hit = [...raw.matchAll(SPECIES_RE)].map((m) => byAlias[m[0]].id).find(Boolean);
    const sp = hit || (/エギ/.test(sen) ? 'aori' : null);
    const cut = sen.search(/よりも|より(?!良|多)/);
    const parts = cut >= 0 ? [[sen.slice(0, cut), -1], [sen.slice(cut), 1]] : [[sen, 1]];
    for (const [part, sign] of parts) for (const [name, re] of COLORS) if (re.test(part) && !out.some((x) => x[1] === name)) out.push([sp, name, sign]);
  }
  return out.slice(0, 8);
}

/**
 * Single-species logs that never name the fish ("釣果:41匹", "匹数 ?~10 最大(cm) 43", "釣 果:13 杯"):
 * the source declares the species. → { count, max, waterTemp } (fields null when absent).
 */
export function extractTally(text) {
  const t = normalize(text).replace(/\s+/g, ' ');
  const num = (m, k = 1) => (m ? +m[k] : null);
  let count = null;
  // A leading "?~" / "3匹~" range start is skipped only when a ~ follows it (else "41匹" would read as 1).
  const a = t.match(/釣\s?果\s*[:：]?\s*(?:(?:[?？]|\d{1,4})\s*(?:匹|杯|本)?\s*[~〜]\s*)?(\d{1,4})\s*(匹|杯|本|尾)/);
  const b = t.match(/匹数\s*[:：]?\s*(?:(?:[?？]|\d{1,4})\s*[~〜]\s*)?(\d{1,4})/);
  const c = t.match(/(?:[?？]|\d{1,4})\s*匹\s*[~〜]\s*(\d{1,4})\s*匹/);
  const z = t.match(/釣\s?果\s*[:：]?\s*(?:なし|0\s*(?:匹|杯|本))/);
  count = z ? 0 : num(a) ?? num(b) ?? num(c);
  const max = num(t.match(/最大\s*(?:\(?cm\)?)?\s*[:：]?\s*(\d{2,3})\s*(?:cm)?/));
  const wt = t.match(/水温\s*[:：]?\s*(\d{1,2}(?:\.\d)?)\s*(?:[~〜]\s*(\d{1,2}(?:\.\d)?))?\s*(?:℃|°C|度)?/);
  const waterTemp = wt ? (wt[2] ? (+wt[1] + +wt[2]) / 2 : +wt[1]) : null;
  return { count, max: max && max < 200 ? max : null, waterTemp: waterTemp != null && waterTemp > 0 && waterTemp < 35 ? waterTemp : null };
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
    // Skip catch lines that merely mention a closure time ("閉鎖時にはメジナ50匹").
    if (/\d+\s*(匹|本|杯|cm)/i.test(x)) continue;
    if (x.length >= 6 && x.length <= 90 && KEY.test(x) && !out.includes(x)) out.push(x);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Position on a managed pier: "490m 外側" (distance from the entrance + side),
 * "35番" / "3,35番" (numbered posts), or "先端" (tip).
 */
export function positionOf(text) {
  const t = normalize(text);
  const m = t.match(/(\d{2,3})\s*m\s*(内側|外側)?/);
  if (m && +m[1] <= 1500) return { m: +m[1], side: m[2] || null };
  const n = t.match(/(\d{1,3}(?:\s*[,、・]\s*\d{1,3})*)\s*番/);
  if (n) return { no: n[1].split(/\s*[,、・]\s*/).map(Number).filter((x) => x > 0 && x < 300) };
  if (/先\s?端/.test(t)) return { tip: true, side: (t.match(/先\s?端\s*(内側|外側)/) || [])[1] || null };
  return null;
}

/** Daily visitor count at a managed fishing area ("入場者数：66名"). */
export function extractVisitors(text) {
  const m = normalize(text).match(/入場者数\s*[:：]?\s*(\d{1,4})/);
  return m ? +m[1] : null;
}
