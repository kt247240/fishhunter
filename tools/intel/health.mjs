// FishHunter data health check (run in CI after the collector).
//   node tools/intel/health.mjs [dataDir]  → prints a Markdown report; exit 2 when something critical broke.
// Critical = the sources the evidence features depend on (both managed-pier feeds, the prefecture's
// open data, the daybook/calibration) failed or came back empty.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'data';
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } };

export function check({ intel, official, book, cal, hot }) {
  const problems = [], notes = [];
  if (!intel) problems.push('data/intel.json が作られていません（収集が途中で停止）');
  else {
    for (const id of ['happyfishing-naoetsu', 'happyfishing-higashi']) {
      const s = (intel.sources || []).find((x) => x.id === id);
      if (!s) problems.push(`${id}: ソース定義なし`);
      else if (!s.ok) problems.push(`${s.name}: 取得失敗（${s.error || '不明'}）`);
      else if (!s.count) problems.push(`${s.name}: 0件（サイトの構成が変わった可能性）`);
    }
    const bad = (intel.sources || []).filter((s) => !s.ok && !/未設定/.test(s.error || ''));
    const ok = (intel.sources || []).filter((s) => s.ok).length;
    notes.push(`釣果ソース ${ok}/${(intel.sources || []).length} 正常`);
    if (bad.length >= 6) problems.push(`取得失敗のソースが${bad.length}件: ${bad.map((s) => s.name).join('、')}`);
  }
  if (!official) problems.push('data/official.json がありません');
  else {
    for (const e of official.errors || []) problems.push('公的データ: ' + e);
    for (const k of official.stale || []) notes.push(`公的データ ${k} は前回値を使用中`);
  }
  if (!book || !(book.days || []).length) problems.push('釣果日誌（daybook）が空です');
  if (!cal || !Object.keys(cal.species || {}).length) problems.push('実績の対応表（calibration）が空です');
  if (!hot || Object.keys(hot.spots || {}).filter((k) => k[0] !== '@').length < 2) problems.push('狙い目データ（hotspots）の釣り場が2未満です');
  return { problems, notes };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const r = check({ intel: read('intel.json'), official: read('official.json'), book: read('daybook.json'), cal: read('calibration.json'), hot: read('hotspots.json') });
  const md = [`## FishHunter データ監視（${new Date().toISOString()}）`, '', r.problems.length ? '### ⚠️ 要対応' : '### ✅ 正常', ...r.problems.map((p) => '- ' + p), '', ...r.notes.map((n) => '- ' + n)].join('\n');
  console.log(md);
  process.exit(r.problems.length ? 2 : 0);
}
