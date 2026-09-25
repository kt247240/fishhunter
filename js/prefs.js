/* FishHunter — personal preferences, favourites, install prompt and the
 * first-run onboarding sheet. */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const KEY = 'fh.prefs.v1';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let prefs = null;
  const listeners = new Set();

  function load() {
    if (prefs) return prefs;
    try { prefs = JSON.parse(g.localStorage.getItem(KEY)) || null; } catch (_) { prefs = null; }
    prefs = Object.assign({ areas: [], species: [], favorites: [], onboarded: false, scope: 'mine' }, prefs || {});
    return prefs;
  }
  function save() {
    try { g.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ }
    listeners.forEach((fn) => { try { fn(prefs); } catch (_) { /* isolate */ } });
  }
  const get = () => load();
  function set(patch) { load(); Object.assign(prefs, patch); save(); }
  const isFav = (id) => load().favorites.includes(id);
  function toggleFav(id) {
    load();
    prefs.favorites = isFav(id) ? prefs.favorites.filter((x) => x !== id) : [...prefs.favorites, id];
    save();
    return isFav(id);
  }
  const hasPersonal = () => { const p = load(); return p.areas.length > 0 || p.species.length > 0 || p.favorites.length > 0; };

  /** Does this spot × species match the user's areas / species / favourites? */
  function matches(spot, sp) {
    const p = load();
    if (p.favorites.includes(spot.id)) return !p.species.length || p.species.includes(sp.id);
    const areaOk = !p.areas.length || p.areas.includes(spot.area);
    const spOk = !p.species.length || p.species.includes(sp.id);
    return areaOk && spOk;
  }

  /* ───────── install prompt ───────── */
  let deferred = null;
  g.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((fn) => fn(load())); });
  const isIOS = () => /iphone|ipad|ipod/i.test((g.navigator || {}).userAgent || '');
  const standalone = () => !!((g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) || (g.navigator && g.navigator.standalone));
  const canInstall = () => !standalone() && (!!deferred || isIOS());
  async function install() {
    if (deferred) {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => null);
      deferred = null;
      return r && r.outcome === 'accepted' ? 'accepted' : 'dismissed';
    }
    if (isIOS()) return 'ios';
    return 'unavailable';
  }

  /* ───────── onboarding ───────── */
  const GROUPS = [['新潟', ['上越', '中越', '下越', '佐渡']], ['長野', ['北信', '中信', '東信', '南信']]];

  function onboarding(onDone) {
    const p = load();
    const sel = { areas: new Set(p.areas), species: new Set(p.species) };
    const el = document.createElement('div');
    el.className = 'sheet-backdrop';
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="obTitle">
      <div class="ob-steps"><i class="on"></i><i></i><i></i></div>
      <div class="ob-body"></div>
      <div class="ob-actions"><button class="btn" data-ob="skip" type="button">スキップ</button><button class="btn primary" data-ob="next" type="button">次へ</button></div>
    </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    let step = 0;

    function availableSpecies() {
      const spots = FH.SPOTS.filter((s) => !sel.areas.size || sel.areas.has(s.area));
      const ids = new Set(spots.flatMap((s) => s.species));
      return FH.SPECIES.filter((s) => ids.has(s.id));
    }

    function paint() {
      const body = el.querySelector('.ob-body');
      el.querySelectorAll('.ob-steps i').forEach((d, i) => d.classList.toggle('on', i <= step));
      if (step === 0) {
        body.innerHTML = `<div class="eyebrow">WELCOME TO ANON.</div><h2 id="obTitle">よく行くエリアは？</h2>
          <p class="muted">選んだエリアを優先して「今行くならここ」を出します（複数選択可）。</p>
          ${GROUPS.map(([pref, areas]) => `<h4>${pref}</h4><div class="ob-chips">${areas.map((a) =>
            `<button type="button" class="ob-chip${sel.areas.has(a) ? ' on' : ''}" data-area="${a}">${a}<small>${FH.SPOTS.filter((s) => s.area === a).length}か所</small></button>`).join('')}</div>`).join('')}`;
      } else if (step === 1) {
        const list = availableSpecies();
        body.innerHTML = `<div class="eyebrow">TARGET</div><h2 id="obTitle">狙いたい魚は？</h2>
          <p class="muted">選ばなければ全魚種から提案します。</p>
          <div class="ob-chips">${list.map((s) => `<button type="button" class="ob-chip dot${sel.species.has(s.id) ? ' on' : ''}" style="--c:${s.color}" data-sp="${s.id}">${esc(s.name)}</button>`).join('')}</div>`;
      } else {
        const inst = canInstall();
        body.innerHTML = `<div class="eyebrow">READY</div><h2 id="obTitle">準備完了。時合を、読め。</h2>
          <ul class="ob-list">
            <li><b>スコア</b>は条件の一致度（0〜99）。釣れる確率ではありません。</li>
            <li><b>時合</b>はカレンダーに追加すると30分前に通知されます。</li>
            <li><b>釣果を記録</b>すると、あなたの勝ちパターンを学習します。</li>
            <li>高波・雷・増水の日は<b>撤収</b>を表示します。安全第一で。</li>
          </ul>
          ${inst ? `<button class="btn block" data-ob="install" type="button">📲 ホーム画面に追加</button>
            <p class="muted small" data-ios-hint hidden>iPhone：Safariの共有ボタン → 「ホーム画面に追加」</p>` : ''}`;
        el.querySelector('[data-ob="next"]').textContent = 'はじめる';
      }
    }

    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-area]');
      if (a) { sel.areas.has(a.dataset.area) ? sel.areas.delete(a.dataset.area) : sel.areas.add(a.dataset.area); a.classList.toggle('on'); return; }
      const s = e.target.closest('[data-sp]');
      if (s) { sel.species.has(s.dataset.sp) ? sel.species.delete(s.dataset.sp) : sel.species.add(s.dataset.sp); s.classList.toggle('on'); return; }
      const b = e.target.closest('[data-ob]');
      if (!b) return;
      if (b.dataset.ob === 'install') {
        const r = await install();
        if (r === 'ios') el.querySelector('[data-ios-hint]').hidden = false;
        return;
      }
      if (b.dataset.ob === 'next' && step < 2) { step++; paint(); return; }
      // skip or finish
      set({ areas: [...sel.areas], species: [...sel.species], onboarded: true });
      el.classList.remove('open');
      setTimeout(() => el.remove(), 350);
      if (onDone) onDone(get());
    });
    paint();
  }

  FH.prefs = { get, set, isFav, toggleFav, matches, hasPersonal, canInstall, install, isIOS, standalone, onboarding, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
