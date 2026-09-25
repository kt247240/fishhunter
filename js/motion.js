/* FishHunter — motion system: count-ups, staggered reveals, view
 * transitions, tab indicator. Everything degrades to instant when the user
 * prefers reduced motion. */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const reduce = () => !!(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

  /** Animate every [data-count] number inside root from its previous value. */
  function countUp(root) {
    (root || document).querySelectorAll('[data-count]').forEach((el) => {
      const to = parseFloat(el.dataset.count);
      if (!isFinite(to)) return;
      const from = parseFloat(el.dataset.from || '0');
      el.dataset.from = String(to);
      if (reduce() || from === to) { el.textContent = Math.round(to); return; }
      const t0 = performance.now(), dur = 900 + Math.min(600, Math.abs(to - from) * 8);
      const step = (now) => {
        const k = ease((now - t0) / dur);
        el.textContent = Math.round(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Give list children an index so CSS can stagger their entrance. */
  function stagger(root, sel) {
    (root || document).querySelectorAll(sel || '[data-stagger] > *').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
  }

  function transition(fn) {
    if (!reduce() && document.startViewTransition) return document.startViewTransition(fn);
    fn();
    return null;
  }

  function tabIndicator(bar) {
    let pill = bar.querySelector('.tab-pill');
    if (!pill) { pill = document.createElement('i'); pill.className = 'tab-pill'; bar.prepend(pill); }
    const on = bar.querySelector('button.on');
    if (!on) return;
    pill.style.width = on.offsetWidth - 16 + 'px';
    pill.style.transform = `translateX(${on.offsetLeft + 8}px)`;
  }

  FH.motion = { countUp, stagger, transition, tabIndicator, reduce };
})(typeof globalThis !== 'undefined' ? globalThis : this);
