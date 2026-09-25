/* FishHunter — growth tools: SNS share card (1080×1350 PNG) and calendar
 * export for bite windows (.ics with a reminder, or Google Calendar link). */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", system-ui, sans-serif';
  const TONE = { hot: '#ff5d7a', good: '#34e0a1', ok: '#ffd166', meh: '#ff9f43', bad: '#7b8fa3' };
  const appUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'app.html';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /** Render the share card. `o`: { spot, fish, score, win, cond, scene (canvas|null), now } */
  function card(o) {
    const W = 1080, H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#04111c'; ctx.fillRect(0, 0, W, H);

    // Scene snapshot (cover-fit into the top 56%)
    const sh = H * 0.56;
    if (o.scene && o.scene.width) {
      const s = Math.max(W / o.scene.width, sh / o.scene.height);
      const dw = o.scene.width * s, dh = o.scene.height * s;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, sh); ctx.clip();
      try { ctx.drawImage(o.scene, (W - dw) / 2, (sh - dh) * 0.3, dw, dh); } catch (_) { /* tainted: skip */ }
      ctx.restore();
    }
    const fade = ctx.createLinearGradient(0, sh * 0.55, 0, sh + 40);
    fade.addColorStop(0, 'rgba(4,17,28,0)'); fade.addColorStop(1, '#04111c');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, W, sh + 40);
    const top = ctx.createLinearGradient(0, 0, 0, 220);
    top.addColorStop(0, 'rgba(4,17,28,.75)'); top.addColorStop(1, 'rgba(4,17,28,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, W, 220);

    // Brand
    ctx.textBaseline = 'alphabetic';
    ctx.font = `900 44px ${FONT}`; ctx.fillStyle = '#e8f6ff';
    ctx.fillText('FISH', 64, 104);
    const fw = ctx.measureText('FISH').width;
    ctx.fillStyle = '#5de4ff'; ctx.fillText('HUNTER', 64 + fw, 104);
    ctx.font = `600 22px ${FONT}`; ctx.fillStyle = 'rgba(232,246,255,.7)';
    ctx.fillText('ANON. ・ 新潟・長野 釣果インテリジェンス', 66, 142);

    // Score ring
    const sc = o.score == null ? null : Math.round(o.score);
    const tone = TONE[sc == null ? 'bad' : FH.engine.verdict(sc).tone];
    const cx = W - 190, cy = sh - 40, R = 120;
    ctx.fillStyle = 'rgba(4,17,28,.72)'; ctx.beginPath(); ctx.arc(cx, cy, R + 26, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(126,233,255,.18)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if (sc != null) {
      ctx.strokeStyle = tone; ctx.lineCap = 'round'; ctx.shadowColor = tone; ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * sc) / 100); ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `800 108px ${FONT}`;
    ctx.fillText(sc == null ? '–' : String(sc), cx, cy + 32);
    ctx.fillStyle = tone; ctx.font = `800 30px ${FONT}`;
    ctx.fillText(sc == null ? 'NO DATA' : FH.engine.verdict(sc).label, cx, cy + 78);
    ctx.textAlign = 'left';

    // Title
    const short = (n) => n.replace(/（.*?）/g, '');
    let y = sh + 70;
    ctx.fillStyle = '#7ee9ff'; ctx.font = `700 26px ${FONT}`;
    ctx.fillText(`${o.spot.pref}・${o.spot.area}　${o.cond && o.cond.light ? o.cond.light.label : ''}`, 64, y);
    y += 78; ctx.fillStyle = '#fff'; ctx.font = `900 72px ${FONT}`;
    ctx.fillText(short(o.spot.name), 64, y);
    y += 70; ctx.fillStyle = '#cfe3ee'; ctx.font = `800 48px ${FONT}`;
    ctx.fillText('× ' + short(o.fish.name), 64, y);

    // Window
    y += 70;
    roundRect(ctx, 56, y - 44, W - 112, 96, 24);
    ctx.fillStyle = 'rgba(93,228,255,.1)'; ctx.fill(); ctx.strokeStyle = 'rgba(93,228,255,.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#e8f6ff'; ctx.font = `800 36px ${FONT}`;
    ctx.fillText(o.win ? `次の時合 ${FH.ui.range(o.win.start, o.win.end, o.now)}` : '72時間以内に目立つ時合なし', 88, y + 14);
    if (o.win) { ctx.textAlign = 'right'; ctx.fillStyle = TONE[FH.engine.verdict(o.win.peak).tone]; ctx.fillText('PEAK ' + o.win.peak, W - 88, y + 14); ctx.textAlign = 'left'; }

    // Condition chips
    y += 100;
    const c = o.cond || {};
    const chips = [];
    if (c.tide && o.spot.water === 'sea') chips.push(c.tide.name);
    if (c.wave != null) chips.push(`波 ${c.wave.toFixed(1)}m`);
    if (c.wind != null) chips.push(`風 ${Math.round(c.wind)}m/s`);
    if (c.waterTemp != null) chips.push(`${c.waterTempEst ? '推定' : ''}水温 ${c.waterTemp.toFixed(1)}℃`);
    if (c.moonAge != null) chips.push(`月齢 ${c.moonAge.toFixed(1)}`);
    let x = 64;
    ctx.font = `700 28px ${FONT}`;
    for (const t of chips) {
      const w = ctx.measureText(t).width + 40;
      if (x + w > W - 56) break;
      roundRect(ctx, x, y - 34, w, 50, 25); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
      ctx.fillStyle = '#cfe3ee'; ctx.fillText(t, x + 20, y);
      x += w + 12;
    }

    // Footer
    ctx.fillStyle = 'rgba(232,246,255,.5)'; ctx.font = `500 22px ${FONT}`;
    ctx.fillText('※スコアは条件の一致度で、釣れる確率ではありません。安全第一で。', 64, H - 96);
    ctx.fillStyle = '#7ee9ff'; ctx.font = `700 24px ${FONT}`;
    ctx.fillText('#FishHunter  #時合を読め', 64, H - 56);
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(232,246,255,.6)'; ctx.font = `600 22px ${FONT}`;
    ctx.fillText(FH.ui.md(o.now) + ' ' + FH.ui.hm(o.now) + ' 時点', W - 64, H - 56);
    return cv;
  }

  function toBlob(cv) { return new Promise((res) => cv.toBlob(res, 'image/png')); }

  async function shareCard(o) {
    const cv = card(o);
    const blob = await toBlob(cv);
    const name = `fishhunter-${o.spot.id}-${o.fish.id}.png`;
    const text = `${o.spot.name} × ${o.fish.name}｜スコア ${o.score == null ? '–' : o.score}` +
      (o.win ? `｜次の時合 ${FH.ui.range(o.win.start, o.win.end, o.now)}` : '') + '\n#FishHunter #時合を読め';
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'image/png' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text, title: 'FishHunter' }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    try { await navigator.clipboard.writeText(text); } catch (_) { /* optional */ }
    return 'downloaded';
  }

  /* ───────────── calendar ───────────── */
  const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
  function eventText(spot, fish, win, tac) {
    const title = `時合: ${spot.name}×${fish.name}（ピーク${win.peak}）`;
    const desc = [
      `FishHunter 時合予報 ・ ${win.tags.join('・')}`,
      tac ? `釣法: ${tac.method.name} ／ カラー: ${tac.color.main}` : '',
      tac ? `サイズ: ${tac.size} ／ レンジ: ${tac.layer}` : '',
      '※スコアは釣れる確率ではありません。出発前に最新の気象・波浪・現地規則を確認してください。',
      appUrl()
    ].filter(Boolean).join('\n');
    return { title, desc };
  }
  function ics(spot, fish, win, tac) {
    const { title, desc } = eventText(spot, fish, win, tac);
    const uid = `${spot.id}-${fish.id}-${win.start}@fishhunter`;
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ANON.//FishHunter//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + icsDate(Date.now()),
      'DTSTART:' + icsDate(win.start), 'DTEND:' + icsDate(win.end),
      'SUMMARY:' + icsEsc(title), 'DESCRIPTION:' + icsEsc(desc),
      'LOCATION:' + icsEsc(spot.name), `GEO:${spot.lat};${spot.lon}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(title), 'TRIGGER:-PT30M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.join('\r\n') + '\r\n';
  }
  function downloadIcs(spot, fish, win, tac) {
    const blob = new Blob([ics(spot, fish, win, tac)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `jiai-${spot.id}-${fish.id}.ics`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function googleCalUrl(spot, fish, win, tac) {
    const { title, desc } = eventText(spot, fish, win, tac);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(title) + '&dates=' + icsDate(win.start) + '/' + icsDate(win.end) +
      '&details=' + encodeURIComponent(desc) + '&location=' + encodeURIComponent(`${spot.name} ${spot.lat},${spot.lon}`);
  }

  FH.share = { card, shareCard, ics, downloadIcs, googleCalUrl, appUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
