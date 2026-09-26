/* FishHunter — application controller. */
(function (g) {
  'use strict';
  const FH = g.FH;
  const { esc, $, $$, hm, md, dayLabel, range, ago, f1, ring, tone } = FH.ui;
  const E = FH.engine;
  const VERSION = 'v24.0.0 TARGET';
  const HOUR = 3600e3;
  const LS = { spot: 'fh.spot', sp: 'fh.sp', view: 'fh.view', theme: 'fh.theme' };

  const store = {
    get(k, d) { try { const v = g.localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { g.localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
  };

  // Demo / screenshot mode: ?t=2026-09-26T05:10 (JST) freezes the clock at that instant.
  const demoT = (() => {
    try {
      const v = new URLSearchParams(location.search).get('t');
      if (!v) return null;
      const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + '+09:00');
      return isFinite(t) ? t : null;
    } catch (_) { return null; }
  })();
  const clock = () => (demoT == null ? Date.now() : demoT);

  const state = {
    spotId: store.get(LS.spot, 'naoetsu'),
    speciesId: store.get(LS.sp, ''),
    view: store.get(LS.view, 'now'),
    data: null,
    now: clock(),
    chartH: 72,
    feedTab: 'mine',
    pref: '',
    userPos: null,
    dirty: new Set(['now', 'map', 'hunt', 'log', 'sys']),
    picksKey: null,
    wins: []
  };
  if (!FH.spotById[state.spotId]) state.spotId = 'naoetsu';

  const spot = () => FH.spotById[state.spotId];
  const species = () => FH.speciesById[state.speciesId];
  let chart = null;
  let scene = null;

  /* ───────────────────────── pickers ───────────────────────── */

  function fillSpotSelect(sel, value) {
    const favs = FH.SPOTS.filter((s) => FH.prefs.isFav(s.id));
    const favGroup = favs.length ? `<optgroup label="★ お気に入り">${favs.map((s) => `<option value="${s.id}"${s.id === value ? ' selected' : ''}>★ ${esc(s.name)}</option>`).join('')}</optgroup>` : '';
    sel.innerHTML = favGroup + FH.AREAS.map((area) => {
      const list = FH.SPOTS.filter((s) => s.area === area);
      if (!list.length) return '';
      const pref = list[0].pref;
      return `<optgroup label="${esc(pref + '・' + area)}">${list.map((s) => `<option value="${s.id}"${s.id === value && !FH.prefs.isFav(s.id) ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`;
    }).join('');
  }
  function fillSpeciesSelect(sel, list, value, allowAll) {
    sel.innerHTML = (allowAll ? '<option value="">すべての魚種</option>' : '') + list.map((s) => `<option value="${s.id}"${s.id === value ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  function syncSpecies() {
    const sp = spot();
    const list = E.speciesFor(sp);
    if (!sp.species.includes(state.speciesId)) {
      // Pick the in-season species with the best seasonal weight at this spot.
      const m = FH.astro.jstParts(new Date()).m - 1;
      state.speciesId = list.slice().sort((a, b) => b.months[m] - a.months[m])[0].id;
    }
    fillSpeciesSelect($('#huntTarget'), list, state.speciesId);
    store.set(LS.sp, state.speciesId);
  }

  function select(spotId, speciesId, opts = {}) {
    if (spotId && FH.spotById[spotId]) state.spotId = spotId;
    if (speciesId && FH.speciesById[speciesId]) state.speciesId = speciesId;
    store.set(LS.spot, state.spotId);
    $('#spotPick').value = state.spotId;
    syncSpecies();
    markAllDirty();
    render();
    if (opts.focusMap && FH.map.ready()) FH.map.focus(spot());
    if (opts.scrollTop) g.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ───────────────────────── views ───────────────────────── */

  function markAllDirty() { ['now', 'map', 'hunt', 'log', 'sys'].forEach((v) => state.dirty.add(v)); }

  function show(view) {
    state.view = view;
    store.set(LS.view, view);
    FH.motion.transition(() => {
      $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
      $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === view));
      render();
    });
    FH.motion.tabIndicator($('#tabbar'));
    if (view !== 'map' && playTimer) togglePlay(false);
    if (view !== 'now') { $('#miniBar').hidden = true; document.querySelector('.topbar').classList.remove('compact'); }
    if (view === 'map') FH.map.invalidate();
    if (view === 'now' && chart) chart.redraw();
  }

  function render() {
    const v = state.view;
    if (!state.dirty.has(v)) return;
    state.dirty.delete(v);
    try {
      const r = ({ now: renderNow, map: renderMap, hunt: renderHunt, log: renderLog, sys: renderSys })[v]();
      FH.motion.countUp($('#view-' + v));
      FH.motion.stagger($('#view-' + v));
      if (r && r.catch) r.catch((e) => FH.diag.report('render:' + v, { label: '画面描画 ' + v, state: 'error', detail: String(e && e.message) }));
    } catch (e) {
      console.error(e);
      FH.diag.report('render:' + v, { label: '画面描画 ' + v, state: 'error', detail: String(e && e.message) });
    }
  }

  function stamp() {
    const d = state.data;
    const el = $('#dataStamp');
    if (!d) { el.textContent = 'データ準備中…'; return; }
    const old = Date.now() - d.fetchedAt > 3 * HOUR;
    const off = navigator.onLine === false;
    el.textContent = `${off ? 'オフライン・' : ''}気象 ${ago(d.fetchedAt)}更新${d.stale && (d.stale.wx || d.stale.marine) ? '（一部キャッシュ）' : ''}${old ? ' ⚠ 古いデータ' : ''}`;
    el.classList.toggle('stale', old || off);
  }

  function banner(msg) {
    const el = $('#banner');
    if (!msg) { el.hidden = true; return; }
    el.innerHTML = msg; el.hidden = false;
  }

  /* ── NOW ── */
  function renderNow() {
    const sp = spot(), fish = species(), d = state.data;
    $('#spotName').textContent = sp.name;
    $('#spotMeta').textContent = `${sp.pref}・${sp.area} ／ ${sp.type}`;
    $('#spotChips').innerHTML = E.speciesFor(sp).map((s) =>
      `<button class="chip dot${s.id === fish.id ? ' accent' : ''}" style="--c:${s.color}" data-sp="${s.id}" type="button">${esc(s.name)}</button>`).join('');
    $('#routeLink').href = `https://www.google.com/maps/dir/?api=1&destination=${sp.lat},${sp.lon}`;

    if (!d) {
      $('#spotScore').innerHTML = ring(null, 104);
      $('#factors').innerHTML = '<div class="skeleton" style="height:120px"></div>';
      $('#fieldNow').innerHTML = '<div class="skeleton" style="height:140px;grid-column:1/-1"></div>';
      renderAstro(sp);
      const sc = ensureScene();
      if (sc) sc.update({ spot: sp, species: fish, cond: E.conditions(sp, state.now, null), score: null, t: state.now });
      $('#heroTitle').textContent = `${sp.name} × ${fish.name}`;
      return;
    }

    const now = state.now;
    const c = E.conditions(sp, now, d);
    const cur = c.hasWx ? E.score(sp, fish, c, hookOpts(sp, fish, c)) : null;
    $('#spotScore').innerHTML = ring(cur ? cur.score : null, 104);

    // Safety
    const sEl = $('#safety');
    if (cur && cur.safety.level) {
      sEl.className = 'safety l' + cur.safety.level;
      sEl.innerHTML = `<b>${cur.safety.level === 2 ? '⚠ 危険：釣行を見合わせてください' : '⚠ 注意'}</b><ul>${cur.safety.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
      sEl.hidden = false;
    } else sEl.hidden = true;

    // Factor breakdown
    $('#factors').innerHTML = cur ? cur.factors.map((f, i) => {
      const pos = f.impact >= 0;
      const w = f.value != null ? Math.round(f.value * 100) : Math.min(100, Math.round(Math.abs(f.impact) * 12));
      return `<div class="factor"><span class="name">${esc(f.label)}</span><span class="bar${pos ? '' : ' neg'}"><i style="width:${w}%;--i:${i}"></i></span>
        <span class="imp ${pos ? 'pos' : 'neg'}">${pos ? '+' : ''}${f.impact.toFixed(1)}</span><span class="note">${esc(f.note || '')}</span></div>`;
    }).join('') : '<p class="muted">この地点の気象データがありません</p>';
    if (cur) {
      const fs = cur.factors.filter((f) => f.key !== 'season').slice().sort((a, b) => b.impact - a.impact);
      const up = fs.filter((f) => f.impact > 0.5).slice(0, 2), down = fs.filter((f) => f.impact < -0.5).slice(-1);
      $('#factorSummary').innerHTML = [...up.map((f) => `<i class="fs up">＋${esc(f.label)}</i>`), ...down.map((f) => `<i class="fs down">－${esc(f.label)}</i>`)].join('');
    } else $('#factorSummary').innerHTML = '';

    // Windows
    const ser = E.series(sp, fish, d, now, 72);
    const wins = E.windows(ser, { min: 45, limit: 4 });
    state.wins = wins;
    const tac0 = c.hasWx ? E.tactics(sp, fish, c) : null;
    $('#windows').innerHTML = wins.length ? wins.map((w, i) =>
      `<li class="tone-${tone(w.peak)}"><span class="pk num">${w.peak}</span><span><span class="tm">${range(w.start, w.end, now)}</span><br><span class="tg">${esc(E.verdict(w.peak).label)} ・ ${esc(w.tags.join('・'))} ／ 平均 ${w.avg}</span></span>
        <span class="win-act"><button type="button" class="mini" data-cal="${i}" title="カレンダーに追加（30分前に通知）" aria-label="カレンダーに追加">📅</button><a class="mini" href="${FH.share.googleCalUrl(sp, fish, w, tac0)}" target="_blank" rel="noopener" title="Googleカレンダーに追加" aria-label="Googleカレンダーに追加">G</a></span></li>`).join('')
      : '<li><span></span><span class="muted">72時間以内に目立った時合はありません。条件の良い別の釣り場・魚種も検討を。</span><span></span></li>';

    renderField(sp, c);
    renderAstro(sp);
    renderChart(sp, fish, now);
    renderHero(sp, fish, c, cur, wins, now);
    renderRadar(sp, fish);
    renderTarget(sp, fish);
    renderPicks();
  }

  /* 🎯 Evidence-backed target: how often it was caught here, where on the pier, how — counted in days. */
  function renderTarget(sp, fish) {
    const box = $('#targetCard');
    const T = FH.feed.target ? FH.feed.target(sp, fish) : null;
    const rk = FH.feed.hotRank ? FH.feed.hotRank(fish) : [];
    if (!T && !rk.length) { box.hidden = true; return; }
    box.hidden = false;
    const name = shortName(fish.name);
    $('#targetScope').textContent = `${name} ・ 直近${(T && T.days) || 60}日の実績`;
    let html = '';
    if (T && T.p) {
      const p = T.p;
      const pct = Math.round(T.rate * 100);
      const z = p.zones || [];
      const zmax = Math.max(1, ...z.map((x) => x.days));
      const tb = p.tb || {};
      const am = tb['朝'] || 0, pm = Math.max(tb['昼'] || 0, tb['夕'] || 0);
      const when = am >= pm * 1.5 && am >= 4 ? '午前に多い' : pm >= am * 1.5 && pm >= 4 ? '午後に多い' : '';
      const method = p.methods && p.methods[0] ? p.methods[0][0] : '';
      const best = z[0];
      html += `<div class="tg-head">
          <div class="tg-rate"><b class="num">${T.scope === 'spot' ? pct + '<small>%</small>' : p.days + '<small>日</small>'}</b>
            <span>${T.scope === 'spot' ? `報告のあった${T.reportDays}日のうち <b>${p.days}日</b> で${esc(name)}の釣果` : `${esc(T.label)}で${esc(name)}の釣果が報告された日（釣り場名なしの報告を含む）`}</span></div>
          <div class="tg-trend"><span>直近14日 <b class="num">${p.d14}</b>日</span><span>直近7日 <b class="num">${p.d7}</b>日</span>${p.max ? `<span>最大 <b class="num">${p.max}</b>cm</span>` : ''}</div>
        </div>`;
      if (best) {
        html += `<p class="tg-call">👉 狙うなら <b>${esc(best.label)}</b>${method ? ` × <b>${esc(method)}</b>` : ''}${when ? ` ・ ${when}` : ''}
          <span class="muted small">（${best.days}日で実績${best.d14 ? `・直近14日でも${best.d14}日` : ''}）</span></p>
          <ol class="tg-zones">${z.slice(0, 5).map((x, i) => `<li style="--i:${i}"><span class="tz-l">${esc(x.label)}</span><span class="tz-bar"><i style="width:${Math.max(6, (x.days / zmax) * 100)}%"></i></span><span class="tz-v num">${x.days}日${x.d14 ? `<em>直近${x.d14}</em>` : ''}</span></li>`).join('')}</ol>`;
      } else if (method) {
        html += `<p class="tg-call">👉 実績の多い釣り方は <b>${esc(method)}</b>${when ? ` ・ ${when}` : ''}</p>`;
      }
      if (p.methods && p.methods.length > 1) html += `<div class="chips">${p.methods.map(([m, n]) => `<span class="chip">${esc(m)} ${n}回</span>`).join('')}</div>`;
      html += `<p class="muted small">根拠：${esc(T.label)}の公開釣果 ${T.reportDays}日分（${md(T.from)}〜${md(T.to)}・${T.sources}ソース）。匹数ではなく「釣れた日数」で数えています。</p>`;
    } else if (T) {
      html += `<p class="muted small">${esc(T.label)}では直近${T.days}日（報告${T.reportDays}日分）に${esc(name)}の釣果報告がありません。下の実績のある釣り場も検討を。</p>`;
    }
    if (rk.length) {
      const top = rk.slice(0, 6);
      html += `<h4 class="rd-h">📊 ${esc(name)}が実際に釣れている釣り場 <small>直近30日・釣果のあった日数</small></h4>
        <ol class="tg-rank">${top.map((r, i) => `<li class="${r.spotId === sp.id ? 'on' : ''}" data-hot-spot="${r.spotId}" style="--i:${i}" tabindex="0" role="button">
          <span class="tr-no num">${i + 1}</span><span class="tr-name">${esc(r.spot.name)}<small>${esc(r.spot.area)}</small></span>
          <span class="tz-bar"><i style="width:${Math.max(6, (r.d30 / 30) * 100)}%"></i></span>
          <span class="tz-v num">${r.d30}日${r.d7 ? `<em>今週${r.d7}</em>` : ''}</span></li>`).join('')}</ol>
        <p class="muted small">公開釣果を出している釣り場ほど上位に出やすい点に注意（報告のない釣り場＝釣れない、ではありません）。</p>`;
    }
    $('#target').innerHTML = html;
    $('#targetStamp').textContent = '';
    FH.motion.stagger($('#target'));
  }


  function ensureScene() {
    if (scene || !FH.scene) return scene;
    try { scene = FH.scene.create($('#scene'), $('#sceneUi')); }
    catch (e) { FH.diag.report('scene', { label: 'ライブシーン', state: 'error', detail: String(e && e.message) }); }
    return scene;
  }

  function renderHero(sp, fish, c, cur, wins, now) {
    const sc = ensureScene();
    if (sc) sc.update({ spot: sp, species: fish, cond: c, score: cur ? cur.score : null, safety: cur && cur.safety, t: now });
    const short = (n) => n.replace(/（.*?）/g, '');
    $('#heroTitle').textContent = `${short(sp.name)} × ${short(fish.name)}`;
    const w = wins[0];
    let sub;
    if (!cur) sub = '気象データを待っています';
    else if (cur.safety.level === 2) sub = '⚠ 危険な条件です。今日は撤収・見合わせを推奨します';
    else if (cur.score >= 80) sub = '今が時合。迷わず竿を出すタイミングです';
    else if (cur.score >= 65) sub = '好条件。' + (w ? `ピークは${range(w.start, w.end, now)}` : '狙い所を絞って攻めましょう');
    else if (w) sub = `次の時合は${range(w.start, w.end, now)}（ピーク ${w.peak}）`;
    else sub = '72時間以内に目立つ時合はありません。別の釣り場・魚種も検討を';
    $('#heroSub').textContent = sub;
    $('#mbScore').textContent = cur ? cur.score : '–';
    $('#mbScore').className = 'mb-score num tone-' + tone(cur && cur.score);
    $('#mbTitle').textContent = `${short(sp.name)} × ${short(fish.name)}`;
    $('#mbSub').textContent = cur ? `${E.verdict(cur.score).label}${w ? ' ・ 次 ' + range(w.start, w.end, now) : ''}` : '';
    const tac = cur ? E.tactics(sp, fish, c) : null;
    $('#heroMeta').innerHTML = cur ? [
      `<span class="chip tone-${tone(cur.score)}">SCORE <b data-count="${cur.score}">${cur.score}</b></span>`,
      `<span class="chip">${esc(c.light.label)}</span>`,
      sp.water === 'sea' ? `<span class="chip">波 ${f1(c.wave)}m</span>` : `<span class="chip">水温 ${f1(c.waterTemp)}℃<em class="src estimate">EST</em></span>`,
      tac ? `<span class="chip">${esc(tac.method.name)}</span>` : ''
    ].join('') : '';
    // Sonar blips = recent bite windows ahead (angle = hours ahead)
    $('#sonarBlips').innerHTML = wins.slice(0, 4).map((x) => {
      const hrs = (x.peakT - now) / HOUR;
      const ang = (hrs / 72) * Math.PI * 2 - Math.PI / 2;
      const r = 20 + (x.peak / 100) * 26;
      return `<i style="left:${50 + Math.cos(ang) * r}%;top:${50 + Math.sin(ang) * r}%;--d:${((ang + Math.PI / 2) / (Math.PI * 2)) * 4}s"></i>`;
    }).join('');
  }

  const shortName = (n) => n.replace(/（.*?）/g, '');
  function snsLinks(sp, fish) {
    const q = `${shortName(sp.name)} ${fish ? shortName(fish.name).split('・')[0] : '釣り'}`;
    const tag = shortName(sp.name).replace(/[・\s]/g, '') + '釣り';
    return [
      ['X', `https://x.com/search?q=${encodeURIComponent(q + ' 釣果')}&f=live`],
      ['Instagram', `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`],
      ['YouTube', `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' 釣り')}&sp=CAI%253D`],
      ['Bluesky', `https://bsky.app/search?q=${encodeURIComponent(q)}`]
    ];
  }

  function catchChip(c) {
    const size = c.max ? (c.min && c.min !== c.max ? `${c.min}〜${c.max}cm` : c.min ? `${c.max}cm` : `〜${c.max}cm`) : '';
    return `<span class="chip${c.sp ? ' dot' : ''}" ${c.sp ? `style="--c:${FH.speciesById[c.sp].color}"` : ''}>${esc(c.alias || c.name)}${c.count ? '×' + c.count : ''}${size ? ' ' + size : ''}</span>`;
  }

  function renderRadar(sp, fish) {
    $('#snsLinks').innerHTML = '<span class="muted small">SNSで最新を見る：</span>' + snsLinks(sp, fish).map(([n, u]) => `<a class="btn sm" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('');
    if (!FH.feed.loaded()) {
      $('#radarScope').textContent = '';
      $('#radar').innerHTML = '<p class="muted small">公開釣果の取得待ちです（公開版では2〜3時間ごとに自動更新）。</p>';
      return;
    }
    const rd = FH.feed.radar(sp, 7);
    $('#radarStamp').textContent = FH.feed.generatedAt() ? '収集 ' + ago(Date.parse(FH.feed.generatedAt())) : '';
    $('#radarScope').textContent = rd && rd.scope !== 'none' ? `${rd.label} ・ 直近7日` : '';
    if (!rd || !rd.list.length) {
      const nts0 = FH.feed.notices(sp);
      $('#radar').innerHTML = (nts0.length ? `<div class="rd-notices"><h4 class="rd-h">📢 お知らせ（漁協・管理者）</h4>${nts0.map((n) => `<a class="rd-notice" href="${esc(n.url)}" target="_blank" rel="noopener nofollow"><b>${md(n.date)}</b> ${esc(n.text)} <span class="muted small">— ${esc(n.src)}</span></a>`).join('')}</div>` : '') +
        `<p class="muted small">この釣り場・エリアの直近の公開釣果はまだありません。SNSの最新投稿も確認してみてください。</p>`;
      return;
    }
    const max = Math.max(...rd.list.map((x) => x.fish || x.reports));
    const rows = rd.list.slice(0, 10).map((x, i) => {
      const m = Object.entries(x.methods || {}).sort((a, b) => b[1] - a[1])[0];
      const t = Object.entries(x.times || {}).sort((a, b) => b[1] - a[1])[0];
      const on = x.sp && x.sp === fish.id;
      const pickable = x.sp && sp.species.includes(x.sp);
      return `<li class="rd-row${on ? ' on' : ''}${pickable ? ' rd-pick' : ''}" ${pickable ? `data-rsp="${x.sp}"` : ''} style="--i:${i}${x.sp ? ';--c:' + FH.speciesById[x.sp].color : ''}">
        <span class="rd-name">${esc(shortName(x.name))}</span>
        <span class="rd-bar"><i style="width:${Math.max(6, ((x.fish || x.reports) / max) * 100)}%"></i></span>
        <span class="rd-val num">${x.fish ? x.fish + '匹' : x.reports + '件'}${x.trend ? `<i class="trend ${x.trend}" title="先週 ${x.prev}">${{ up: '↑', down: '↓', flat: '→', new: 'NEW' }[x.trend]}</i>` : ''}</span>
        <span class="rd-sub">${x.maxSize ? '最大' + x.maxSize + 'cm' : ''}${m ? ' ・ ' + esc(m[0]) : ''}${t ? ' ・ ' + esc(t[0]) + 'に多い' : ''}</span></li>`;
    }).join('');
    const ins = FH.feed.insight(sp, fish);
    const tip = ins ? `<div class="insight rd-tip">💡 <b>${esc(shortName(fish.name))}の直近実績</b>（${ins.reports}件）${ins.maxSize ? ` 最大${ins.maxSize}cm` : ''}${ins.methods.length ? ' ／ ' + ins.methods.map(([k, n]) => `${esc(k)}${n}`).join('・') : ''}${ins.colors.length ? `<br><span class="small">「${esc(ins.colors[0])}」</span>` : ''}</div>` : '';
    const rec = FH.feed.recent(sp, 4).map((r) => `<li class="rd-rep">
        <div class="rd-rep-h"><span class="chip">${esc({ ugc: 'みんな', official: '公式', shop: '釣具店', sns: 'SNS', video: 'YouTube', blog: 'ブログ', coop: '漁協' }[r.type] || '情報')}</span><b>${esc(r.srcName)}</b><span class="muted small">${md(r.date)} ${hm(r.date)}</span></div>
        <div class="chips">${r.catches.filter((c) => !c.mention).slice(0, 5).map(catchChip).join('')}</div>
        ${r.url ? `<a class="small" href="${esc(r.url)}" target="_blank" rel="noopener nofollow">元の投稿・記事を見る →</a>` : `<span class="small muted">${esc(r.author || '')} さんの投稿</span>`}</li>`).join('');
    const pm = FH.feed.pierMap(sp, fish);
    const vis = FH.feed.visitors(sp);
    let pierHtml = '';
    if (pm) {
      const mx = Math.max(...pm.bins.map((b) => pm.kind === 'm' ? Math.max(b.in, b.out) : b.total), 1);
      const cell = (v) => `<span class="pm-cell" style="--a:${(v / mx).toFixed(2)}">${v ? Math.round(v) : ''}</span>`;
      const rows = pm.kind === 'm'
        ? `<div class="pm-row"><span class="pm-lab">外側</span>${pm.bins.map((b) => cell(b.out)).join('')}</div>
           <div class="pm-row"><span class="pm-lab">内側</span>${pm.bins.map((b) => cell(b.in)).join('')}</div>`
        : `<div class="pm-row"><span class="pm-lab">釣果</span>${pm.bins.map((b) => cell(b.total)).join('')}</div>`;
      const topTxt = pm.top ? (pm.kind === 'm' && pm.top.label !== '先端' ? `${pm.top.out >= pm.top.in ? '外側' : '内側'} ${pm.top.label}` : pm.top.label) : '';
      pierHtml = `<div class="pier-map"><h4 class="rd-h">🧭 堤防のどこで釣れている？ <small>直近14日・${esc(pm.species ? shortName(pm.species) : '全魚種')}・${pm.n}件</small></h4>
        <div class="pm-grid" style="--cols:${pm.bins.length}">${rows}
        <div class="pm-row pm-axis"><span class="pm-lab">${pm.kind === 'm' ? 'm' : '番'}</span>${pm.bins.map((b) => `<span>${esc(b.label.replace('m〜', '').replace('〜', '-').replace('番', ''))}</span>`).join('')}</div></div>
        <p class="small">いちばん多いのは <b>${esc(topTxt)}</b>${pm.kind === 'm' ? '（入口からの距離）' : ''}${vis ? ` ／ 入場者 ${vis.latest}名（${md(vis.date)}・14日平均${vis.avg}名）` : ''}</p></div>`;
    } else if (vis) {
      pierHtml = `<p class="small">入場者 ${vis.latest}名（${md(vis.date)}・14日平均${vis.avg}名）</p>`;
    }
    const nts = FH.feed.notices(sp);
    const ntsHtml = nts.length ? `<div class="rd-notices"><h4 class="rd-h">📢 お知らせ（漁協・管理者）</h4>${nts.map((n) => `<a class="rd-notice" href="${esc(n.url)}" target="_blank" rel="noopener nofollow"><b>${md(n.date)}</b> ${esc(n.text)} <span class="muted small">— ${esc(n.src)}</span></a>`).join('')}</div>` : '';
    const rowArr = rows.split('</li>').filter((x) => x.trim()).map((x) => x + '</li>');
    const listHtml = `<ol class="rd-list" data-stagger>${rowArr.slice(0, 5).join('')}</ol>` +
      (rowArr.length > 5 ? `<details class="more"><summary><span>ほかの魚 ${rowArr.length - 5}種</span></summary><ol class="rd-list">${rowArr.slice(5).join('')}</ol></details>` : '');
    $('#radar').innerHTML = `${ntsHtml}${listHtml}${tip}${pierHtml}${rec ? `<details class="more"><summary><span>最新の釣果 ${FH.feed.recent(sp, 4).length}件</span></summary><ul class="rd-reps">${rec}</ul></details>` : ''}
      <p class="muted small">公開情報を自動で集計した目安です。釣り場全体の傾向であり、特定の場所での釣果を保証するものではありません。</p>`;
    FH.motion.stagger($('#radar'));
  }

  function hookOpts(sp, fish, c) {
    return {
      evidence: FH.feed.evidence(sp, fish),
      personal: FH.catchlog.personalBoost(fish.id, c)
    };
  }

  function renderField(sp, c) {
    $('#fieldNowAt').textContent = hm(state.now) + ' 時点';
    const tiles = [];
    const SRC = { o: '<em class="src observed">OBSERVED</em>', f: '<em class="src forecast">FORECAST</em>', m: '<em class="src model">MODEL</em>', e: '<em class="src estimate">EST</em>', c: '<em class="src calc">CALC</em>' };
    let ti = 0;
    const tile = (k, v, unit, s, cls, src = 'f') => tiles.push(`<div class="tile${cls ? ' ' + cls : ''}" style="--i:${ti++}"><div class="k">${k}${SRC[src] || ''}</div><div class="v">${v}<small>${unit || ''}</small></div><div class="s">${s || ''}</div></div>`);
    tile('天気', FH.weather.weatherIcon(c.code), '', FH.weather.weatherText(c.code) + (c.cloud != null ? ` ・雲${c.cloud}%` : ''));
    tile('気温', f1(c.temp), '℃', c.rain24 != null ? `24h雨量 ${f1(c.rain24, 0)}mm` : '');
    tile('風 ' + FH.ui.arrow(c.windDir), f1(c.wind, 0), 'm/s', `${E.compass(c.windDir)} ・最大${f1(c.gust == null ? null : Math.max(c.gust, c.wind || 0), 0)}m/s${sp.water === 'sea' ? (c.onshore > 0.5 ? ' 向かい風' : c.onshore < -0.5 ? ' 追い風' : '') : ''}`, (c.gust || 0) >= 15 ? 'alert' : (c.gust || 0) >= 11 ? 'warn' : '');
    if (sp.water === 'sea') {
      tile('波高', f1(c.wave), 'm', c.wavePeriod != null ? `周期 ${f1(c.wavePeriod, 0)}秒 ・うねり${f1(c.swell)}m` : '海況データなし', (c.wave || 0) >= 2.5 ? 'alert' : (c.wave || 0) >= 1.8 ? 'warn' : '');
      tile('海面水温', f1(c.waterTemp), '℃', '海洋モデル値', '', 'm');
      tile('濁り', c.murk > 0.55 ? '強' : c.murk > 0.25 ? '中' : '澄', '', '波・雨・向かい風から推定', '', 'e');
    } else {
      if (c.waterTempObs) tile('水温', f1(c.waterTemp), '℃', `${md(c.waterTempObs.date)} ${c.waterTempObs.src}`, '', 'o');
      else tile('推定水温', f1(c.waterTemp), '℃', '直近72h気温から推定', '', 'e');
      if (c.waterTempObs && c.waterTempObs.clarity) tile('水質', esc(c.waterTempObs.clarity.split('、')[0]), '', esc(c.waterTempObs.clarity), '', 'o');
      const r = c.flow || 0;
      tile('水量指数', f1(r, 0), 'mm', r < 3 ? '平水〜渇水' : r <= 12 ? 'ささ濁り・好水位' : r <= 30 ? '増水気味' : '増水・濁流', r > 30 ? 'alert' : r > 12 ? 'warn' : '', 'e');
    }
    tile('気圧', f1(c.pressure, 0), 'hPa', c.dp3 == null ? '' : `3h ${c.dp3 > 0 ? '+' : ''}${f1(c.dp3)} ${c.dp3 <= -0.5 ? '↘下降' : c.dp3 >= 0.5 ? '↗上昇' : '→安定'}`);
    $('#fieldNow').innerHTML = tiles.join('');
  }

  function renderAstro(sp) {
    const el = $('#astroStrip');
    if (!sp) { el.innerHTML = ''; return; }
    const now = new Date(state.now);
    const sun = FH.astro.sunTimes(now, sp.lat, sp.lon);
    const age = FH.astro.moonAge(now);
    const tide = FH.astro.tideName(now);
    const sol = FH.astro.solunar(now, sp.lat, sp.lon);
    const tomorrow = FH.astro.solunar(new Date(state.now + 24 * HOUR), sp.lat, sp.lon);
    const all = [...sol.major.map((p) => ({ ...p, m: 1 })), ...sol.minor, ...tomorrow.major.map((p) => ({ ...p, m: 1 })), ...tomorrow.minor]
      .filter((p) => p.end.getTime() > state.now).sort((a, b) => a.start - b.start);
    const next = all[0];
    el.innerHTML = `
      <div class="astro">${FH.ui.sunIcon(true)}<div><b>日の出 ${hm(sun.rise)}</b><span>朝マズメ ${hm(sun.rise && sun.rise.getTime() - 75 * 60e3)}〜</span></div></div>
      <div class="astro">${FH.ui.sunIcon(false)}<div><b>日の入 ${hm(sun.set)}</b><span>夕マズメ〜${hm(sun.set && sun.set.getTime() + 75 * 60e3)}</span></div></div>
      <div class="astro">${FH.ui.moonIcon(age)}<div><b>月齢 ${age.toFixed(1)}・${FH.astro.moonPhaseName(age)}</b><span>出 ${hm(sol.moonrise)} ／ 入 ${hm(sol.moonset)}</span></div></div>
      <div class="astro">${sp.water === 'sea' ? FH.ui.tideIcon() : FH.ui.clockIcon()}<div><b>${sp.water === 'sea' ? tide.name : '次のソルナー'}</b><span>${next ? `${next.m ? '★' : '☆'}${esc(next.kind)} ${dayLabel(next.start)} ${hm(next.start)}〜${hm(next.end)}` : '—'}</span></div></div>`;
  }

  function renderChart(sp, fish, now) {
    if (!chart) chart = FH.ui.createChart($('#chart'), $('#chartTip'));
    const from = now - 3 * HOUR;
    const ser = E.series(sp, fish, state.data, from, state.chartH + 3);
    $('#legendEnv').textContent = sp.water === 'sea' ? '波高' : '降水量';
    chart.update(ser, { water: sp.water, now });
    renderBestStrip(ser, now);
  }

  /** A one-glance "when" strip: one cell per hour, colour = score, best window called out. */
  function renderBestStrip(ser, now) {
    const el = $('#bestStrip');
    const start = Math.max(0, ser.findIndex((p) => p.t + HOUR > now));
    const cells = ser.slice(start);
    const best = E.windows(cells, { min: 0, limit: 1 })[0];
    el.innerHTML = `<div class="bs-head">${best ? `<b>ベスト ${range(best.start, best.end, now)}</b><span class="chip tone-${tone(best.peak)}">ピーク ${best.peak}</span>` : '<span class="muted small">今後72時間のスコア</span>'}</div>
      <div class="bs-cells" style="--n:${cells.length}">${cells.map((p, i) => {
        const h = FH.astro.jstParts(new Date(p.t)).h;
        const inBest = best && p.t >= best.start && p.t < best.end;
        const danger = p.safety && p.safety.level === 2;
        return `<button type="button" class="bs-cell tone-${tone(p.score)}${inBest ? ' best' : ''}${danger ? ' danger' : ''}${h === 0 ? ' day' : ''}" style="--v:${p.score == null ? 0 : Math.max(0.08, Math.min(1, (p.score - 30) / 65)).toFixed(2)}" data-ci="${start + i}" aria-label="${dayLabel(p.t, now)} ${h}時 スコア ${p.score == null ? 'なし' : p.score}${danger ? ' 危険' : ''}"></button>`;
      }).join('')}</div>
      <div class="bs-axis">${cells.map((p) => { const h = FH.astro.jstParts(new Date(p.t)).h; return h === 0 ? `<span style="--x:${cells.indexOf(p)}">${md(p.t)}</span>` : ''; }).join('')}</div>`;
  }

  /** "📊 実績 18/30日" badge when this exact spot has a catch record for the species. */
  function pickEvidence(p) {
    const T = FH.feed.target ? FH.feed.target(p.spot, p.sp) : null;
    return T && T.scope === 'spot' && T.p && T.p.d30 ? `<span class="chip ev">📊 実績 ${T.p.d30}/30日</span>` : '';
  }

  function renderPicks() {
    const P = FH.prefs.get();
    const mine = P.scope === 'mine' && FH.prefs.hasPersonal();
    $$('#pickScope button').forEach((b) => b.classList.toggle('on', b.dataset.scope === (mine ? 'mine' : 'all')));
    $('#pickScope').hidden = !FH.prefs.hasPersonal();
    $('#pickHint').textContent = mine ? 'あなたのエリア・魚種・お気に入りから今後18時間で算出' : '今後18時間の全釣り場×魚種から算出';
    const key = state.data && state.data.fetchedAt + ':' + Math.floor(state.now / HOUR) + ':' + (mine ? JSON.stringify([P.areas, P.species, P.favorites]) : 'all');
    if (key && key === state.picksKey) return;
    state.picksKey = key;
    // Heavy: run in a Web Worker when available, otherwise defer on the main thread.
    computePicks(mine).then(({ picks, weekend }) => {
      if (key !== state.picksKey) return; // superseded by a newer request
      $('#topPicks').innerHTML = picks.length ? picks.map((p, i) => `
        <button class="pick-card tone-${tone(p.win.peak)}" style="--i:${i}" data-spot="${p.spot.id}" data-sp="${p.sp.id}" type="button">
          <span class="rank-no">#${i + 1} ・ ${esc(p.spot.pref)} ${esc(p.spot.area)}${FH.prefs.isFav(p.spot.id) ? ' ・ ★' : ''}</span>
          <h4>${esc(p.spot.name)}</h4>
          <span class="sp">${esc(p.sp.name)}</span>
          ${ring(p.win.peak, 64)}
          <span class="when">${range(p.win.start, p.win.end, state.now)}</span>
          <span class="tags">${pickEvidence(p)}${p.win.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span>
        </button>`).join('') : '<div class="empty">条件の良い候補が見つかりません（荒天・シーズンオフ）</div>';
      FH.motion.countUp($('#topPicks'));
      renderWeekend(mine, weekend);
    });
  }

  /* Off-main-thread scoring. Falls back to the main thread if workers are unavailable or fail. */
  let worker = null, reqId = 0;
  const pending = new Map();
  function getWorker() {
    if (worker !== null) return worker;
    try {
      worker = new Worker('js/picks-worker.js');
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); } };
      worker.onerror = () => { pending.forEach((p) => p.reject(new Error('worker'))); pending.clear(); worker = false; };
    } catch (_) { worker = false; }
    return worker;
  }
  function inflate(p) { return { spot: FH.spotById[p.spotId], sp: FH.speciesById[p.spId], win: p.win }; }
  function computePicks(mine) {
    const filter = mine ? FH.prefs.matches : null;
    const local = () => new Promise((res) => setTimeout(() => res({
      picks: E.topPicks(state.data, state.now, 18, 8, filter),
      weekend: E.weekend(state.data, state.now, { limit: 3, filter })
    }), 30));
    const w = getWorker();
    if (!w) return local();
    const evidence = {};
    if (FH.feed.loaded()) FH.SPOTS.forEach((s) => E.speciesFor(s).forEach((sp) => { const e = FH.feed.evidence(s, sp); if (e) evidence[s.id + ':' + sp.id] = e; }));
    const storage = {};
    ['fh.catchlog.v1', 'fh.prefs.v1'].forEach((k) => { try { const v = g.localStorage.getItem(k); if (v != null) storage[k] = k === 'fh.catchlog.v1' ? JSON.stringify(JSON.parse(v).map(({ photo, ...x }) => x)) : v; } catch (_) { /* ignore */ } });
    const id = ++reqId;
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, data: { wx: state.data.wx, marine: state.data.marine, fetchedAt: state.data.fetchedAt }, now: state.now, mine, evidence, observations: FH.feed.observations(), intel: FH.feed.loaded(), storage });
    }).then((r) => {
      FH.diag.report('worker', { label: '計算ワーカー', state: 'ok', ms: Math.round(performance.now() - t0), detail: 'おすすめ・週末を裏側で計算' });
      return { picks: r.picks.map(inflate).filter((p) => p.spot && p.sp), weekend: r.weekend.map((d) => Object.assign({}, d, { picks: d.picks.map(inflate).filter((p) => p.spot && p.sp) })) };
    }).catch(() => local());
  }

  function renderWeekend(mine, wk) {
    wk = wk || E.weekend(state.data, state.now, { limit: 3, filter: mine ? FH.prefs.matches : null });
    $('#wkHint').textContent = mine ? 'あなたのエリア・魚種から土日のベスト3' : '土日のベスト3（全域）';
    $('#weekend').innerHTML = wk.map((d) => `
      <article class="card wk-day">
        <div class="wk-head"><b>${md(d.day)}</b><span class="chip">${d.label === '土' ? 'SAT' : 'SUN'}</span></div>
        ${!d.inRange ? `<p class="muted small">まだ予報の範囲外です。${md(d.day - 6 * 86400e3)}頃から表示されます。</p>`
          : d.picks.length ? `<ol class="wk-list">${d.picks.map((p, i) => `
            <li class="wk-row tone-${tone(p.win.peak)}" data-spot="${p.spot.id}" data-sp="${p.sp.id}" style="--i:${i}">
              <span class="pk num">${p.win.peak}</span>
              <span><b>${esc(p.spot.name)}</b> × ${esc(p.sp.name)}<br><small>${hm(p.win.start)}〜${hm(p.win.end)} ・ ${esc(p.win.tags.slice(0, 2).join('・'))}</small></span>
            </li>`).join('')}</ol>`
          : '<p class="muted small">目立った時合がありません（荒天・シーズンオフ）。</p>'}
        ${d.inRange && d.day - state.now > 3 * 86400e3 ? '<p class="muted small">※3日以上先の予報は精度が下がります</p>' : ''}
      </article>`).join('');
  }

  /* ── MAP ── */
  async function renderMap() {
    const fish = species(), d = state.data;
    $('#rankTitle').textContent = `${fish.name} ランキング`;
    const ranks = d ? E.rankSpots(fish, d, state.now, 24).filter((r) => !state.pref || r.spot.pref === state.pref) : [];
    $('#rankList').innerHTML = ranks.length ? ranks.map((r, i) => {
      const peak = r.best ? r.best.peak : null;
      const dist = state.userPos ? distanceKm(state.userPos, r.spot) : null;
      return `<li class="tone-${tone(peak)}${r.spot.id === state.spotId ? ' sel' : ''}" data-spot="${r.spot.id}">
        <span class="no">${i + 1}</span>
        <span><span class="nm">${esc(r.spot.name)}</span><br><span class="sub">${esc(r.spot.area)}・${esc(r.spot.type)}${dist != null ? ` ・ ${dist.toFixed(0)}km` : ''}${r.best ? ` ・ ${range(r.best.start, r.best.end, state.now)}` : ''}</span></span>
        <span class="sc">${FH.ui.sparkline(r.series.map((x) => x.score))}<b>${peak == null ? '–' : peak}</b><small>今 ${r.now == null ? '–' : r.now}${r.safety && r.safety.level === 2 ? ' ⚠' : ''}</small></span></li>`;
    }).join('') : `<li><span></span><span class="muted">${d ? 'この魚種の対象釣り場がありません' : '読み込み中…'}</span><span></span></li>`;

    renderFacts();

    const el = $('#map');
    const ok = await FH.map.ensure(el);
    if (!ok) return;
    const first = !el.dataset.fitted || el.dataset.fitted !== state.pref;
    paintMapHour(first);
    el.dataset.fitted = state.pref;
    if (state.userPos) FH.map.showUser(state.userPos);
  }

  /* Map time travel: per-spot 72h series for the target species, cached per data × species × hour. */
  let mapCache = { key: null, series: {} };
  function mapSeries() {
    const fish = species();
    const t0 = Math.floor(state.now / HOUR) * HOUR;
    const key = state.data.fetchedAt + ':' + fish.id + ':' + t0 + ':' + (FH.feed.loaded() ? 1 : 0);
    if (mapCache.key !== key) {
      const series = {};
      FH.SPOTS.filter((s) => s.species.includes(fish.id)).forEach((s) => { series[s.id] = E.series(s, fish, state.data, t0, 72); });
      mapCache = { key, series, t0 };
    }
    return mapCache;
  }
  function paintMapHour(fit) {
    if (!state.data || !FH.map.ready()) return;
    const fish = species();
    const { series, t0 } = mapSeries();
    const h = state.mapHour || 0;
    const t = t0 + h * HOUR;
    $('#mapHourLabel').textContent = h === 0 ? '今' : `${dayLabel(t)} ${hm(t)}`;
    const items = FH.SPOTS.filter((s) => !state.pref || s.pref === state.pref).map((s) => {
      const p = series[s.id] && series[s.id][h];
      const danger = p && p.safety && p.safety.level === 2;
      return { spot: s, score: p ? p.score : null, label: p ? `${fish.name} ${p.score}${danger ? ' ⚠危険' : ''} ・ ${hm(t)}` : `${fish.name}の対象外` };
    });
    FH.map.render(items, state.spotId, (id) => { select(id); show('map'); FH.map.focus(spot()); }, fit);
    // Wind for the same hour at every spot (interpolated into particles by the map layer).
    const pts = FH.SPOTS.map((s) => {
      const c = E.conditions(s, t + HOUR / 2, state.data);
      return { lat: s.lat, lon: s.lon, speed: c.wind, dir: c.windDir };
    });
    FH.map.setWind(pts);
  }
  let playTimer = null;
  function togglePlay(force) {
    const on = force != null ? force : !playTimer;
    clearInterval(playTimer); playTimer = null;
    $('#mapPlay').textContent = on ? '❚❚' : '▶';
    if (!on) return;
    playTimer = setInterval(() => {
      state.mapHour = ((state.mapHour || 0) + 1) % 72;
      $('#mapHour').value = state.mapHour;
      paintMapHour(false);
    }, 450);
  }

  function renderFacts() {
    const sp = spot();
    const list = E.speciesFor(sp).map((s) => `<span class="chip dot" style="--c:${s.color}">${esc(s.name)}</span>`).join(' ');
    const dist = state.userPos ? distanceKm(state.userPos, sp) : null;
    $('#facts').innerHTML = `
      <div class="focus-head"><div><div class="eyebrow">${esc(sp.pref)}・${esc(sp.area)}</div><h3 style="font-size:20px">${esc(sp.name)}</h3></div>
        <button type="button" class="btn sm fav${FH.prefs.isFav(sp.id) ? ' on' : ''}" data-fav="${sp.id}" aria-pressed="${FH.prefs.isFav(sp.id)}">${FH.prefs.isFav(sp.id) ? '★ お気に入り' : '☆ お気に入り'}</button></div>
      <dl>
        <dt>タイプ</dt><dd>${esc(sp.type)}${sp.depth ? `（水深: ${{ shallow: '浅い', mid: '中程度', deep: '深い' }[sp.depth]}）` : ''}${sp.elev ? `／標高 約${sp.elev}m` : ''}</dd>
        <dt>対象魚</dt><dd><div class="chips">${list}</div></dd>
        <dt>特徴</dt><dd>${esc(sp.feature)}</dd>
        <dt>注意</dt><dd>${esc(sp.caution || '現地の標識・ルールに従ってください')}</dd>
        <dt>座標</dt><dd class="num">${sp.lat.toFixed(3)}, ${sp.lon.toFixed(3)}${dist != null ? ` ／ 現在地から直線 ${dist.toFixed(1)}km` : ''}</dd>
      </dl>
      <div class="rules">釣り場の立入可否・遊漁券・解禁期間は変更されることがあります。釣行前に必ず管理者・漁協の最新情報を確認してください。</div>
      <div class="links">
        <a class="btn sm primary" href="https://www.google.com/maps/dir/?api=1&destination=${sp.lat},${sp.lon}" target="_blank" rel="noopener">Googleマップでルート</a>
        <a class="btn sm" href="https://maps.gsi.go.jp/#15/${sp.lat}/${sp.lon}/" target="_blank" rel="noopener">地理院地図（地形）</a>
        <a class="btn sm" href="https://www.google.com/search?q=${encodeURIComponent(sp.name + ' 釣果')}" target="_blank" rel="noopener">最新釣果を検索</a>
        ${snsLinks(sp, species()).map(([n, u]) => `<a class="btn sm" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}
      </div>`;
  }

  /* ── HUNT ── */
  function renderHunt() {
    const sp = spot(), fish = species(), d = state.data;
    const m = FH.astro.jstParts(new Date(state.now)).m;
    $('#huntName').textContent = fish.name;
    $('#huntMeta').textContent = `${fish.group} ／ ${sp.name}`;
    $('#seasonBars').innerHTML = fish.months.map((w, i) =>
      `<div class="${i + 1 === m ? 'now' : ''}" style="--c:${fish.color}"><i style="height:${Math.max(3, w * 100)}%"></i><span>${i + 1}</span></div>`).join('');
    $('#methods').innerHTML = fish.methods.map((mt) =>
      `<div class="method"><h4>${esc(mt.name)}</h4><div class="gear">${esc(mt.gear)}</div><p>${esc(mt.how)}</p></div>`).join('') +
      (fish.rules ? `<div class="rules">📋 ${esc(fish.rules)}</div>` : '');

    if (!d) { $('#huntScore').innerHTML = ring(null, 104); $('#tactics').innerHTML = '<div class="skeleton" style="height:200px"></div>'; return; }
    const c = E.conditions(sp, state.now, d);
    const cur = c.hasWx ? E.score(sp, fish, c, hookOpts(sp, fish, c)) : null;
    $('#huntScore').innerHTML = ring(cur ? cur.score : null, 104);
    $('#huntSub').textContent = cur ? `${sp.name}の現在：${E.verdict(cur.score).label}（旬度 ${Math.round(cur.season * 100)}%）` : '';

    const t = E.tactics(sp, fish, c);
    const row = (ic, k, v, w) => `<div class="tac"><span class="ic">${ic}</span><div><div class="k">${k}</div><div class="v">${v}</div>${w ? `<div class="w">${w}</div>` : ''}</div></div>`;
    $('#tactics').innerHTML = [
      row('法', 'おすすめ釣法', esc(t.method.name), esc(t.method.gear)),
      row('色', 'カラー', esc(t.color.main), esc(t.color.why)),
      row('重', 'サイズ・重さ', esc(t.size)),
      row('層', 'レンジ', esc(t.layer)),
      row('速', 'スピード', esc(t.speed)),
      row('狙', '狙い所', t.aim.map(esc).join(' ／ ')),
      (() => { const ins = FH.feed.insight(sp, fish); return ins ? row('実', `直近の実績（${ins.reports}件）`, esc(ins.methods.map(([k, n]) => `${k}${n}`).join('・') || '釣法の記載なし') + (ins.maxSize ? ` ／ 最大${ins.maxSize}cm` : ''), ins.colors[0] ? esc('「' + ins.colors[0] + '」') : '') : ''; })(),
      t.notes.length ? `<div class="tac"><span class="ic">!</span><div><div class="k">今日のポイント</div><ul>${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div></div>` : ''
    ].join('');

    const ranks = E.rankSpots(fish, d, state.now, 72).slice(0, 8);
    $('#huntRank').innerHTML = ranks.map((r, i) => `<li class="tone-${tone(r.best && r.best.peak)}${r.spot.id === state.spotId ? ' sel' : ''}" data-spot="${r.spot.id}">
      <span class="no">${i + 1}</span><span><span class="nm">${esc(r.spot.name)}</span><br><span class="sub">${r.best ? range(r.best.start, r.best.end, state.now) + ' ・ ' + esc(r.best.tags.slice(0, 2).join('・')) : '時合なし'}</span></span>
      <span class="sc">${FH.ui.sparkline(r.series.map((x) => x.score))}<b>${r.best ? r.best.peak : '–'}</b></span></li>`).join('');
  }

  /* ── LOG ── */
  function renderLog() {
    const form = $('#logForm');
    $('#shareOpt').hidden = !FH.community.enabled();
    if (!form.dataset.ready) {
      fillSpotSelect(form.spot, state.spotId);
      form.when.value = localInput(Date.now());
      form.dataset.ready = '1';
    }
    if (!form.dataset.touched) {
      form.spot.value = state.spotId;
      fillSpeciesSelect(form.species, E.speciesFor(spot()), state.speciesId);
      fillMethods();
    }
    const aSel = $('#analysisSpecies');
    const cur = aSel.value;
    fillSpeciesSelect(aSel, FH.SPECIES, cur, true);
    renderAnalysis(aSel.value || null);
    renderFeed();
  }

  function fillMethods() {
    const form = $('#logForm');
    const fish = FH.speciesById[form.species.value];
    form.method.innerHTML = (fish ? fish.methods.map((m) => `<option>${esc(m.name)}</option>`).join('') : '') + '<option>その他</option>';
  }

  function localInput(t) {
    const p = FH.astro.jstParts(new Date(t));
    const pad = (n) => String(n).padStart(2, '0');
    return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
  }
  function parseLocalInput(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
    if (!m) return Date.now();
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * HOUR;
  }

  function renderAnalysis(speciesId) {
    const a = FH.catchlog.analyze(speciesId);
    const el = $('#analysis');
    if (!a.entries) {
      el.innerHTML = '<div class="empty">まだ記録がありません。<br>釣果を3件以上記録すると、あなたの「釣れる条件」を学習してスコアに反映します。</div>';
      return;
    }
    const dist = (title, pairs, map) => {
      if (!pairs.length) return '';
      const max = pairs[0][1];
      return `<div class="dist"><h4>${title}</h4>${pairs.slice(0, 4).map(([k, n]) => `<div class="r"><span>${esc(map ? map(k) : k)}</span><i style="width:${(n / max) * 100}%"></i><span>${n}</span></div>`).join('')}</div>`;
    };
    const top = (p) => (p.length ? p[0][0] : null);
    const lines = [];
    if (top(a.byLight)) lines.push(`<b>${esc(top(a.byLight))}</b>に強い`);
    if (top(a.byTide)) lines.push(`<b>${esc(top(a.byTide))}</b>で実績多`);
    if (top(a.byPressure)) lines.push(`気圧<b>${esc(top(a.byPressure))}</b>時に好調`);
    if (top(a.byColor)) lines.push(`カラーは<b>${esc(top(a.byColor))}</b>`);
    el.innerHTML = `
      <div class="stat-row">
        <div class="stat"><b>${a.entries}</b><span>記録</span></div>
        <div class="stat"><b>${a.fish}</b><span>釣果数</span></div>
        <div class="stat"><b>${a.maxSize == null ? '–' : a.maxSize}</b><span>最大cm</span></div>
        <div class="stat"><b>${a.avgScore == null ? '–' : a.avgScore}</b><span>平均スコア</span></div>
      </div>
      ${lines.length ? `<div class="insight">あなたの傾向：${lines.join('、')}。${a.entries >= 3 ? '条件が一致するとスコアに最大+6の補正がかかります。' : 'あと' + (3 - a.entries) + '件でスコア補正が有効になります。'}</div>` : ''}
      ${dist('時間帯', a.byLight)}${dist('潮回り', a.byTide)}${dist('気圧', a.byPressure)}
      ${dist('釣り場', a.bySpot, (id) => (FH.spotById[id] || {}).name || id)}
      ${!speciesId ? dist('魚種', a.bySpecies, (id) => (FH.speciesById[id] || {}).name || id) : ''}`;
  }

  function condChips(cd) {
    if (!cd) return '';
    const c = [];
    if (cd.light) c.push(cd.light);
    if (cd.tide) c.push(cd.tide);
    if (cd.wave != null) c.push(`波${cd.wave}m`);
    if (cd.wind != null) c.push(`風${Math.round(cd.wind)}m/s`);
    if (cd.waterTemp != null) c.push(`${cd.waterTempEst ? '推' : ''}水温${cd.waterTemp}℃`);
    if (cd.dp3 != null) c.push(cd.dp3 <= -0.5 ? '気圧↘' : cd.dp3 >= 0.5 ? '気圧↗' : '気圧→');
    if (cd.score != null) c.push(`スコア${cd.score}`);
    return `<div class="cond">${c.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>`;
  }

  function renderFeed() {
    const el = $('#postFeed');
    $$('#feedTab button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.feedTab));
    if (state.feedTab === 'mine') {
      const list = FH.catchlog.all();
      el.innerHTML = list.length ? list.slice(0, 60).map((x) => {
        const s = FH.spotById[x.spotId], f = FH.speciesById[x.speciesId];
        return `<article class="post">${x.photo ? `<img src="${x.photo}" alt="${esc((f && f.name) || '')}の写真" loading="lazy">` : ''}
          <div class="body"><h4>${esc(f ? f.name : x.speciesId)}${x.size ? ` ${x.size}cm` : ''}${x.count > 1 ? ` ×${x.count}` : ''}</h4>
          <div class="meta">${md(x.t)} ${hm(x.t)} ・ ${esc(s ? s.name : x.spotId)}${x.method ? ' ・ ' + esc(x.method) : ''}${x.lure ? ' ・ ' + esc(x.lure) : ''}${x.lureColor ? '（' + esc(x.lureColor) + '）' : ''}</div>
          ${condChips(x.cond)}${x.memo ? `<div class="memo">${esc(x.memo)}</div>` : ''}
          <div class="foot"><span class="muted">${ago(x.created || x.t)}に記録</span><button class="del" data-del="${x.id}" type="button">削除</button></div></div></article>`;
      }).join('') : '<div class="empty" style="grid-column:1/-1">まだ釣果がありません。最初の1匹を記録しよう！</div>';
      return;
    }
    const items = FH.feed.list({ limit: 40 });
    if (!FH.feed.loaded()) {
      el.innerHTML = '<div class="empty" style="grid-column:1/-1">公開釣果の取得待ちです（公開版では2〜3時間ごとに自動更新）。<br>診断タブで状態を確認できます。</div>';
      return;
    }
    const TYPE = { ugc: 'みんなの釣果', official: '公式', shop: '釣具店', sns: 'SNS', video: 'YouTube', blog: 'ブログ', coop: '漁協', boat: '船（沖の情報）' };
    el.innerHTML = items.map((r) => `<article class="post">
      <div class="body"><h4>${esc(r.spots.map((id) => (FH.spotById[id] || {}).name).filter(Boolean).join('・') || r.area || '')} ${esc(r.title)}</h4>
      <div class="meta">${esc(r.srcName)}${r.author ? ' ' + esc(r.author) : ''} ・ ${md(r.date)} ${hm(r.date)}</div>
      <div class="chips">${r.catches.filter((c) => !c.mention).slice(0, 8).map(catchChip).join('')}</div>
      ${r.colors && r.colors[0] ? `<div class="memo small">💡 ${esc(r.colors[0])}</div>` : ''}
      <div class="foot"><span class="chip">${esc(TYPE[r.type] || '情報')}</span>
      ${/^https?:\/\//.test(r.url || '') ? `<a href="${esc(r.url)}" target="_blank" rel="noopener nofollow">元の投稿・記事 →</a>` : ''}</div></div></article>`).join('') +
      `<p class="muted small" style="grid-column:1/-1">公式の管理釣り場の釣果報告と、SNSの公開投稿を自動で集計しています（抜粋とリンクのみ保存）。エリアの傾向の目安であり、釣果を保証するものではありません。${FH.feed.generatedAt() ? '収集: ' + esc(ago(Date.parse(FH.feed.generatedAt()))) : ''}</p>`;
  }

  async function onLogSubmit(ev) {
    ev.preventDefault();
    const form = ev.target;
    const t = parseLocalInput(form.when.value);
    const sp = FH.spotById[form.spot.value], fish = FH.speciesById[form.species.value];
    if (!sp || !fish) return;
    let cond = null;
    if (state.data) {
      const c = E.conditions(sp, t, state.data);
      if (c.hasWx) cond = FH.catchlog.snapshot(c, E.score(sp, fish, c).score);
    }
    if (!cond) {
      // Outside the weather window: still keep astro-derived context.
      const d = new Date(t);
      cond = { light: FH.astro.lightPhase(d, sp.lat, sp.lon).label, tide: FH.astro.tideName(d).name, moonAge: Math.round(FH.astro.moonAge(d) * 10) / 10 };
    }
    let photo = null;
    const file = form.photo.files && form.photo.files[0];
    if (file) { try { photo = await compressImage(file, 720, 0.72); } catch (_) { FH.ui.toast('写真を読み込めませんでした'); } }
    let saved;
    try {
      saved = FH.catchlog.add({
        t, spotId: sp.id, speciesId: fish.id,
        size: parseFloat(form.size.value) || null, count: parseInt(form.count.value, 10) || 1,
        method: form.method.value, lure: form.lure.value.trim(), lureColor: form.lureColor.value.trim(),
        memo: form.memo.value.trim(), photo, cond
      });
    } catch (e) { FH.ui.toast(e.message, 4000); return; }
    const share = form.share && form.share.checked && FH.community.enabled();
    form.size.value = ''; form.memo.value = ''; form.photo.value = ''; form.count.value = 1;
    FH.ui.toast(`🎣 ${fish.name}を記録しました${share ? '（共有中…）' : ''}`);
    if (share) {
      FH.community.post(saved).then(async () => {
        FH.ui.toast('🌐 みんなの釣果に匿名で共有しました');
        await FH.feed.refreshCommunity(); markAllDirty(); render();
      }).catch((e) => FH.ui.toast('共有できませんでした：' + e.message, 4000));
    }
    state.feedTab = 'mine';
    markAllDirty();
    render();
  }

  function compressImage(file, max, q) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  /* ── SYS ── */
  function renderSys() {
    const env = FH.diag.environment();
    const svcs = FH.diag.all();
    const envRows = [
      { label: 'ネットワーク', state: env.online ? 'ok' : 'error', detail: env.online ? 'オンライン' : 'オフライン（キャッシュで動作）' },
      { label: 'オフライン対応', state: env.sw ? 'ok' : 'warn', detail: env.sw ? 'Service Worker 有効' : '未登録（初回訪問 or 非対応環境）' },
      { label: 'ローカル保存', state: env.storage ? 'ok' : 'error', detail: env.storage ? '釣果ログ・キャッシュ保存可' : '保存不可（プライベートモード？）' }
    ];
    const srcRows = FH.feed.sources().map((x) => ({ label: '釣果ソース：' + x.name, state: x.ok ? (x.count ? 'ok' : 'warn') : 'error', detail: x.ok ? `${x.count}件（直近30日）` : '取得失敗: ' + (x.error || ''), ms: x.ms }));
    const linkRows = FH.feed.linkOnly().map((x) => ({ label: 'リンク案内のみ：' + x.name, state: 'warn', detail: x.reason }));
    $('#systemDiag').innerHTML = [...svcs, ...envRows, ...srcRows, ...linkRows].map((s) =>
      `<div class="svc"><span class="st ${s.state}"></span><div>${esc(s.label)}<small>${esc(s.detail || '')}${s.at ? ' ・ ' + ago(s.at) : ''}</small></div><span class="ms">${s.ms != null ? s.ms + 'ms' : ''}</span></div>`).join('') +
      (state.data ? `<p class="muted small">気象データ取得: ${md(state.data.fetchedAt)} ${hm(state.data.fetchedAt)}${state.data.fromCache ? '（キャッシュ）' : ''} ／ 地点 ${Object.keys(state.data.wx || {}).length}・海況 ${Object.keys(state.data.marine || {}).length}</p>` : '');
    $('#versionText').textContent = `FishHunter ${VERSION} ／ 釣り場 ${FH.SPOTS.length} ・ 魚種 ${FH.SPECIES.length}`;
  }

  /* ───────────────────────── data ───────────────────────── */

  async function loadData(force) {
    const btn = $('#btnRefresh');
    btn.classList.add('spin');
    try {
      state.data = await FH.weather.load(FH.SPOTS, { force });
      state.now = clock();
      state.picksKey = null;
      banner(state.data.stale.wx ? '⚠ 気象データの更新に失敗したため、前回取得したデータで表示しています。' : state.data.stale.marine ? '海況データの更新に失敗しました（前回値を使用）。' : '');
    } catch (e) {
      banner('⚠ 気象データを取得できません。電波状況を確認して再試行してください。潮・月・日の出入りはオフラインでも表示されます。');
      if (force) FH.ui.toast('更新に失敗しました');
    } finally {
      btn.classList.remove('spin');
      stamp();
      markAllDirty();
      render();
    }
  }

  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  async function shareImage() {
    const sp = spot(), fish = species();
    if (!state.data) return FH.ui.toast('データ読み込み後に共有できます');
    const c = E.conditions(sp, state.now, state.data);
    const cur = c.hasWx ? E.score(sp, fish, c, hookOpts(sp, fish, c)) : null;
    FH.ui.toast('画像を作成中…', 1200);
    const r = await FH.share.shareCard({ spot: sp, fish, score: cur && cur.score, win: state.wins[0], cond: c, scene: $('#scene'), now: state.now });
    if (r === 'downloaded') FH.ui.toast('画像を保存しました（本文はコピー済み）');
  }

  async function share() {
    const sp = spot(), fish = species();
    if (!state.data) return;
    const ser = E.series(sp, fish, state.data, state.now, 72);
    const w = E.windows(ser, { min: 45, limit: 1 })[0];
    const text = `【FishHunter】${sp.name} × ${fish.name}\n現在スコア ${ser[0] && ser[0].score != null ? ser[0].score : '–'}` +
      (w ? `\n次の時合: ${range(w.start, w.end, state.now)}（ピーク ${w.peak}・${w.tags.slice(0, 2).join('・')}）` : '');
    try {
      if (navigator.share) await navigator.share({ title: 'FishHunter 釣行プラン', text, url: location.href.split('#')[0] });
      else { await navigator.clipboard.writeText(text); FH.ui.toast('プランをコピーしました'); }
    } catch (_) { /* user cancelled */ }
  }

  /* ───────────────────────── wiring ───────────────────────── */

  function bind() {
    $('#spotPick').addEventListener('change', (e) => select(e.target.value, null, { focusMap: true }));
    $('#huntTarget').addEventListener('change', (e) => select(null, e.target.value));
    $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { show(b.dataset.tab); g.scrollTo({ top: 0 }); } });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const hs = e.target.closest && e.target.closest('[data-hot-spot]');
      if (hs) { e.preventDefault(); hs.click(); }
    });
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) { show(go.dataset.goto); g.scrollTo({ top: 0 }); return; }
      const card = e.target.closest('.pick-card');
      if (card) { select(card.dataset.spot, card.dataset.sp, { scrollTop: false }); $('.focus').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const bc = e.target.closest('.bs-cell');
      if (bc && chart) { chart.focus(+bc.dataset.ci); return; }
      const hs = e.target.closest('[data-hot-spot]');
      if (hs) { select(hs.dataset.hotSpot, species().id, { scrollTop: false }); $('.focus').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const rsp = e.target.closest('[data-rsp]');
      if (rsp) { select(null, rsp.dataset.rsp); return; }
      const wk = e.target.closest('.wk-row');
      if (wk) { select(wk.dataset.spot, wk.dataset.sp); $('.focus').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const chip = e.target.closest('#spotChips [data-sp]');
      if (chip) { select(null, chip.dataset.sp); return; }
      const li = e.target.closest('.rank li[data-spot]');
      if (li) { select(li.dataset.spot, species().id, { focusMap: true }); return; }
      if (e.target.closest('[data-map-retry]')) { $('#map').innerHTML = '<div class="map-fallback">地図を読み込み中…</div>'; state.dirty.add('map'); render(); return; }
      const cal = e.target.closest('[data-cal]');
      if (cal) {
        const w = state.wins[+cal.dataset.cal];
        const c = E.conditions(spot(), state.now, state.data);
        if (w) { FH.share.downloadIcs(spot(), species(), w, c.hasWx ? E.tactics(spot(), species(), c) : null); FH.ui.toast('カレンダー用ファイルを作成しました（30分前に通知）'); }
        return;
      }
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        const on = FH.prefs.toggleFav(fav.dataset.fav);
        FH.ui.toast(on ? '★ お気に入りに追加しました' : 'お気に入りから外しました');
        fillSpotSelect($('#spotPick'), state.spotId); state.picksKey = null; markAllDirty(); render();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del && confirm('この釣果を削除しますか？')) { FH.catchlog.remove(del.dataset.del); markAllDirty(); render(); }
    });
    $('#chartRange').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-h]'); if (!b) return;
      state.chartH = +b.dataset.h;
      $$('#chartRange button').forEach((x) => x.classList.toggle('on', x === b));
      renderChart(spot(), species(), state.now);
    });
    $('#prefFilter').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pref]'); if (!b) return;
      state.pref = b.dataset.pref;
      $$('#prefFilter button').forEach((x) => x.classList.toggle('on', x === b));
      state.dirty.add('map'); render();
    });
    $('#mapHour').addEventListener('input', (e) => { state.mapHour = +e.target.value; togglePlay(false); paintMapHour(false); });
    $('#mapPlay').addEventListener('click', () => togglePlay());
    $('#btnWind').addEventListener('click', (e) => {
      const on = !FH.map.windOn();
      FH.map.showWind(on);
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.classList.toggle('on', on);
      if (on) paintMapHour(false);
    });
    $('#btnLocate').addEventListener('click', () => {
      if (!navigator.geolocation) return FH.ui.toast('位置情報に対応していません');
      navigator.geolocation.getCurrentPosition((p) => {
        state.userPos = { lat: p.coords.latitude, lon: p.coords.longitude };
        FH.ui.toast('現在地からの距離を表示します');
        state.dirty.add('map'); render();
      }, () => FH.ui.toast('位置情報を取得できませんでした'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    });
    $('#feedTab').addEventListener('click', (e) => { const b = e.target.closest('button[data-f]'); if (!b) return; state.feedTab = b.dataset.f; renderFeed(); });
    const form = $('#logForm');
    form.addEventListener('submit', onLogSubmit);
    form.spot.addEventListener('change', () => {
      form.dataset.touched = '1';
      const sp = FH.spotById[form.spot.value];
      fillSpeciesSelect(form.species, E.speciesFor(sp), form.species.value);
      fillMethods();
    });
    form.species.addEventListener('change', () => { form.dataset.touched = '1'; fillMethods(); });
    $('#analysisSpecies').addEventListener('change', (e) => renderAnalysis(e.target.value || null));
    $('#btnExport').addEventListener('click', () => {
      const blob = new Blob([FH.catchlog.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fishhunter-catchlog-${localInput(Date.now()).slice(0, 10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#importFile').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const n = FH.catchlog.importJSON(await f.text()); FH.ui.toast(`${n}件を読み込みました`); markAllDirty(); render(); }
      catch (err) { FH.ui.toast('読み込み失敗: ' + err.message, 4000); }
      e.target.value = '';
    });
    $('#btnRefresh').addEventListener('click', () => loadData(true));
    $('#btnForce').addEventListener('click', () => loadData(true));
    $('#btnClearCache').addEventListener('click', () => { try { g.localStorage.removeItem(FH.weather.CACHE_KEY); } catch (_) { /* noop */ } FH.ui.toast('気象キャッシュを削除しました'); });
    $('#btnTheme').addEventListener('click', () => {
      const light = document.documentElement.getAttribute('data-theme') !== 'light';
      if (light) document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
      store.set(LS.theme, light ? 'light' : '');
      $('meta[name="theme-color"]').setAttribute('content', light ? '#eef4f8' : '#04111c');
      FH.ui.toast(light ? '日中モード（高コントラスト）' : 'ナイトモード');
      if (chart) chart.redraw();
    });
    $('#btnShare').addEventListener('click', share);
    $('#btnCard').addEventListener('click', shareImage);
    $('#pickScope').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-scope]'); if (!b) return;
      FH.prefs.set({ scope: b.dataset.scope });
      state.picksKey = null; renderPicks();
    });
    $('#btnPrefs').addEventListener('click', () => FH.prefs.onboarding(afterOnboarding));
    $('#btnInstall').addEventListener('click', async () => {
      const r = await FH.prefs.install();
      if (r === 'ios') FH.ui.toast('Safariの共有ボタン →「ホーム画面に追加」', 5000);
      else if (r === 'accepted') FH.ui.toast('ホーム画面に追加しました');
      renderInstall();
    });
    FH.prefs.on(renderInstall);

    FH.diag.on(() => { if (state.view === 'sys') { state.dirty.add('sys'); render(); } else state.dirty.add('sys'); });
    g.addEventListener('online', () => loadData(false));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
    setInterval(() => tick(false), 60e3);
  }

  let lastRender = Date.now();
  function tick(visible) {
    const d = state.data;
    if (d && Date.now() - d.fetchedAt > 30 * 60e3) { loadData(false); return; }
    if (visible || Date.now() - lastRender > 5 * 60e3) {
      lastRender = Date.now();
      state.now = clock();
      stamp(); markAllDirty(); render();
    }
  }

  function renderInstall() {
    const b = $('#btnInstall');
    if (b) b.hidden = !FH.prefs.canInstall();
  }

  /** After onboarding: jump to the best matching spot × species right now. */
  function afterOnboarding(p) {
    state.picksKey = null;
    const pick = () => {
      let best = null;
      if (state.data && FH.prefs.hasPersonal()) best = E.topPicks(state.data, state.now, 12, 1, FH.prefs.matches)[0];
      if (best) select(best.spot.id, best.sp.id, { scrollTop: true });
      else {
        const s = FH.SPOTS.find((x) => (!p.areas.length || p.areas.includes(x.area)) && (!p.species.length || x.species.some((id) => p.species.includes(id))));
        if (s) select(s.id, p.species.find((id) => s.species.includes(id)) || null, { scrollTop: true });
      }
      FH.ui.toast('あなた向けに設定しました。時合を、読め。');
    };
    if (state.data) pick(); else state.afterData = pick;
  }

  function init() {
    if (store.get(LS.theme, '') === 'light') $('meta[name="theme-color"]').setAttribute('content', '#eef4f8');
    fillSpotSelect($('#spotPick'), state.spotId);
    syncSpecies();
    bind();
    g.addEventListener('resize', () => FH.motion.tabIndicator($('#tabbar')));
    if (g.IntersectionObserver) {
      new IntersectionObserver((es) => {
        const show = !es[0].isIntersecting && state.view === 'now';
        $('#miniBar').hidden = !show;
        document.querySelector('.topbar').classList.toggle('compact', show && g.innerWidth <= 720);
      }, { rootMargin: '-120px 0px 0px 0px' }).observe($('#hero'));
    }
    $('#miniBar').addEventListener('click', () => g.scrollTo({ top: 0, behavior: 'smooth' }));
    FH.app.refresh = () => loadData(true);
    g.addEventListener('offline', stamp);
    const view = ['now', 'map', 'hunt', 'log', 'sys'].includes(state.view) ? state.view : 'now';
    show(view);
    setTimeout(() => $('#boot').classList.add('done'), 350);
    loadData(false).then(() => { if (state.afterData) { const f = state.afterData; state.afterData = null; f(); } });
    if (!FH.prefs.get().onboarded) setTimeout(() => FH.prefs.onboarding(afterOnboarding), 900);
    renderInstall();
    FH.feed.load().then(() => { state.picksKey = null; markAllDirty(); render(); });
    if ('serviceWorker' in navigator && /^(https:|http:\/\/localhost|http:\/\/127\.)/.test(location.href)) {
      navigator.serviceWorker.register('sw.js').then(() => FH.diag.report('sw', { label: 'オフラインキャッシュ', state: 'ok', detail: '登録済み' }))
        .catch((e) => FH.diag.report('sw', { label: 'オフラインキャッシュ', state: 'warn', detail: String(e.message || e) }));
    }
    FH.catchlog.on(() => { state.picksKey = null; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  FH.app = { state, select, show, VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : this);
