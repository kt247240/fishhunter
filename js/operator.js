/* ANON. Operator — drafts SNS posts from live FishHunter data.
 * Drafts only: nothing is posted or sent from here. */
(function (g) {
  'use strict';
  const FH = g.FH;
  const E = FH.engine;
  const { esc, $, md, hm, range, toast } = FH.ui;
  const HOUR = 3600e3;
  const APP = FH.share.appUrl().replace(/app\.html$/, '');
  const DISCLAIMER = '※スコアは釣れる確率ではありません';

  const GROUPS = [
    { id: 'joetsu', label: '上越', areas: ['上越'], tags: '#上越釣り #糸魚川釣り' },
    { id: 'chuetsu', label: '中越', areas: ['中越'], tags: '#柏崎釣り #新潟釣り' },
    { id: 'kaetsu', label: '下越・佐渡', areas: ['下越', '佐渡'], tags: '#新潟釣り #佐渡釣り' },
    { id: 'nagano', label: '長野', areas: ['北信', '中信', '東信', '南信'], tags: '#長野釣り #渓流 #ワカサギ' }
  ];

  /** X weighted length: CJK & other non-Latin count 2, URLs count 23. */
  function xLength(text) {
    let n = 0;
    const urls = text.match(/https?:\/\/\S+/g) || [];
    let t = text;
    urls.forEach((u) => { t = t.replace(u, ''); n += 23; });
    for (const ch of t) n += /[\u0000-ჿ -‍‐-‟′-‷]/.test(ch) ? 1 : 2;
    return n;
  }
  const short = (n) => n.replace(/（.*?）/g, '');

  function draft(id, title, text, { limit = 280, card = null } = {}) {
    return `<div class="draft" data-id="${id}">
      <div class="draft-head"><b>${esc(title)}</b><span class="count" data-count-for="${id}"></span></div>
      <textarea rows="${Math.min(12, text.split('\n').length + 1)}" data-limit="${limit}" data-draft="${id}">${esc(text)}</textarea>
      <div class="draft-act"><button class="btn sm" data-copy="${id}" type="button">コピー</button>
      ${card ? `<button class="btn sm" data-card='${esc(JSON.stringify(card))}' type="button">📸 共有カード</button>` : ''}</div>
    </div>`;
  }

  function updateCounts() {
    document.querySelectorAll('textarea[data-draft]').forEach((ta) => {
      const lim = +ta.dataset.limit;
      const el = document.querySelector(`[data-count-for="${ta.dataset.draft}"]`);
      if (!el) return;
      if (lim === 280) { const n = xLength(ta.value); el.textContent = `X ${n}/280`; el.classList.toggle('over', n > 280); }
      else { el.textContent = `${[...ta.value].length}字`; el.classList.remove('over'); }
    });
  }

  /* ───────── drafts ───────── */
  function weekendDrafts(data, now) {
    const out = [];
    const wk0 = E.weekend(data, now, { limit: 1 });
    $('#wkRange').textContent = wk0.map((d) => `${md(d.day)}${d.inRange ? '' : '（予報範囲外）'}`).join(' ・ ');
    for (const G of GROUPS) {
      const filter = (spot) => G.areas.includes(spot.area);
      const wk = E.weekend(data, now, { limit: 3, filter });
      if (!wk.some((d) => d.picks.length)) continue;
      // X: top pick per day, trimmed to fit
      const lines = [`【週末の時合予報｜${G.label}】`];
      wk.forEach((d) => { const p = d.picks[0]; if (p) lines.push(`${d.label} ${hm(p.win.start)}〜${hm(p.win.end)} ${short(p.spot.name)}×${short(p.sp.name)} ${p.win.peak}`); });
      lines.push(DISCLAIMER, `#FishHunter ${G.tags.split(' ')[0]}`, APP);
      let x = lines.join('\n');
      while (xLength(x) > 280 && lines.length > 4) { lines.splice(lines.length - 3, 1); x = lines.join('\n'); }
      // Instagram: full top 3 with tactic hints
      const ig = [`【週末の時合予報｜${G.label}】`, ''];
      wk.forEach((d) => {
        ig.push(`■ ${md(d.day)}`);
        if (!d.inRange) { ig.push('まだ予報範囲外です'); ig.push(''); return; }
        if (!d.picks.length) { ig.push('目立った時合なし（荒天・シーズンオフ）'); ig.push(''); return; }
        d.picks.forEach((p) => {
          const c = E.conditions(p.spot, p.win.peakT + HOUR / 2, data);
          const t = E.tactics(p.spot, p.sp, c);
          ig.push(`・${hm(p.win.start)}〜${hm(p.win.end)} ${p.spot.name}×${p.sp.name}（ピーク${p.win.peak}）`);
          ig.push(`　→ ${t.method.name}／${t.color.main.replace(/（.*?）/g, '').split('／')[0].trim()}／${t.layer.replace(/（.*?）/g, '')}`);
        });
        ig.push('');
      });
      ig.push('高波・雷・増水の予報時は無理せず撤収を。ライフジャケット着用・立入禁止区域は厳守で。', DISCLAIMER, '', `#FishHunter #時合を読め ${G.tags} #釣り好きな人と繋がりたい`);
      const topSat = wk[0].picks[0] || wk[1].picks[0];
      out.push(draft('wk-x-' + G.id, `X ｜ ${G.label}`, x));
      out.push(draft('wk-ig-' + G.id, `Instagram ｜ ${G.label}`, ig.join('\n'), { limit: 2200, card: topSat ? { spot: topSat.spot.id, sp: topSat.sp.id, t: topSat.win.peakT } : null }));
    }
    $('#weekendDrafts').innerHTML = out.join('') || '<p class="muted">週末が予報の範囲に入ると表示されます。</p>';
  }

  function safetyDrafts(data, now) {
    const list = E.dangerScan(data, now, 72).filter((x) => x.spot.water === 'sea');
    if (!list.length) { $('#safetyDrafts').innerHTML = '<p class="muted">今後72時間、海の釣り場で危険判定はありません。</p>'; return; }
    // Group by area × day × reason
    const groups = new Map();
    for (const x of list) {
      const key = `${x.spot.area}|${FH.astro.jstMidnight(new Date(x.start)).getTime()}|${x.reasons.join('・')}`;
      const g0 = groups.get(key) || { area: x.spot.area, day: x.start, reasons: x.reasons, start: x.start, end: x.end, spots: [] };
      g0.start = Math.min(g0.start, x.start); g0.end = Math.max(g0.end, x.end); g0.spots.push(x.spot.name);
      groups.set(key, g0);
    }
    const out = [...groups.values()].sort((a, b) => a.start - b.start).slice(0, 6).map((gx, i) => {
      const r = gx.reasons.join('・');
      const text = `⚠【${r}注意｜${gx.area}】\n${md(gx.day)} ${hm(gx.start)}〜${hm(gx.end)}ごろ、${gx.area}の海で${r}の予報。\n外向きの堤防・磯・サーフは危険です。無理な釣行は控え、撤収判断は早めに。\n#FishHunter #安全第一`;
      return draft('safe-' + i, `X ｜ ${gx.area} ${md(gx.day)}（対象 ${gx.spots.length}か所）`, text);
    });
    $('#safetyDrafts').innerHTML = out.join('');
  }

  function todayDrafts(data, now) {
    const p = E.topPicks(data, now, 12, 1)[0];
    if (!p) { $('#todayDrafts').innerHTML = '<p class="muted">今後12時間に目立つ時合はありません。</p>'; return; }
    const c = E.conditions(p.spot, p.win.peakT + HOUR / 2, data);
    const t = E.tactics(p.spot, p.sp, c);
    const x = `今日のイチオシ｜${short(p.spot.name)}×${short(p.sp.name)}\n${range(p.win.start, p.win.end, now)} ピーク${p.win.peak}\n${t.method.name}・${t.color.main.replace(/（.*?）/g, '').split('／')[0]}\n${DISCLAIMER}\n#FishHunter\n${APP}`;
    $('#todayDrafts').innerHTML = draft('today-x', 'X ｜ 今日のイチオシ', x) +
      `<div class="draft-act"><button class="btn sm" data-card='${esc(JSON.stringify({ spot: p.spot.id, sp: p.sp.id, t: p.win.peakT }))}' type="button">📸 共有カード</button></div>`;
  }

  /* ───────── share cards via an off-screen scene ───────── */
  let scene = null;
  async function makeCard(o, data) {
    const spot = FH.spotById[o.spot], fish = FH.speciesById[o.sp];
    const t = o.t + HOUR / 2;
    const c = E.conditions(spot, t, data);
    const r = E.score(spot, fish, c);
    const ser = E.series(spot, fish, data, o.t, 12);
    const win = E.windows(ser, { min: 0, limit: 1 })[0];
    if (!scene) scene = FH.scene.create($('#scene'), $('#sceneUi'));
    scene.update({ spot, species: fish, cond: c, score: null, safety: r.safety, t });
    await new Promise((res) => setTimeout(res, 700));
    await FH.share.shareCard({ spot, fish, score: r.score, win, cond: c, scene: $('#scene'), now: t });
  }

  /* ───────── boot ───────── */
  let data = null;
  async function load(force) {
    try {
      data = await FH.weather.load(FH.SPOTS, { force });
      const now = Date.now();
      $('#dataStamp').textContent = `気象 ${FH.ui.ago(data.fetchedAt)}更新 ・ ${md(now)} ${hm(now)}`;
      weekendDrafts(data, now); safetyDrafts(data, now); todayDrafts(data, now);
      updateCounts();
    } catch (e) {
      $('#dataStamp').textContent = '気象データを取得できません';
      toast(String(e.message || e), 4000);
    }
  }

  document.addEventListener('input', (e) => { if (e.target.matches('textarea[data-draft]')) updateCounts(); });
  document.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const ta = document.querySelector(`textarea[data-draft="${cp.dataset.copy}"]`);
      try { await navigator.clipboard.writeText(ta.value); toast('コピーしました。投稿前に内容を確認してください'); }
      catch (_) { ta.select(); document.execCommand && document.execCommand('copy'); toast('選択しました'); }
      return;
    }
    const cd = e.target.closest('[data-card]');
    if (cd && data) { toast('カードを作成中…', 1200); await makeCard(JSON.parse(cd.dataset.card), data); }
  });
  $('#btnReload').addEventListener('click', () => load(true));
  load(false);

  FH.operator = { xLength };
})(typeof globalThis !== 'undefined' ? globalThis : this);
