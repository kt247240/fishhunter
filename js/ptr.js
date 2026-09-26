/* FishHunter — pull-to-refresh (touch only, at the top of the page).
 * A fishing line stretches as you pull; release past the threshold to reload
 * weather + catch intel. Ignored on the map, chart and scene (they own drags). */
(function (g) {
  'use strict';
  const el = document.getElementById('ptr');
  if (!el || !('ontouchstart' in g)) return;
  const TH = 80;
  let y0 = null, dy = 0, busy = false;
  const skip = (t) => t.closest && t.closest('#map, #chart, #scene, .sheet, input, select, textarea, .bs-cells');
  g.addEventListener('touchstart', (e) => {
    if (busy || g.scrollY > 0 || e.touches.length !== 1 || skip(e.target)) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  g.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (!dy) return;
    const k = Math.min(1, dy / TH);
    el.style.setProperty('--pull', Math.min(dy, TH * 1.4) + 'px');
    el.style.setProperty('--k', k.toFixed(2));
    el.classList.add('on');
    el.classList.toggle('ready', dy >= TH);
    el.querySelector('span').textContent = dy >= TH ? '離して更新' : '引っぱって更新';
  }, { passive: true });
  g.addEventListener('touchend', async () => {
    if (y0 == null) return;
    const go = dy >= TH;
    y0 = null;
    if (!go) { el.classList.remove('on', 'ready'); return; }
    busy = true;
    el.classList.add('loading');
    el.querySelector('span').textContent = '更新中…';
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (_) { /* unsupported */ } }
    try { if (g.FH && FH.app && FH.app.refresh) await FH.app.refresh(); } finally {
      busy = false;
      el.classList.remove('on', 'ready', 'loading');
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
