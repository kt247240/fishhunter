/* FishHunter — UI primitives: formatting, score rings, icons, sparkline,
 * and the interactive 72h forecast chart (canvas, no dependencies).
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const HOUR = 3600e3;
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  function jp(t) { return FH.astro.jstParts(new Date(t)); }
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { if (t == null) return '—'; const p = jp(+t); return p.h + ':' + pad(p.min); };
  const md = (t) => { const p = jp(+t); return `${p.m}/${p.d}(${DOW[p.dow]})`; };
  function dayLabel(t, now = Date.now()) {
    const d0 = FH.astro.jstMidnight(new Date(now)).getTime();
    const diff = Math.floor((FH.astro.jstMidnight(new Date(+t)).getTime() - d0) / 86400e3);
    return diff === 0 ? '今日' : diff === 1 ? '明日' : diff === 2 ? '明後日' : diff === -1 ? '昨日' : md(t);
  }
  const range = (a, b, now) => `${dayLabel(a, now)} ${hm(a)}〜${hm(b)}`;
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60e3);
    if (m < 1) return 'たった今';
    if (m < 60) return m + '分前';
    if (m < 1440) return Math.round(m / 60) + '時間前';
    return Math.round(m / 1440) + '日前';
  }
  const f1 = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));

  function tone(score) { return score == null ? 'bad' : FH.engine.verdict(score).tone; }

  function ring(score, size = 96, label) {
    const r = 42, c = 2 * Math.PI * r;
    const v = score == null ? 0 : Math.max(0, Math.min(99, score));
    const t = tone(score);
    const lab = label || (score == null ? 'NO DATA' : FH.engine.verdict(score).label);
    return `<div class="ring tone-${t}" style="--size:${size}px;--c:${c.toFixed(1)}" role="img" aria-label="スコア ${score == null ? 'なし' : v}（${esc(lab)}）">
      <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke-width="8"/>
      <circle class="val" cx="50" cy="50" r="${r}" fill="none" stroke-width="8" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(1)}"/></svg>
      <div class="lbl"><b${score == null ? '' : ` data-count="${v}"`}>${score == null ? '–' : v}</b><small>${esc(lab)}</small></div></div>`;
  }

  function moonIcon(age) {
    const p = age / 29.530588853; // 0 new → .5 full
    const k = Math.cos(2 * Math.PI * p); // 1 new, -1 full
    const rx = Math.abs(k) * 14;
    const waxing = p < 0.5;
    // Lit limb on the right while waxing (northern hemisphere).
    const sweepOuter = waxing ? 1 : 0;
    const sweepInner = (k > 0) === waxing ? 0 : 1;
    const d = `M16 2 A14 14 0 0 ${sweepOuter} 16 30 A${rx.toFixed(2)} 14 0 0 ${sweepInner} 16 2 Z`;
    return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="currentColor" opacity=".14"/><path d="${d}" fill="#ffe9a8"/><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-opacity=".3"/></svg>`;
  }
  const sunIcon = (up) => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 22h24" stroke="currentColor" stroke-opacity=".4" stroke-width="1.5"/><circle cx="16" cy="${up ? 18 : 22}" r="6" fill="#ffb347"/><path d="M16 ${up ? 6 : 12}v${up ? -3 : 3}" stroke="#ffb347" stroke-width="2" stroke-linecap="round" transform="translate(0 ${up ? 3 : 0})"/></svg>`;
  const tideIcon = () => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 13c3-3 6-3 9 0s6 3 9 0 6-3 8 0M3 20c3-3 6-3 9 0s6 3 9 0 6-3 8 0" fill="none" stroke="#5de4ff" stroke-width="2" stroke-linecap="round"/></svg>`;
  const clockIcon = () => `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="#c8a0ff" stroke-width="2"/><path d="M16 9v7l5 3" fill="none" stroke="#c8a0ff" stroke-width="2" stroke-linecap="round"/></svg>`;
  const arrow = (deg) => (deg == null ? '' : `<span class="arrow" style="transform:rotate(${deg + 180}deg)" aria-hidden="true">↑</span>`);

  function sparkline(values, w = 84, h = 22) {
    const v = values.map((x) => (x == null ? 0 : x));
    if (!v.length) return '';
    const max = 100, n = v.length - 1 || 1;
    const pts = v.map((x, i) => [(i / n) * w, h - 2 - (x / max) * (h - 4)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const peak = Math.max(...v);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h} Z" fill="var(--tone)" opacity=".15"/><path d="${d}" fill="none" stroke="var(--tone)" stroke-width="1.6" stroke-linejoin="round"/><title>ピーク ${peak}</title></svg>`;
  }

  let toastTimer = null;
  function toast(msg, ms = 4000) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /* ───────────────────────── chart ───────────────────────── */

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function createChart(canvas, tip) {
    const state = { series: [], water: 'sea', now: Date.now(), hover: null, prog: 1, anim: 0 };

    function geometry() {
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(280, rect.width), H = Math.max(160, rect.height);
      const pad = { l: 30, r: 34, t: 14, b: 34 };
      return { W, H, pad, pw: W - pad.l - pad.r, ph: H - pad.t - pad.b };
    }

    // Geometry and theme colours are measured once per update/resize, not per animation frame
    // (each read forced layout/style recalculation ~60×/s during the draw-in animation).
    let measured = null;
    function measure() {
      const dpr = Math.min(3, g.devicePixelRatio || 1);
      const G = geometry();
      const C = {
        text: cssVar('--muted'), faint: cssVar('--faint'), line: cssVar('--line'), accent: cssVar('--accent'),
        accent2: cssVar('--accent-2'), hot: cssVar('--hot'), night: cssVar('--night'), danger: cssVar('--danger')
      };
      const w = Math.round(G.W * dpr), h = Math.round(G.H * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      measured = { dpr, G, C };
    }

    function draw(fresh = true) {
      const ser = state.series;
      if (fresh || !measured) measure();
      const { dpr, G, C } = measured;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, G.W, G.H);
      if (!ser.length) return;
      const t0 = ser[0].t, t1 = ser[ser.length - 1].t + HOUR;
      const X = (t) => G.pad.l + ((t - t0) / (t1 - t0)) * G.pw;
      const Y = (s) => G.pad.t + (1 - s / 100) * G.ph;
      const bw = G.pw / ser.length;

      // Light-phase bands + solunar strip + danger strip
      ser.forEach((p) => {
        const x = X(p.t);
        const ph = p.cond.light.phase;
        if (ph === 'night') { ctx.fillStyle = C.night; ctx.fillRect(x, G.pad.t, bw + .5, G.ph); }
        if (ph === 'mazume') { ctx.fillStyle = 'rgba(255,190,90,.16)'; ctx.fillRect(x, G.pad.t, bw + .5, G.ph); }
        const sv = p.cond.solunar.value;
        if (sv > 0.6) { ctx.fillStyle = sv >= 0.85 ? 'rgba(200,160,255,.55)' : 'rgba(200,160,255,.28)'; ctx.fillRect(x, G.pad.t - 6, bw + .5, 4); }
        if (p.safety && p.safety.level === 2) { ctx.fillStyle = C.danger; ctx.globalAlpha = .7; ctx.fillRect(x, G.pad.t + G.ph - 3, bw + .5, 3); ctx.globalAlpha = 1; }
      });

      // Grid
      ctx.font = '10px ' + cssVar('--mono');
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      [20, 40, 60, 80].forEach((v) => {
        ctx.strokeStyle = C.line; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(G.pad.l, Y(v)); ctx.lineTo(G.pad.l + G.pw, Y(v)); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = C.faint; ctx.fillText(v, G.pad.l - 6, Y(v));
      });

      // Secondary: wave height (sea) or precipitation (inland) bars
      const envVals = ser.map((p) => (state.water === 'sea' ? p.cond.wave : p.cond.precip));
      const envMax = Math.max(state.water === 'sea' ? 2 : 4, ...envVals.filter((v) => v != null));
      const envH = G.ph * 0.32;
      ctx.fillStyle = state.water === 'sea' ? 'rgba(143,183,255,.38)' : 'rgba(120,170,255,.55)';
      ser.forEach((p, i) => {
        const v = envVals[i]; if (v == null || v <= 0) return;
        const h = (v / envMax) * envH;
        ctx.fillRect(X(p.t) + bw * 0.18, G.pad.t + G.ph - h, bw * 0.64, h);
      });
      ctx.textAlign = 'left'; ctx.fillStyle = C.faint;
      ctx.fillText(f1(envMax, state.water === 'sea' ? 1 : 0) + (state.water === 'sea' ? 'm' : 'mm'), G.pad.l + G.pw + 4, G.pad.t + G.ph - envH);
      ctx.fillText('0', G.pad.l + G.pw + 4, G.pad.t + G.ph);

      // Score area + line (smoothed)
      const pts = ser.filter((p) => p.score != null).map((p) => [X(p.t) + bw / 2, Y(p.score)]);
      if (pts.length > 1) {
        const path = new Path2D();
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          const mx = (x0 + x1) / 2;
          path.bezierCurveTo(mx, y0, mx, y1, x1, y1);
        }
        const area = new Path2D(path);
        area.lineTo(pts[pts.length - 1][0], G.pad.t + G.ph); area.lineTo(pts[0][0], G.pad.t + G.ph); area.closePath();
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, G.pad.l + G.pw * state.prog + bw, G.H); ctx.clip();
        const grad = ctx.createLinearGradient(0, G.pad.t, 0, G.pad.t + G.ph);
        grad.addColorStop(0, 'rgba(93,228,255,.38)'); grad.addColorStop(1, 'rgba(93,228,255,0)');
        ctx.fillStyle = grad; ctx.fill(area);
        const sg = ctx.createLinearGradient(0, Y(90), 0, Y(20));
        sg.addColorStop(0, C.hot); sg.addColorStop(0.35, C.accent2); sg.addColorStop(1, C.accent);
        ctx.strokeStyle = sg; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke(path);
        ctx.restore();
        if (state.prog < 1) {
          const hx = G.pad.l + G.pw * state.prog;
          const near = pts.reduce((b, p) => (Math.abs(p[0] - hx) < Math.abs(b[0] - hx) ? p : b), pts[0]);
          ctx.fillStyle = C.accent; ctx.shadowColor = C.accent; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(near[0], near[1], 3.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        }
      }

      // Peak marker
      let peak = null;
      ser.forEach((p) => { if (p.score != null && p.t >= state.now - HOUR && (!peak || p.score > peak.score)) peak = p; });
      if (peak && state.prog >= 1) {
        const x = X(peak.t) + bw / 2, y = Y(peak.score);
        ctx.fillStyle = C.hot; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.font = 'bold 11px ' + cssVar('--mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('PEAK ' + peak.score, Math.min(G.pad.l + G.pw - 24, Math.max(G.pad.l + 24, x)), y - 6);
      }

      // Time axis: day separators & 6h ticks
      ctx.font = '10px ' + cssVar('--font'); ctx.textBaseline = 'top';
      const tickStep = bw * 6 >= 34 ? 6 : 12;
      ser.forEach((p) => {
        const h = jp(p.t).h, x = X(p.t);
        if (h === 0) {
          ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, G.pad.t - 6); ctx.lineTo(x, G.pad.t + G.ph + 18); ctx.stroke();
          ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.fillText(md(p.t), x + 3, G.pad.t + G.ph + 17);
        } else if (h % tickStep === 0 && X(p.t) - G.pad.l > 14) {
          ctx.fillStyle = C.faint; ctx.textAlign = 'center'; ctx.fillText(h + '時', x, G.pad.t + G.ph + 4);
        }
      });

      // Now line
      if (state.now >= t0 && state.now <= t1) {
        const x = X(state.now);
        ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, G.pad.t - 6); ctx.lineTo(x, G.pad.t + G.ph); ctx.stroke();
        ctx.fillStyle = C.accent; ctx.font = 'bold 9px ' + cssVar('--mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('NOW', x, G.pad.t - 7 < 8 ? 10 : G.pad.t - 7);
      }

      // Hover crosshair
      if (state.hover != null && ser[state.hover]) {
        const p = ser[state.hover];
        const x = X(p.t) + bw / 2;
        ctx.strokeStyle = C.text; ctx.globalAlpha = .6; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, G.pad.t); ctx.lineTo(x, G.pad.t + G.ph); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (p.score != null) { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x, Y(p.score), 4.5, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    function showTip(i) {
      const p = state.series[i];
      if (!p || !tip) { if (tip) tip.hidden = true; return; }
      const c = p.cond;
      const G = geometry();
      const bw = G.pw / state.series.length;
      const x = G.pad.l + i * bw + bw / 2;
      const env = state.water === 'sea'
        ? `波 ${f1(c.wave)}m・風 ${f1(c.wind, 0)}m/s ${FH.engine.compass(c.windDir)}`
        : `雨 ${f1(c.precip)}mm・風 ${f1(c.wind, 0)}m/s`;
      tip.innerHTML = `<div class="muted small">${dayLabel(p.t)} ${hm(p.t)}〜 ・ ${esc(c.light.label)}</div>
        <div><b class="num">${p.score == null ? '–' : p.score}</b> <span class="small">${p.score == null ? '' : esc(FH.engine.verdict(p.score).label)}</span></div>
        <div class="small">${env}</div>
        <div class="small muted">気温 ${f1(c.temp)}℃${c.waterTemp != null ? '・水温 ' + f1(c.waterTemp) + '℃' : ''}${c.solunar.label ? '・' + esc(c.solunar.label) : ''}</div>
        ${p.safety && p.safety.level ? `<div class="small" style="color:var(--${p.safety.level === 2 ? 'danger' : 'caution'})">⚠ ${esc(p.safety.reasons[0] || '')}</div>` : ''}`;
      tip.hidden = false;
      const tw = tip.offsetWidth || 160;
      tip.style.left = Math.max(4, Math.min(G.W - tw - 4, x + (x > G.W / 2 ? -tw - 12 : 12))) + 'px';
    }

    function onMove(ev) {
      const rect = canvas.getBoundingClientRect();
      const G = geometry();
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const i = Math.floor(((x - G.pad.l) / G.pw) * state.series.length);
      if (i < 0 || i >= state.series.length) return onLeave();
      if (i !== state.hover) {
        state.hover = i; draw(false); showTip(i);
        // Light haptic tick per hour while scrubbing with a finger.
        if (ev.pointerType === 'touch' && navigator.vibrate) { try { navigator.vibrate(4); } catch (_) { /* unsupported */ } }
      }
    }
    function onLeave() { state.hover = null; if (tip) tip.hidden = true; draw(false); }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    if (g.ResizeObserver) new ResizeObserver(() => draw(true)).observe(canvas);
    else g.addEventListener('resize', () => draw(true));

    return {
      update(series, opts = {}) {
        state.series = series || []; state.water = opts.water || 'sea'; state.now = opts.now || Date.now(); state.hover = null;
        if (tip) tip.hidden = true;
        cancelAnimationFrame(state.anim);
        if (FH.motion && FH.motion.reduce()) { state.prog = 1; draw(); return; }
        const t0 = performance.now();
        measure();
        const step = (now) => { state.prog = Math.min(1, (now - t0) / 1100); state.prog = 1 - Math.pow(1 - state.prog, 3); draw(false); if (state.prog < 1) state.anim = requestAnimationFrame(step); };
        state.prog = 0; state.anim = requestAnimationFrame(step);
      },
      redraw: draw,
      /** Show the crosshair + readout for hour index i (e.g. from the best strip). */
      focus(i) {
        if (!state.series[i]) return;
        state.hover = i; state.prog = 1; draw(); showTip(i);
        canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  }

  FH.ui = { esc, $, $$, hm, md, dayLabel, range, ago, f1, tone, ring, moonIcon, sunIcon, tideIcon, clockIcon, arrow, sparkline, toast, createChart };
})(typeof globalThis !== 'undefined' ? globalThis : this);
