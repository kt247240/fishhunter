/* FishHunter — 海中ソナー: an animated cross-section under the live scene.
 * Everything drawn comes from data: the seabed shape from the spot's kind of shore (surf / pier / rock / lake /
 * river), the glowing band from the engine's recommended layer (棚), the wave size and speed from the forecast,
 * the water tint from the light phase, and the fish from the evidence level (A: solid fish + school,
 * B: faint fish = area info only, C: no fish = weather and season only). Pure SVG + CSS animation; paused
 * while off-screen; still under prefers-reduced-motion.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Engine layer text → [top, bottom] of the band as a share of the water column. */
  function band(layer) {
    const t = layer || '';
    if (/ボトム中心/.test(t)) return [0.72, 0.96, '底'];
    if (/表層〜中層/.test(t)) return [0.06, 0.5, '表層〜中層'];
    if (/中層〜ボトム/.test(t)) return [0.42, 0.92, '中層〜底'];
    if (/中層/.test(t)) return [0.32, 0.64, '中層'];
    return [0.3, 0.7, '中層'];
  }

  function kindOf(spot) {
    if (spot.water === 'lake') return 'lake';
    if (spot.water === 'river') return 'river';
    return (FH.feed && FH.feed.spotKind && FH.feed.spotKind(spot)) || 'pier';
  }

  // Seabed and structure per kind, in a 400×170 box (water from y=22 down).
  const BED = {
    surf: '<path d="M0 160 C 100 158, 200 152, 280 140 S 370 118, 400 110 V170 H0Z" fill="url(#fhSand)"></path><path d="M0 160 C 100 158, 200 152, 280 140 S 370 118, 400 110" stroke="rgba(255,214,150,.45)" stroke-width="1"></path>',
    pier: '<path d="M0 158 H250 C 290 158, 300 150, 312 150 H400 V170 H0Z" fill="#0a1a28"></path><rect x="330" y="0" width="70" height="150" fill="#0d2233"></rect><rect x="330" y="0" width="70" height="4" fill="#1e3a50"></rect><g fill="#12293b"><path d="M300 150 l14 -22 l16 22z"></path><path d="M312 128 l12 -20 l12 20z"></path><path d="M286 150 l10 -16 l12 16z"></path></g>',
    rock: '<path d="M0 156 C 40 150, 60 158, 100 146 S 170 150, 200 132 S 260 120, 290 96 S 350 70, 400 40 V170 H0Z" fill="#0b1b28"></path><g fill="rgba(60,120,90,.45)"><path d="M120 148 q4 -24 0 -40 q6 18 3 40z"></path><path d="M230 126 q5 -26 -2 -44 q9 20 6 44z"></path></g>',
    mouth: '<path d="M0 154 C 120 150, 220 140, 300 120 S 380 96, 400 90 V170 H0Z" fill="url(#fhSand)"></path>',
    lake: '<path d="M0 150 C 100 158, 200 160, 300 150 S 380 120, 400 110 V170 H0Z" fill="#0c1f1a"></path><g fill="rgba(80,140,90,.5)"><path d="M60 152 q3 -20 0 -34 q5 16 3 34z"></path><path d="M340 124 q4 -22 -1 -36 q7 16 5 36z"></path></g>',
    river: '<path d="M0 140 C 60 150, 140 154, 200 156 S 340 150, 400 138 V170 H0Z" fill="#12202a"></path><g fill="#1c2e3a"><ellipse cx="120" cy="152" rx="14" ry="6"></ellipse><ellipse cx="250" cy="154" rx="18" ry="7"></ellipse></g>'
  };

  function render(el, { spot, fish, cond = {}, layer, ev = 'C' }) {
    if (!el || !spot || !fish) return;
    const kind = kindOf(spot);
    const [b0, b1, bandLabel] = band(layer);
    const top = 22, h = 150 - top; // water column in the 400×170 box
    const y0 = top + b0 * h, y1 = top + b1 * h, ym = (y0 + y1) / 2;
    const phase = cond.light ? cond.light.phase || cond.light.label : '';
    const night = /night|夜/.test(phase);
    const wave = spot.water === 'sea' ? Math.max(0.1, Math.min(3, cond.wave == null ? 0.5 : cond.wave)) : 0.15;
    const amp = (2 + wave * 5).toFixed(1);
    const speed = Math.max(4, 14 - (cond.wind || 2)).toFixed(1);
    const water = night ? ['#061a2c', '#02070d'] : ['#0b3b5c', '#04121d'];
    const fishSvg = (size) => (FH.icons ? FH.icons.fish(fish.id, { size }) : '');
    const fishOp = ev === 'A' ? 1 : ev === 'B' ? 0.42 : 0;
    const surface = `M0 ${top} Q 25 ${top - amp} 50 ${top} T 100 ${top} T 150 ${top} T 200 ${top} T 250 ${top} T 300 ${top} T 350 ${top} T 400 ${top} T 450 ${top} T 500 ${top} T 550 ${top} T 600 ${top} T 650 ${top} T 700 ${top} T 750 ${top} T 800 ${top}`;
    const evText = ev === 'A' ? 'この釣り場の実績あり' : ev === 'B' ? 'エリアの情報（参考）' : '実績なし・天気と季節だけの予想';
    el.dataset.kind = kind;
    el.innerHTML = `
      <svg class="sx-svg" viewBox="0 0 400 170" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fhWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${water[0]}"></stop><stop offset="1" stop-color="${water[1]}"></stop></linearGradient>
          <linearGradient id="fhSand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4c33"></stop><stop offset="1" stop-color="#2a2217"></stop></linearGradient>
          <linearGradient id="fhBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(111,243,255,0)"></stop><stop offset=".5" stop-color="rgba(111,243,255,.16)"></stop><stop offset="1" stop-color="rgba(111,243,255,0)"></stop></linearGradient>
        </defs>
        <rect x="0" y="${top}" width="400" height="${170 - top}" fill="url(#fhWater)"></rect>
        <rect class="sx-band" x="0" y="${y0.toFixed(1)}" width="400" height="${(y1 - y0).toFixed(1)}" fill="url(#fhBand)"></rect>
        <line x1="0" x2="400" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="rgba(111,243,255,.35)" stroke-dasharray="3 5"></line>
        <line x1="0" x2="400" y1="${y1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="rgba(111,243,255,.35)" stroke-dasharray="3 5"></line>
        <g class="sx-rays" opacity="${night ? 0.25 : 0.7}"><path class="sx-ray" d="M70 ${top} l26 0 l-40 150 l-26 0z" fill="rgba(170,235,255,.08)"></path><path class="sx-ray" style="animation-delay:2s" d="M180 ${top} l18 0 l-34 150 l-18 0z" fill="rgba(170,235,255,.06)"></path><path class="sx-ray" style="animation-delay:4s" d="M270 ${top} l30 0 l-44 150 l-30 0z" fill="rgba(170,235,255,.05)"></path></g>
        ${BED[kind] || BED.pier}
        <g class="sx-surface" style="animation-duration:${speed}s"><path d="${surface} V0 H0Z" fill="rgba(3,6,11,.85)"></path><path d="${surface}" stroke="rgba(170,235,255,.7)" stroke-width="1.2" fill="none"></path></g>
      </svg>
      <div class="sx-scale" aria-hidden="true"><span>表層</span><span>中層</span><span>底</span></div>
      ${fishOp ? `
      <div class="sx-fish sx-big" style="top:${((ym / 170) * 100).toFixed(1)}%;opacity:${fishOp}"><div class="sx-sway">${fishSvg(64)}</div></div>
      ${ev === 'A' ? `<div class="sx-fish sx-school" style="top:${(((y0 + 6) / 170) * 100).toFixed(1)}%"><div class="sx-sway">${fishSvg(18)}${fishSvg(14)}${fishSvg(16)}</div></div>` : ''}` : ''}
      <div class="sx-bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="sx-cap"><b>狙う棚 ${esc(bandLabel)}</b><span>${esc(evText)}</span></div>`;
    el.setAttribute('aria-label', `海中の断面図：狙う棚は${bandLabel}。${evText}`);
    if (!el._fhIO && 'IntersectionObserver' in g) {
      el._fhIO = new IntersectionObserver((es) => es.forEach((e) => el.classList.toggle('paused', !e.isIntersecting)));
      el._fhIO.observe(el);
    }
  }

  FH.seascape = { render, band };
})(typeof globalThis !== 'undefined' ? globalThis : this);
