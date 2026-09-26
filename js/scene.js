/* FishHunter — LIVE SCENE.
 * A procedural, data-driven hero: the sky, sun, moon (true phase & position),
 * clouds, rain, fog, lightning, waves and the ANON. angler are all derived
 * from the current conditions of the selected spot. No image assets other
 * than the angler sprite; pauses when off-screen / hidden; honours
 * prefers-reduced-motion with a single still frame.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────────── colour helpers ───────────── */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // Palette keyed by sun altitude (deg).
  const KEYS = [
    { alt: -14, top: '#01060e', mid: '#05152a', hor: '#0b2440', water: '#020b16', haze: '#12304f' },
    { alt: -7, top: '#081733', mid: '#1d3c6b', hor: '#4d5f8f', water: '#07162b', haze: '#3a4e7a' },
    { alt: -1.5, top: '#15264f', mid: '#5b4d7e', hor: '#ff8a4c', water: '#1b2440', haze: '#ff9e6b' },
    { alt: 5, top: '#2c4f8a', mid: '#8a8fb4', hor: '#ffc68a', water: '#1f3d5c', haze: '#ffd2a0' },
    { alt: 18, top: '#2e6fc2', mid: '#6ea8e3', hor: '#cfe6f5', water: '#175a86', haze: '#e3f1fa' },
    { alt: 60, top: '#2466b8', mid: '#5fa3e6', hor: '#d5ebf8', water: '#12608f', haze: '#eef7fc' }
  ];
  function palette(alt, cloud, rain) {
    let i = 0;
    while (i < KEYS.length - 2 && alt > KEYS[i + 1].alt) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = clamp((alt - a.alt) / (b.alt - a.alt));
    const p = {};
    for (const k of ['top', 'mid', 'hor', 'water', 'haze']) p[k] = mix(hex(a[k]), hex(b[k]), t);
    const dark = alt < -6;
    const grey = dark ? [22, 30, 40] : [120, 132, 146];
    const k = clamp((cloud || 0) / 100) * 0.55 + (rain ? 0.2 : 0);
    for (const key of ['top', 'mid', 'hor', 'haze']) p[key] = mix(p[key], grey, k * (key === 'hor' ? 0.8 : 1));
    p.water = mix(p.water, dark ? [6, 12, 20] : [60, 74, 88], k * 0.5);
    p.light = clamp((alt + 10) / 30); // 0 night … 1 day
    return p;
  }

  /* ───────────── deterministic noise ───────────── */
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function ridge(r, n, rough) {
    const pts = []; let y = 0.5;
    for (let i = 0; i <= n; i++) { y = clamp(y + (r() - 0.5) * rough, 0.1, 1); pts.push(y); }
    return pts;
  }

  /* ───────────── sprite loading ───────────── */
  const sprites = {};
  function sprite(name) {
    if (sprites[name]) return sprites[name];
    const img = new Image();
    img.decoding = 'async';
    img.src = 'assets/' + name + '.webp';
    sprites[name] = img;
    return img;
  }
  // Rod tip in sprite pixel space (327 × 720 source).
  const SPRITE = { w: 327, h: 720, tipX: 44.3, tipY: 8.3 };

  /* ───────────── scene ───────────── */
  function create(canvas, overlay) {
    const ctx = canvas.getContext('2d');
    const reduce = g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const S = {
      W: 0, H: 0, dpr: 1, t0: performance.now(), visible: true, raf: 0,
      params: null, pal: palette(-14, 0, false), seed: 7,
      stars: [], clouds: [], drops: [], splash: [], ripples: [], jumps: [],
      fishOnAt: -1e9, flashAt: -1e9, nextFlash: 0, nextJump: 0, pointer: 0, tint: null
    };

    function resize() {
      const r = canvas.getBoundingClientRect();
      S.dpr = Math.min(2, g.devicePixelRatio || 1);
      S.W = Math.max(300, r.width); S.H = Math.max(260, r.height);
      canvas.width = Math.round(S.W * S.dpr); canvas.height = Math.round(S.H * S.dpr);
      buildStatic();
      if (reduce || !S.raf) frame(performance.now());
    }

    function buildStatic() {
      const r = rng(S.seed);
      S.stars = Array.from({ length: 140 }, () => ({ x: r(), y: r() * 0.62, s: r() * 1.3 + 0.3, p: r() * TAU, f: 0.6 + r() * 2 }));
      S.ridges = [ridge(rng(S.seed + 1), 24, 0.35), ridge(rng(S.seed + 2), 18, 0.5), ridge(rng(S.seed + 3), 30, 0.25)];
      S.tetra = Array.from({ length: 7 }, (_, i) => ({ x: 0.02 + i * 0.075 + r() * 0.02, s: 0.8 + r() * 0.5, rot: r() * TAU }));
    }

    function setClouds(cover, wind) {
      const r = rng(S.seed + 9);
      const n = Math.round(clamp(cover / 100) * 14);
      S.clouds = Array.from({ length: n }, () => ({ x: r() * 1.4 - 0.2, y: 0.05 + r() * 0.36, w: 0.18 + r() * 0.35, h: 0.03 + r() * 0.05, v: (0.004 + r() * 0.006) * (0.4 + (wind || 2) / 6), a: 0.35 + r() * 0.4 }));
    }

    /* ───── params → derived scene state ───── */
    function update(p) {
      const first = !S.params;
      S.params = p;
      const c = p.cond || {};
      const date = new Date(p.t || Date.now());
      const sp = p.spot;
      S.seed = [...sp.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
      S.sun = FH.astro.sunPos(date, sp.lat, sp.lon);
      S.moon = FH.astro.moonPos(date, sp.lat, sp.lon);
      S.moonAge = FH.astro.moonAge(date);
      S.rain = (c.precip || 0) >= 0.2 || (c.code >= 51 && c.code <= 82);
      S.snow = c.code >= 71 && c.code <= 86 && !(c.code >= 80 && c.code <= 82);
      S.fog = c.code === 45 || c.code === 48;
      S.storm = c.code >= 95;
      S.pal = palette(S.sun.alt, c.cloud, S.rain);
      S.face = sp.water === 'sea' ? sp.face || 315 : 180;
      S.water = sp.water;
      const wave = sp.water === 'sea' ? (c.wave == null ? 0.5 : c.wave) : sp.water === 'lake' ? clamp((c.wind || 1) / 12, 0.03, 0.8) : 0.25;
      S.amp = clamp(wave, 0.03, 3.5);
      S.wind = c.wind || 0;
      S.flow = c.flow || 0;
      S.danger = p.safety && p.safety.level === 2;
      S.withFish = sp.water !== 'sea' && p.species && p.species.id === 'bass';
      S.tint = null;
      buildStatic(); setClouds(c.cloud || 0, S.wind);
      const n = S.rain || S.snow ? Math.round(clamp((c.precip || 0.5) * 90, 40, 320)) : 0;
      S.drops = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.6 }));
      if (overlay) renderOverlay();
      if (!first && p.score != null && p.score >= 80 && !S.danger) setTimeout(fishOn, 700);
      if (reduce) frame(performance.now());
    }

    function renderOverlay() {
      const p = S.params, c = p.cond || {};
      const phase = c.light ? c.light.label : '';
      const where = { sea: '海', lake: '湖', river: '川' }[p.spot.water];
      const title = (phase === '夜' ? '夜の' : phase === '日中' ? '日中の' : phase + 'の') + where;
      overlay.querySelector('[data-scene-title]').textContent = title;
      overlay.querySelector('[data-scene-sub]').textContent =
        `${FH.ui.hm(p.t || Date.now())} JST ・ ${p.spot.water === 'sea' ? (c.tide ? c.tide.name + ' ・ ' : '') : ''}月齢 ${S.moonAge.toFixed(1)}${S.rain ? ' ・ 雨' : ''}${S.fog ? ' ・ 霧' : ''}${S.storm ? ' ・ 雷' : ''}`;
    }

    /* ───── geometry helpers ───── */
    // On narrow screens the decision card overlays the bottom: stage the scene above it.
    // Measured only when the card resizes: reading offsetHeight every frame forced a full layout
    // per frame whenever the page changed (profiled at ~0.4 s per spot switch on a mid phone).
    let insetH = 0;
    function measureInset() {
      const card = overlay && overlay.querySelector('[data-scene-inset]');
      insetH = card ? card.offsetHeight + 18 : 0;
    }
    function bottomInset() {
      if (!overlay || S.W >= 720) return 0;
      return insetH;
    }
    const horizon = () => Math.min(S.H * (S.water === 'river' ? 0.42 : 0.5), stageTop() * (S.water === 'river' ? 0.66 : 0.72));
    function skyXY(pos) {
      let rel = ((pos.az - S.face + 540) % 360) - 180;
      const x = S.W / 2 + (rel / 60) * (S.W / 2);
      const y = horizon() - (pos.alt / 55) * horizon() * 0.95;
      return { x, y, rel };
    }

    /* ───── drawing ───── */
    function drawSky(t) {
      const P = S.pal, H0 = horizon();
      const gr = ctx.createLinearGradient(0, 0, 0, H0);
      gr.addColorStop(0, rgba(P.top)); gr.addColorStop(0.62, rgba(P.mid)); gr.addColorStop(1, rgba(P.hor));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, S.W, H0 + 2);

      // Stars
      const starA = clamp((-S.sun.alt - 6) / 8) * (1 - clamp(((S.params.cond || {}).cloud || 0) / 90));
      if (starA > 0.02) {
        for (const st of S.stars) {
          const tw = 0.55 + 0.45 * Math.sin(t * st.f + st.p);
          ctx.fillStyle = `rgba(230,240,255,${starA * tw * 0.9})`;
          ctx.fillRect(st.x * S.W, st.y * H0, st.s, st.s);
        }
      }
      // Sun glow
      const sp = skyXY(S.sun);
      if (S.sun.alt > -12) {
        const warm = clamp(1 - Math.abs(S.sun.alt - 1) / 12);
        const R = S.W * (0.35 + warm * 0.4);
        const gg = ctx.createRadialGradient(sp.x, Math.min(sp.y, H0), 0, sp.x, Math.min(sp.y, H0), R);
        gg.addColorStop(0, `rgba(255,${190 - warm * 40},${120 - warm * 60},${0.55 * clamp((S.sun.alt + 12) / 10)})`);
        gg.addColorStop(1, 'rgba(255,160,90,0)');
        ctx.fillStyle = gg; ctx.fillRect(0, 0, S.W, H0);
        if (S.sun.alt > -1 && sp.y < H0) {
          ctx.fillStyle = `rgba(255,${230 - warm * 60},${170 - warm * 90},0.95)`;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 10 + warm * 5, 0, TAU); ctx.fill();
        }
      }
      // Moon with true phase
      const mp = skyXY(S.moon);
      if (S.moon.alt > -2 && mp.y < H0 + 8) {
        const r = Math.max(9, S.W * 0.022);
        const vis = clamp(1 - S.pal.light * 0.75);
        const mg = ctx.createRadialGradient(mp.x, mp.y, r * 0.5, mp.x, mp.y, r * 6);
        const illum = FH.astro.moonIllum(new Date(S.params.t || Date.now()));
        mg.addColorStop(0, `rgba(255,244,210,${0.35 * illum * vis})`); mg.addColorStop(1, 'rgba(255,244,210,0)');
        ctx.fillStyle = mg; ctx.fillRect(mp.x - r * 6, mp.y - r * 6, r * 12, r * 12);
        drawMoon(mp.x, mp.y, r, S.moonAge, vis);
      }
      // Lightning
      if (S.storm && t > S.nextFlash) { S.flashAt = t; S.nextFlash = t + 3 + Math.random() * 6; }
      const fl = t - S.flashAt;
      if (fl < 0.35) { ctx.fillStyle = `rgba(220,230,255,${(fl < 0.08 || (fl > 0.16 && fl < 0.22) ? 0.55 : 0.1)})`; ctx.fillRect(0, 0, S.W, S.H); }
    }

    function drawMoon(x, y, r, age, a) {
      const p = age / 29.530588853;
      const k = Math.cos(TAU * p);
      const waxing = p < 0.5;
      ctx.save(); ctx.globalAlpha = 0.18 * a; ctx.fillStyle = '#cfd8e8';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff1c4';
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
      ctx.ellipse(x, y, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing); // anticlockwise ⇒ terminator bulges right
      ctx.fill(); ctx.restore();
    }

    function drawClouds(t) {
      const H0 = horizon();
      const P = S.pal;
      const base = S.pal.light > 0.4 ? [245, 248, 252] : mix(P.hor, [40, 50, 66], 0.5);
      for (const c of S.clouds) {
        const x = ((((c.x + t * c.v * 0.05) % 1.6) + 1.6) % 1.6 - 0.3) * S.W;
        const y = c.y * H0, w = c.w * S.W, h = c.h * S.H;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
        gr.addColorStop(0, rgba(base, c.a * 0.6)); gr.addColorStop(1, rgba(base, 0));
        ctx.save(); ctx.translate(x, y); ctx.scale(1, h / w * 2.2); ctx.translate(-x, -y);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, w / 2, 0, TAU); ctx.fill(); ctx.restore();
      }
    }

    function drawLand() {
      const H0 = horizon();
      const P = S.pal;
      const layer = (pts, height, col, yOff) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H0 + yOff);
        pts.forEach((v, i) => ctx.lineTo((i / (pts.length - 1)) * S.W, H0 + yOff - v * height));
        ctx.lineTo(S.W, H0 + yOff); ctx.closePath(); ctx.fill();
      };
      const far = rgba(mix(P.hor, P.top, 0.55), 0.9);
      const near = rgba(mix(P.water, [0, 0, 0], 0.3), 1);
      if (S.water === 'sea') {
        // Distant headland on one side (Sado / Noto hint), low and hazy.
        ctx.fillStyle = rgba(mix(P.hor, P.top, 0.5), 0.75);
        ctx.beginPath(); ctx.moveTo(S.W * 0.62, H0);
        S.ridges[2].slice(0, 12).forEach((v, i) => ctx.lineTo(S.W * (0.62 + i * 0.035), H0 - v * S.H * 0.025));
        ctx.lineTo(S.W, H0 - S.H * 0.012); ctx.lineTo(S.W, H0); ctx.closePath(); ctx.fill();
      } else {
        layer(S.ridges[0], S.H * 0.2, far, 0);
        layer(S.ridges[1], S.H * 0.12, rgba(mix(P.hor, P.water, 0.6), 1), 0);
        if (S.water === 'river') layer(S.ridges[2], S.H * 0.07, near, 0);
      }
    }

    function drawWater(t) {
      const P = S.pal, H0 = horizon(), B = S.H;
      const gr = ctx.createLinearGradient(0, H0, 0, B);
      gr.addColorStop(0, rgba(mix(P.hor, P.water, 0.45)));
      gr.addColorStop(0.25, rgba(P.water));
      gr.addColorStop(1, rgba(mix(P.water, [0, 0, 0], 0.45)));
      ctx.fillStyle = gr; ctx.fillRect(0, H0, S.W, B - H0);

      // Mountain reflections on still water (lake)
      if (S.water === 'lake') {
        ctx.save(); ctx.globalAlpha = 0.22 * (1 - clamp(S.amp)); ctx.fillStyle = rgba(mix(P.hor, P.top, 0.55));
        ctx.beginPath(); ctx.moveTo(0, H0);
        S.ridges[0].forEach((v, i) => ctx.lineTo((i / (S.ridges[0].length - 1)) * S.W, H0 + v * S.H * 0.16 + Math.sin(t * 1.3 + i) * 1.5));
        ctx.lineTo(S.W, H0); ctx.closePath(); ctx.fill(); ctx.restore();
      }

      // Celestial glitter path
      const src = S.sun.alt > -3 ? { pos: skyXY(S.sun), c: [255, 200, 140], a: clamp((S.sun.alt + 3) / 6) * (S.sun.alt < 25 ? 1 : 0.45) } :
        S.moon.alt > 0 ? { pos: skyXY(S.moon), c: [255, 240, 200], a: FH.astro.moonIllum(new Date(S.params.t || Date.now())) * 0.8 } : null;

      const rows = 30;
      const ampPx = clamp(S.amp * 7, 0.6, 22);
      const speed = 0.6 + S.wind * 0.08;
      for (let i = 0; i < rows; i++) {
        const d = Math.pow(i / rows, 1.7);
        const y = H0 + 2 + d * (B - H0);
        const A = ampPx * (0.12 + d * 1.1);
        const k = 0.012 / (0.25 + d * 1.2);
        const dir = S.water === 'river' ? 3.2 : 1;
        ctx.beginPath();
        for (let x = -10; x <= S.W + 10; x += 8) {
          const yy = y + Math.sin(x * k + t * speed * dir + i * 1.7) * A + Math.sin(x * k * 2.3 - t * speed * 0.7 + i) * A * 0.35;
          x === -10 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.strokeStyle = rgba(mix(P.hor, [255, 255, 255], 0.25), 0.05 + (1 - d) * 0.14 + P.light * 0.06);
        ctx.lineWidth = 0.6 + d * 1.6; ctx.stroke();
        // Glitter dashes
        if (src && src.a > 0.02) {
          const cx = src.pos.x, spread = 8 + d * S.W * 0.12;
          for (let j = 0; j < 3 + d * 5; j++) {
            const seed = Math.sin(i * 12.9898 + j * 78.233 + Math.floor(t * 6 + i) * 3.1) * 43758.5453;
            const r = seed - Math.floor(seed);
            const x = cx + (r - 0.5) * 2 * spread;
            const w = 3 + d * 18 * r;
            ctx.fillStyle = rgba(src.c, src.a * (0.25 + r * 0.55) * (1 - d * 0.35));
            ctx.fillRect(x - w / 2, y + Math.sin(t * 2 + j) * A * 0.5, w, 1 + d * 1.5);
          }
        }
      }
      // River flow streaks
      if (S.water === 'river') {
        const n = 26, v = 30 + S.flow * 3;
        ctx.strokeStyle = `rgba(230,245,255,${0.08 + clamp(S.flow / 40) * 0.12})`;
        for (let i = 0; i < n; i++) {
          const d = (i % 10) / 10;
          const y = H0 + 10 + Math.pow(d, 1.5) * (B - H0 - 20) + (i * 7) % 11;
          const x = ((i * 97 + t * v * (0.4 + d)) % (S.W + 120)) - 60;
          ctx.lineWidth = 1 + d; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20 + d * 50, y); ctx.stroke();
        }
      }
      // Horizon haze
      const hz = ctx.createLinearGradient(0, H0 - 14, 0, H0 + 22);
      hz.addColorStop(0, rgba(P.haze, 0)); hz.addColorStop(0.5, rgba(P.haze, 0.22)); hz.addColorStop(1, rgba(P.haze, 0));
      ctx.fillStyle = hz; ctx.fillRect(0, H0 - 14, S.W, 36);
    }

    function stageTop() {
      const inset = bottomInset();
      return inset ? S.H - inset + 4 : S.H * (S.water === 'river' ? 0.86 : 0.83);
    }

    function drawStage(t) {
      const P = S.pal, top = stageTop(), B = S.H;
      const night = P.light < 0.35;
      const base = mix(P.water, [70, 76, 84], 0.35 + P.light * 0.25);
      if (S.water === 'sea') {
        // Tetrapods (left) — silhouettes
        ctx.fillStyle = rgba(mix(base, [0, 0, 0], 0.45));
        for (const tp of S.tetra) {
          const x = tp.x * S.W, y = top + S.H * 0.06, r = S.H * 0.05 * tp.s;
          ctx.save(); ctx.translate(x, y); ctx.rotate(tp.rot);
          for (let k = 0; k < 3; k++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 0.28, r * 0.62, 0, 0, TAU); ctx.fill(); }
          ctx.restore();
        }
        // Breakwater slab
        const x0 = S.W * 0.4;
        ctx.fillStyle = rgba(mix(base, [255, 255, 255], 0.06));
        ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(S.W, top - S.H * 0.015); ctx.lineTo(S.W, B); ctx.lineTo(x0 - S.W * 0.04, B); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba(mix(base, [0, 0, 0], 0.35));
        ctx.beginPath(); ctx.moveTo(x0, top + 4); ctx.lineTo(x0 - S.W * 0.04, B); ctx.lineTo(x0 - S.W * 0.01, B); ctx.lineTo(x0 + 3, top + 4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(mix(P.hor, [255, 255, 255], 0.3), 0.35); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(S.W, top - S.H * 0.015); ctx.stroke();
        // 常夜灯 (harbour lamp)
        const lx = S.W * 0.93, ly = top - S.H * 0.28;
        ctx.strokeStyle = rgba(mix(base, [0, 0, 0], 0.5)); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(lx, top - S.H * 0.012); ctx.lineTo(lx, ly); ctx.lineTo(lx - 14, ly); ctx.stroke();
        if (night) {
          const flick = 0.92 + Math.sin(t * 13) * 0.03;
          const lg = ctx.createRadialGradient(lx - 14, ly + 4, 0, lx - 14, ly + 4, S.H * 0.42);
          lg.addColorStop(0, `rgba(255,236,190,${0.55 * flick})`); lg.addColorStop(0.2, 'rgba(255,220,160,.16)'); lg.addColorStop(1, 'rgba(255,220,160,0)');
          ctx.fillStyle = lg; ctx.fillRect(0, 0, S.W, S.H);
          ctx.fillStyle = '#fff4d6'; ctx.beginPath(); ctx.arc(lx - 14, ly + 4, 3.2, 0, TAU); ctx.fill();
        }
      } else if (S.water === 'lake') {
        const x0 = S.W * 0.46;
        ctx.fillStyle = rgba(mix(base, [60, 40, 20], 0.35));
        ctx.fillRect(x0, top, S.W - x0, S.H * 0.03);
        for (let x = x0 + 10; x < S.W; x += 46) ctx.fillRect(x, top, 5, B - top);
        ctx.strokeStyle = rgba(mix(P.hor, [255, 255, 255], 0.3), 0.3); ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(S.W, top); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(mix(base, [0, 0, 0], 0.3));
        ctx.beginPath(); ctx.moveTo(S.W * 0.42, B); ctx.quadraticCurveTo(S.W * 0.5, top - 6, S.W * 0.7, top); ctx.lineTo(S.W, top - 12); ctx.lineTo(S.W, B); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba(mix(base, [0, 0, 0], 0.5));
        [[0.08, 0.93, 0.07], [0.2, 0.97, 0.05], [0.33, 0.95, 0.04]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.ellipse(x * S.W, y * S.H, r * S.W, r * S.W * 0.45, 0, 0, TAU); ctx.fill(); });
      }
    }

    function anglerRect() {
      const h = Math.min(S.H * 0.52, stageTop() * 0.56, 340);
      const w = h * (SPRITE.w / SPRITE.h);
      const x = S.W * (S.water === 'sea' ? 0.64 : 0.66) - w / 2 + S.pointer * 6;
      const y = stageTop() - h + h * 0.035;
      return { x, y, w, h, tipX: x + (SPRITE.tipX / SPRITE.w) * w, tipY: y + (SPRITE.tipY / SPRITE.h) * h };
    }

    function tintedSprite(img, w, h) {
      const key = S.pal.light.toFixed(2) + (S.withFish ? 'f' : '') + Math.round(w);
      if (S.tint && S.tint.key === key) return S.tint.cv;
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * S.dpr); cv.height = Math.round(h * S.dpr);
      const c2 = cv.getContext('2d');
      c2.drawImage(img, 0, 0, cv.width, cv.height);
      // Grade the daylight-painted figure into the scene light.
      c2.globalCompositeOperation = 'source-atop';
      const P = S.pal;
      const night = 1 - P.light;
      c2.fillStyle = rgba(mix(P.water, [4, 10, 24], 0.4), 0.5 * night);
      c2.fillRect(0, 0, cv.width, cv.height);
      if (S.sun.alt > -6 && S.sun.alt < 8) { c2.fillStyle = 'rgba(255,150,80,0.16)'; c2.fillRect(0, 0, cv.width, cv.height); }
      // Rim light from the key light side
      const rim = c2.createLinearGradient(0, 0, cv.width, 0);
      const keyCol = S.sun.alt > -4 ? '255,210,160' : '190,215,255';
      rim.addColorStop(0, `rgba(${keyCol},${0.22 * (0.4 + night)})`); rim.addColorStop(0.25, `rgba(${keyCol},0)`);
      c2.fillStyle = rim; c2.fillRect(0, 0, cv.width, cv.height);
      S.tint = { key, cv };
      return cv;
    }

    function drawAngler(t) {
      if (S.danger) return;
      const img = sprite(S.withFish ? 'angler-fish' : 'angler');
      if (!img.complete || !img.naturalWidth) return;
      const R = anglerRect();
      const since = t - S.fishOnAt;
      const fighting = since < 2.6;
      const shake = fighting ? Math.sin(t * 60) * 2.2 * (1 - since / 2.6) : 0;
      const breathe = 1 + Math.sin(t * 1.6) * 0.004;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(R.x + R.w * 0.62, stageTop() + 2, R.w * 0.42, R.h * 0.018, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(R.x + R.w / 2 + shake, R.y + R.h);
      ctx.scale(1, breathe);
      ctx.drawImage(tintedSprite(img, R.w, R.h), -R.w / 2, -R.h, R.w, R.h);
      ctx.restore();

      if (S.withFish) return;
      // Fishing line from rod tip to the water
      const H0 = horizon();
      const ex = R.x - R.w * 1.1, ey = H0 + (stageTop() - H0) * 0.42;
      const bob = Math.sin(t * 1.8) * clamp(S.amp * 3, 0.5, 5);
      const sag = fighting ? -6 : 18 + S.wind * 1.5;
      ctx.strokeStyle = S.pal.light > 0.5 ? 'rgba(40,50,60,.55)' : 'rgba(220,235,255,.5)';
      ctx.lineWidth = fighting ? 1.2 : 0.8;
      ctx.beginPath(); ctx.moveTo(R.tipX + shake, R.tipY);
      ctx.quadraticCurveTo((R.tipX + ex) / 2, (R.tipY + ey) / 2 + sag, ex + (fighting ? Math.sin(t * 40) * 3 : 0), ey + bob);
      ctx.stroke();
      S.entry = { x: ex, y: ey + bob };
      // Night: glowing electric float (電気ウキ)
      if (S.pal.light < 0.35 && !fighting) {
        const gl = ctx.createRadialGradient(ex, ey + bob, 0, ex, ey + bob, 14);
        gl.addColorStop(0, 'rgba(255,90,110,.9)'); gl.addColorStop(1, 'rgba(255,90,110,0)');
        ctx.fillStyle = gl; ctx.fillRect(ex - 14, ey + bob - 14, 28, 28);
      }
    }

    function drawFx(t, dt) {
      // Ambient jumps (ボイル): frequency follows the bite score.
      const sc = (S.params && S.params.score) || 0;
      if (!S.danger && t > S.nextJump) {
        S.nextJump = t + 2 + Math.random() * (9 - sc / 14);
        if (Math.random() < sc / 100) {
          const H0 = horizon();
          S.jumps.push({ x: S.W * (0.05 + Math.random() * 0.45), y: H0 + (stageTop() - H0) * (0.15 + Math.random() * 0.5), t0: t, s: 0.6 + Math.random() * 0.8 });
        }
      }
      S.jumps = S.jumps.filter((j) => t - j.t0 < 1.6);
      for (const j of S.jumps) {
        const k = (t - j.t0) / 0.7;
        const d = 1 + (j.y - horizon()) / S.H * 4;
        if (k <= 1) {
          const x = j.x + k * 26 * j.s * d, y = j.y - Math.sin(k * Math.PI) * 22 * j.s * d;
          ctx.save(); ctx.translate(x, y); ctx.rotate((k - 0.5) * 1.6);
          ctx.fillStyle = S.pal.light > 0.4 ? 'rgba(200,220,235,.85)' : 'rgba(170,200,230,.7)';
          ctx.beginPath(); ctx.ellipse(0, 0, 7 * j.s * d, 2.4 * j.s * d, 0, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-6 * j.s * d, 0); ctx.lineTo(-11 * j.s * d, -3 * j.s * d); ctx.lineTo(-11 * j.s * d, 3 * j.s * d); ctx.fill();
          ctx.restore();
        }
        ringAt(j.x, j.y, t - j.t0, d);
        ringAt(j.x + 26 * j.s * d, j.y, t - j.t0 - 0.7, d);
      }
      // FISH ON splash & ripples
      for (const s of S.splash) { s.vy += 420 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
      S.splash = S.splash.filter((s) => s.life > 0);
      ctx.fillStyle = 'rgba(235,248,255,.9)';
      for (const s of S.splash) { ctx.globalAlpha = clamp(s.life * 1.6); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      const since = t - S.fishOnAt;
      if (since < 2.6 && S.entry) { ringAt(S.entry.x, S.entry.y, since, 1.4); ringAt(S.entry.x, S.entry.y, since - 0.35, 1.4); }
      // Rain / snow
      if (S.drops.length) {
        const slant = clamp(S.wind / 12, 0, 1) * 0.35;
        ctx.strokeStyle = S.snow ? 'rgba(255,255,255,.8)' : 'rgba(200,220,240,.35)';
        ctx.lineWidth = S.snow ? 2 : 1;
        for (const d of S.drops) {
          d.y += dt * d.v * (S.snow ? 0.12 : 1.1); d.x += dt * slant * (S.snow ? 0.2 : 1);
          if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
          if (d.x > 1) d.x -= 1;
          const x = d.x * S.W, y = d.y * S.H;
          ctx.beginPath(); ctx.moveTo(x, y); S.snow ? ctx.lineTo(x + 0.5, y + 0.5) : ctx.lineTo(x - slant * 14, y + 14); ctx.stroke();
        }
      }
      if (S.fog) { ctx.fillStyle = rgba(S.pal.haze, 0.35); ctx.fillRect(0, 0, S.W, S.H); }
    }

    function ringAt(x, y, age, d) {
      if (age < 0 || age > 1.6) return;
      const r = age * 30 * d;
      ctx.strokeStyle = `rgba(230,245,255,${0.5 * (1 - age / 1.6)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.28, 0, 0, TAU); ctx.stroke();
    }

    function fishOn() {
      if (S.danger || !S.params) return;
      const t = (performance.now() - S.t0) / 1000;
      S.fishOnAt = t;
      const e = S.entry || { x: S.W * 0.3, y: horizon() + 60 };
      for (let i = 0; i < 38; i++) S.splash.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 160, vy: -120 - Math.random() * 220, r: 1 + Math.random() * 2.2, life: 0.7 + Math.random() * 0.6 });
      if (overlay) {
        const el = overlay.querySelector('[data-fishon]');
        if (el) { el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
      }
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) try { navigator.vibrate([25, 40, 60]); } catch (_) { /* unsupported */ }
      if (reduce) frame(performance.now());
    }

    /* ───── loop ───── */
    let last = performance.now();
    // Background scene: 30 fps is visually enough and halves paint/commit work on phones.
    // Direct calls (resize, reduced motion, paused loop) always draw.
    let lastDraw = -1e9;
    function frame(now) {
      if (S.raf && now - lastDraw < 31) { S.raf = requestAnimationFrame(frame); return; }
      lastDraw = now;
      const t = (now - S.t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!S.params) { S.raf = reduce ? 0 : requestAnimationFrame(frame); return; }
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      const shake = t - S.fishOnAt < 0.5 ? (Math.random() - 0.5) * 4 * (1 - (t - S.fishOnAt) / 0.5) : 0;
      ctx.translate(shake, shake * 0.5);
      drawSky(t); drawClouds(t); drawLand(); drawWater(t); drawStage(t); drawAngler(t); drawFx(t, dt);
      // Vignette
      const vg = ctx.createRadialGradient(S.W / 2, S.H * 0.45, S.H * 0.3, S.W / 2, S.H * 0.5, S.H * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = vg; ctx.fillRect(-10, -10, S.W + 20, S.H + 20);
      S.raf = reduce || !S.visible ? 0 : requestAnimationFrame(frame);
    }

    function setVisible(v) {
      if (v === S.visible) return;
      S.visible = v;
      if (v && !reduce && !S.raf) { last = performance.now(); S.raf = requestAnimationFrame(frame); }
    }

    // Wiring
    if (g.ResizeObserver) {
      new ResizeObserver(resize).observe(canvas);
      const card = overlay && overlay.querySelector('[data-scene-inset]');
      if (card) new ResizeObserver(() => { measureInset(); if (reduce || !S.raf) frame(performance.now()); }).observe(card);
    } else g.addEventListener('resize', () => { measureInset(); resize(); });
    measureInset();
    if (g.IntersectionObserver) new IntersectionObserver((es) => setVisible(es[0].isIntersecting && !document.hidden), { threshold: 0.02 }).observe(canvas);
    document.addEventListener('visibilitychange', () => setVisible(!document.hidden));
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); S.pointer = ((e.clientX - r.left) / r.width - 0.5) * 2; });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect(), A = anglerRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x > A.x - 30 && x < A.x + A.w + 10 && y > A.y && y < A.y + A.h) fishOn();
    });
    ['angler', 'angler-fish'].forEach((n) => { sprite(n).onload = () => { S.tint = null; if (reduce) frame(performance.now()); }; });
    resize();
    if (!reduce) S.raf = requestAnimationFrame(frame);

    return { update, fishOn };
  }

  FH.scene = { create, palette };
})(typeof globalThis !== 'undefined' ? globalThis : this);
