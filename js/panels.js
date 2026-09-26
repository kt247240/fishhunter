/* FishHunter — evidence, plan and analysis panels (split out of app.js).
 * 作戦ボード, 根拠の強さ・釣果日率, 狙い目, 独自分析, 新潟県の海のデータ, 根拠と分析タブ,
 * ★週末比較, 予報のブレ注記, 予測の答え合わせ, 研究メモ.
 * FH.panels(ctx) is called once by app.js with its state and selectors.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  FH.panels = function (ctx) {
    const { esc, $, $$, hm, md, range, tone } = FH.ui;
    const E = FH.engine;
    const { state, store, spot, species, hookOpts } = ctx;
    const shortName = (n) => n.replace(/（.*?）/g, '');

    /** Today timeline: next 24 h of light phases, the score curve, bite windows and "now". */
    function timelineSvg(sp, fish, now, wins) {
      if (!state.data) return '';
      const ser = E.series(sp, fish, state.data, now, 24).filter((x) => x.score != null);
      if (ser.length < 6) return '';
      const W = 320, H = 78, top = 6, base = 46, n = ser.length;
      const X = (i) => (i / (n - 1)) * W, Y = (v) => base - (v / 100) * (base - top);
      const col = { night: '#0a1b30', mazume: '#ff9f43', day: '#7ee9ff' };
      const bands = ser.map((x, i) => { const ph = x.cond.light.phase; return `<rect x="${X(i) - W / (n - 1) / 2}" y="52" width="${W / (n - 1) + 0.5}" height="10" fill="${col[ph] || col.day}" opacity="${ph === 'night' ? 1 : ph === 'mazume' ? 0.85 : 0.35}"/>`; }).join('');
      const pts = ser.map((x, i) => `${X(i).toFixed(1)},${Y(x.score).toFixed(1)}`);
      const area = `M0,${base} L${pts.join(' L')} L${W},${base} Z`;
      const t0 = ser[0].t, t1 = ser[n - 1].t;
      const XT = (t) => Math.max(0, Math.min(W, ((t - t0) / (t1 - t0)) * W));
      const win = wins.filter((w) => w.start < t1 + 3600e3).map((w) => `<rect class="tl-win" x="${XT(w.start)}" y="${top - 2}" width="${Math.max(3, XT(w.end) - XT(w.start))}" height="${base - top + 2}" rx="4"/>`).join('');
      let pk = 0; ser.forEach((x, i) => { if (x.score > ser[pk].score) pk = i; });
      const ticks = ser.map((x, i) => { const h = new Date(x.t + 9 * 3600e3).getUTCHours(); return h % 6 === 0 ? `<text x="${X(i)}" y="75" class="tl-tick">${h}時</text>` : ''; }).join('');
      const c = fish.color || '#5de4ff';
      return `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="今後24時間の条件スコアと時間帯">
        <defs><linearGradient id="tlg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="${c}" stop-opacity=".05"/></linearGradient></defs>
        ${bands}${win}<path class="tl-area" d="${area}" fill="url(#tlg)"/><polyline class="tl-line" points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1.6"/>
        <circle cx="${X(pk)}" cy="${Y(ser[pk].score)}" r="3.2" fill="#fff"/><text x="${Math.min(W - 14, Math.max(14, X(pk)))}" y="${Math.max(9, Y(ser[pk].score) - 5)}" class="tl-peak">${ser[pk].score}</text>
        <line x1="1" x2="1" y1="${top - 2}" y2="62" class="tl-now"/><circle cx="2" cy="${Y(ser[0].score)}" r="3" class="tl-now-dot"/>${ticks}</svg>
        <div class="tl-legend"><span><i style="background:#0a1b30"></i>夜</span><span><i style="background:#ff9f43"></i>まずめ</span><span><i style="background:#7ee9ff;opacity:.5"></i>日中</span><span><i class="tl-win-key"></i>時合</span></div>`;
    }

    /** Liquid gauge for a 0..1 rate. */
    function gaugeSvg(p, color) {
      const lvl = 58 - p * 52;
      const wave = (y) => `M0 ${y} Q 8 ${y - 3} 16 ${y} T 32 ${y} T 48 ${y} T 64 ${y} T 80 ${y} T 96 ${y} T 112 ${y} T 128 ${y} V 64 H 0 Z`;
      return `<svg class="gauge" viewBox="0 0 64 64" width="72" height="72" role="img" aria-label="${Math.round(p * 100)}%">
        <defs><clipPath id="gclip"><circle cx="32" cy="32" r="27"/></clipPath></defs>
        <circle cx="32" cy="32" r="30" fill="none" stroke="${color}" stroke-opacity=".45" stroke-width="2"/>
        <g clip-path="url(#gclip)"><rect width="64" height="64" fill="rgba(255,255,255,.04)"/>
          <path class="gauge-w2" d="${wave(lvl + 2)}" fill="${color}" opacity=".35"/><path class="gauge-w1" d="${wave(lvl)}" fill="${color}" opacity=".75"/></g>
        <text x="32" y="37" text-anchor="middle" class="gauge-t">${Math.round(p * 100)}<tspan font-size="9">%</tspan></text></svg>`;
    }

  /* 🏛 Official open data: prefecture sea survey, set-net landings, river discharge. */
  function renderOfficial(sp, fish) {
    const box = $('#govCard');
    const O = FH.feed.official && FH.feed.official();
    if (!O || sp.pref !== '新潟' || sp.water !== 'sea') { box.hidden = true; return; }
    const name = shortName(fish.name);
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
    let html = '';
    const k = O.kaikyo;
    if (k) {
      const tone = (w) => (/高め/.test(w || '') ? 'hi' : /低め/.test(w || '') ? 'lo' : '');
      const cell = (label, v, w) => `<div class="gv-t ${tone(w)}"><span>${label}</span><b class="num">${v.toFixed(1)}<small>℃</small></b><em>${esc(w || '')}</em></div>`;
      html += `<section class="lab-sec"><h4 class="rd-h">🌡 沖の水温（${k.month}月号・${k.obs ? `${k.obs.from[0]}/${k.obs.from[1]}〜${k.obs.to[0]}/${k.obs.to[1]}観測` : ''}）</h4>
        <div class="gv-temps">${cell('表層', k.t0, k.anomaly.t0)}${cell('水深50m', k.t50, k.anomaly.t50)}${cell('水深100m', k.t100, k.anomaly.t100)}</div>
        ${k.t0 - k.t50 >= 5 ? `<p class="small">表層と水深50mの差が${(k.t0 - k.t50).toFixed(1)}℃。魚は表層を避けて少し深いタナにいることが多い時期です（スコアの水温にも反映）。</p>` : ''}</section>`;
    }
    const L = O.landings;
    if (L && L.species) {
      const rows = Object.entries(L.species).filter(([, v]) => v.avg5 > 0.5 || v.t > 0.5).sort((a, b) => b[1].t - a[1].t);
      const mine = L.species[fish.id];
      html += `<section class="lab-sec"><h4 class="rd-h">📦 定置網の水揚げ（${L.year}年${L.month}月・県全体） <small>沖にどれだけ魚が来ているかの目安</small></h4>
        ${mine ? `<p class="tg-call">${esc(name)}：<b>${mine.t}トン</b>（5年平均の<b>${pct(mine.t, mine.avg5) ?? '—'}%</b>・前年の${pct(mine.t, mine.prev) ?? '—'}%）${mine.areas && mine.areas[sp.area] != null ? ` ／ ${esc(sp.area)} ${mine.areas[sp.area]}トン` : ''}</p>` : ''}
        <ol class="tg-zones">${rows.map(([id, v], i) => { const p = pct(v.t, v.avg5); return `<li style="--i:${i}" class="${id === fish.id ? 'on' : ''}"><span class="tz-l">${esc(shortName((FH.speciesById[id] || { name: id }).name))}</span><span class="tz-bar"><i style="width:${Math.min(100, Math.max(4, (p || 0) / 2))}%"></i></span><span class="tz-v num">${p == null ? '—' : p + '%'}<em class="st-n">${v.t}t</em></span></li>`; }).join('')}</ol>
        <p class="muted small">5年平均を100%とした比率（バーは200%で満杯）。月ごとの集計で、翌月に公表されます。</p></section>`;
    }
    const R = (O.rivers || []).find((r) => r.spots.includes(sp.id));
    if (R && R.series && R.series.length) {
      const today = new Date(state.now + 9 * 3600e3).toISOString().slice(0, 10);
      const nowV = (R.series.filter(([d]) => d <= today).slice(-1)[0] || [])[1];
      const mx = Math.max(...R.series.map(([, v]) => v), R.median * 2);
      const ratio = nowV != null && R.median ? nowV / R.median : null;
      html += `<section class="lab-sec"><h4 class="rd-h">🏞 ${esc(R.name)}の流量 <small>河口付近の濁り・塩分の目安（予測を含む）</small></h4>
        <div class="gv-river">${R.series.map(([d, v]) => `<span class="${d > today ? 'fc' : d === today ? 'now' : ''}" title="${d}: ${v} m³/s"><i style="height:${Math.max(3, (v / mx) * 100)}%"></i></span>`).join('')}<b class="gv-med" style="bottom:${(R.median / mx) * 100}%"></b></div>
        <p class="small">${nowV != null ? `いま約<b>${nowV} m³/s</b>（平常${R.median} m³/sの${ratio.toFixed(1)}倍）` : ''}${ratio >= 2 ? ' → <b>増水中</b>。河口付近は濁りと塩分低下の可能性（シーバス・クロダイは濁りの境目が狙い目、アオリイカ・キスには不利）' : ratio != null && ratio < 0.7 ? ' → 渇水気味' : ' → ほぼ平常'}。</p>
        <p class="muted small">FishHunterの釣果日誌（直江津・東港）では、増水と釣果に一貫した関係は見られていません。スコアには入れず情報として表示しています。</p></section>`;
    }
    const KY = O.kyucho;
    if (KY) {
      const on = KY.active && KY.spots.includes(sp.id);
      html += `<section class="lab-sec"><h4 class="rd-h">🌀 急潮情報（沿岸の急な強い流れ）</h4>${on
        ? `<p class="tg-call kyucho-on">⚠️ ${KY.items.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join('<br>')}<br><span class="small">堤防先端・磯では強い流れに注意。詳細と対象海域は県の発表を確認してください。</span></p>`
        : `<p class="small">現在、この海域への急潮情報は発表されていません（<a href="${esc(KY.page)}" target="_blank" rel="noopener">新潟県の発表ページ</a>を2時間ごとに確認）。</p>`}</section>`;
    }
    if (!html) { box.hidden = true; return; }
    html += `<p class="muted small">出典：${(O.credits || []).map(esc).join(' ／ ')}。<a href="${esc((k && k.page) || (L && L.page) || 'https://www.pref.niigata.lg.jp/site/suisan-kenkyu/')}" target="_blank" rel="noopener">新潟県水産海洋研究所</a></p>`;
    box.hidden = false;
    $('#govScope').textContent = '公的オープンデータ';
    $('#gov').innerHTML = html;
    FH.motion.stagger($('#gov'));
  }
  /* 🧠 Original analyses from the daybook: days like today, season flow, crowding. */
  function renderLab(sp, fish) {
    const box = $('#labCard');
    const I = FH.insight, book = FH.feed.daybook && FH.feed.daybook();
    if (!I || !book || !FH.feed.hasBook(sp.id) || !state.data) { box.hidden = true; return; }
    const H = 3600e3;
    const jst = new Date(state.now + 9 * H);
    const tomorrow = jst.getUTCHours() >= 15;
    const day = new Date(state.now + 9 * H + (tomorrow ? 24 * H : 0)).toISOString().slice(0, 10);
    const cond = I.dayConditions(sp, day, state.data);
    if (!cond) { box.hidden = true; return; }
    box.hidden = false;
    $('#labScope').textContent = `${sp.name} ・ 釣果日誌 ${book.days.filter((e) => e.s === sp.id).length}日分から`;
    const name = (id) => shortName((FH.speciesById[id] || { name: id }).name);
    const condTxt = (c) => [c.wv != null ? `波${c.wv}m` : '', c.wd != null ? `風${c.wd.toFixed(0)}m/s` : '', c.sst != null ? `水温${c.sst.toFixed(1)}℃` : '', c.prev != null && c.prev >= 0.9 ? '時化後' : ''].filter(Boolean).join(' ・ ');
    const mdS = (d) => { const [, m, dd] = d.split('-'); return `${+m}/${+dd}(${'日月火水木金土'[new Date(d + 'T12:00:00+09:00').getUTCDay()]})`; };
    let html = '';

    // 1) Days like today
    const near = I.analogs(book, sp.id, cond, day, 6);
    const lf = I.lift(book, sp.id, near);
    const mine = lf.find((x) => x.sp === fish.id);
    html += `<section class="lab-sec"><h4 class="rd-h">🔁 ${tomorrow ? '明日' : '今日'}に近い日（時期・海況が似た過去の日）</h4>
      <p class="lab-now">${tomorrow ? '明日' : '今日'}の日中：<b>${esc(condTxt(cond))}</b>${cond.tide ? ` ・ ${esc(cond.tide)}` : ''}</p>`;
    if (near.length) {
      html += `<p class="tg-call">${mine
        ? `似た${near.length}日のうち <b>${mine.hit}日</b> で${esc(name(fish.id))}が釣れていました（平均${Math.round(mine.fish)}匹${mine.zone ? `・多かったのは <b>${esc(I.zoneLabel(mine.zone))}</b>` : ''}）`
        : `似た${near.length}日には${esc(name(fish.id))}の釣果がありませんでした`}</p>`;
      const best = lf.slice(0, 5);
      if (best.length) html += `<ol class="tg-zones lab-lift">${best.map((x, i) => `<li style="--i:${i}" class="${x.sp === fish.id ? 'on' : ''}"><span class="tz-l">${esc(name(x.sp))}</span><span class="tz-bar"><i style="width:${Math.max(6, x.rate * 100)}%"></i></span><span class="tz-v num">${x.hit}/${x.n}日${x.lift >= 1.25 ? `<em>いつもの${x.lift.toFixed(1)}倍</em>` : ''}</span></li>`).join('')}</ol>`;
      html += `<details class="more"><summary><span>似た日の中身を見る</span></summary><ul class="lab-days">${near.map((x) => {
        const top = Object.entries(x.e.f).sort((a, b) => b[1][0] - a[1][0]).slice(0, 4);
        return `<li><b>${mdS(x.e.d)}</b> <span class="muted small">${esc(condTxt(x.e.c))}</span><div class="chips">${top.map(([k, f]) => `<span class="chip dot" style="--c:${(FH.speciesById[k] || {}).color || 'var(--accent)'}">${esc(name(k))}×${f[0]}${f[1] ? ' 〜' + f[1] + 'cm' : ''}</span>`).join('') || '<span class="muted small">釣果記載なし</span>'}</div></li>`;
      }).join('')}</ul></details>`;
    }
    html += '</section>';

    // 2) Season flow for the selected fish
    const ss = I.season(book, sp.id, fish.id, 10, state.now);
    if (ss.some((w) => w.hit)) {
      const sizes = ss.filter((w) => w.size != null);
      const recent = sizes.slice(-4);
      let grow = '';
      if (recent.length >= 2) {
        const a = recent[0].size, b = recent[recent.length - 1].size;
        grow = b - a >= 2 ? `サイズアップ中（${a}→${b}cm）` : a - b >= 2 ? `サイズダウン傾向（${a}→${b}cm）` : `サイズは横ばい（約${b}cm）`;
      }
      const lastHit = ss.map((w) => w.hit > 0).lastIndexOf(true);
      const hitsRecent = ss.slice(-3).reduce((a, w) => a + w.hit, 0), daysRecent = ss.slice(-3).reduce((a, w) => a + w.days, 0);
      const hitsBefore = ss.slice(0, -3).reduce((a, w) => a + w.hit, 0), daysBefore = ss.slice(0, -3).reduce((a, w) => a + w.days, 0);
      const rNow = daysRecent ? hitsRecent / daysRecent : 0, rBefore = daysBefore ? hitsBefore / daysBefore : 0;
      const flow = rNow >= rBefore + 0.2 ? '上り調子' : rNow <= rBefore - 0.2 ? '下り坂' : '安定';
      html += `<section class="lab-sec"><h4 class="rd-h">📈 ${esc(name(fish.id))}のシーズンの流れ <small>週ごとの「釣れた日の割合」と最大サイズの中央値</small></h4>
        <div class="lab-weeks">${ss.map((w, i) => {
          const r = w.days ? w.hit / w.days : 0;
          const d = new Date(w.w);
          return `<div class="lw${i === ss.length - 1 ? ' now' : ''}" title="${d.getUTCMonth() + 1}/${d.getUTCDate()}週：${w.hit}/${w.days}日"><span class="lw-bar"><i style="height:${w.days ? Math.max(4, r * 100) : 0}%"></i></span><span class="lw-size num">${w.size != null ? w.size : ''}</span><span class="lw-date">${d.getUTCMonth() + 1}/${d.getUTCDate()}</span></div>`;
        }).join('')}</div>
        <p class="small">直近3週は<b>${flow}</b>（釣れた日 ${Math.round(rNow * 100)}% ／ それ以前 ${Math.round(rBefore * 100)}%）${grow ? ` ・ ${grow}` : ''}${lastHit < ss.length - 2 ? ' ・ ここ2週は釣果報告なし' : ''}</p></section>`;
    }

    // 3) Storm curve: how this fish did N days after a blow at this pier
    if (sp.water === 'sea') {
      const sc = I.stormCurve(book, sp.id, fish.id);
      if (sc && sc.some((b) => b.mult != null && b.key !== '7+' && b.n >= 3)) {
        const cur = I.stormBucket(cond.ss);
        const mx = Math.max(2, ...sc.map((b) => b.mult || 0));
        const best = sc.filter((b) => b.n >= 3 && b.key !== '7+').sort((a, b) => b.mult - a.mult)[0];
        html += `<section class="lab-sec"><h4 class="rd-h">🌊 時化後カーブ（${esc(name(fish.id))}） <small>最大波1.5m以上の時化から何日目か／季節の影響を除いた「いつもの何倍」</small></h4>
          <ol class="storm">${sc.map((b, i) => `<li class="${b.key === cur ? 'now' : ''}" style="--i:${i}"><span class="st-l">${esc(b.label)}${b.key === cur ? '<em>今日</em>' : ''}</span>
            <span class="st-bar"><i class="${(b.mult || 0) >= 1 ? 'up' : 'dn'}" style="width:${b.mult == null ? 0 : Math.max(4, (b.mult / mx) * 100)}%"></i><span class="st-one" style="left:${(1 / mx) * 100}%"></span></span>
            <span class="tz-v num">${b.mult == null ? '—' : '×' + b.mult.toFixed(1)}<em class="st-n">${b.n}日</em></span></li>`).join('')}</ol>
          <p class="small">${best && best.mult >= 1.2 ? `この釣り場の${esc(name(fish.id))}は <b>時化の${esc(best.label)}</b> がいつもの約${best.mult.toFixed(1)}倍（${best.n}日分）。` : '時化の前後で大きな差は見られません。'}${cond.ss != null ? ` 今日は${cond.ss <= 0 ? '時化の当日' : cond.ss > 10 ? '凪が10日以上続いています' : `時化から${cond.ss}日目`}。` : ''} <span class="muted">日数が少ない区分は参考値です。</span></p></section>`;
      }
    }

    // 4) Migration radar: the same fish at every logged pier, side by side
    const piers = [...new Set(book.days.map((e) => e.s))].filter((id) => FH.spotById[id] && FH.spotById[id].water === sp.water);
    if (piers.length >= 2) {
      const mg = I.migration(book, fish.id, piers, state.now);
      if (mg.spots.some((x) => x.weeks.some((w) => w.hit))) {
        const sname = (id) => FH.spotById[id].name;
        const arr = mg.spots.map((x) => ({ id: x.id, d: x.arrivals[x.arrivals.length - 1] })).filter((x) => x.d);
        let arrTxt = '';
        if (arr.length) {
          arrTxt = arr.map((x) => `${esc(sname(x.id))} <b>${mdS(x.d)}</b>`).join(' ／ ');
          if (arr.length >= 2) {
            const [a, b] = arr.slice().sort((p, q) => (p.d < q.d ? -1 : 1));
            const gap = Math.round((Date.parse(b.d) - Date.parse(a.d)) / 864e5);
            if (gap >= 3) arrTxt += `（${esc(sname(a.id))}が${gap}日早い）`;
          }
        }
        const wk = mg.spots[0].weeks.map((w) => { const d = new Date(w.w); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; });
        html += `<section class="lab-sec"><h4 class="rd-h">🧭 回遊レーダー（${esc(name(fish.id))}） <small>釣り場ごとの週別「釣れた日の割合」</small></h4>
          <div class="mig">${mg.spots.map((x) => `<div class="mig-row${x.id === sp.id ? ' on' : ''}"><span class="mig-l">${esc(sname(x.id))}</span>${x.weeks.map((w) => `<span class="mig-c" style="--a:${w.days ? (w.hit / w.days).toFixed(2) : 0}" title="${w.hit}/${w.days}日">${w.days ? Math.round((w.hit / w.days) * 100) : '·'}</span>`).join('')}</div>`).join('')}
          <div class="mig-row mig-axis"><span class="mig-l"></span>${wk.map((t) => `<span>${t}</span>`).join('')}</div></div>
          ${arrTxt ? `<p class="small">今季の釣れ始め（2週間以上の空白のあと最初の釣果）：${arrTxt}</p>` : ''}
          ${mg.lead ? `<p class="small">📡 ${esc(sname(mg.lead.from))}の釣れ具合が約<b>${mg.lead.days}日</b>遅れて${esc(sname(mg.lead.to))}に表れる傾向（相関${mg.lead.r.toFixed(2)}・${mg.lead.n}日分・まだ1シーズンの傾向）。${esc(sname(mg.lead.from))}の今週の動きが先行サインになります。</p>` : ''}</section>`;
      }
    }

    // 5) Forecast drift for this spot
    const leads = FH.feed.skillLeads ? FH.feed.skillLeads() : [];
    const rows = leads.map((L) => FH.feed.forecastSkill(L, sp.id)).filter((k) => k && (k.wind || k.wave));
    if (rows.length) {
      const fmt = (x, u) => (x ? `<b class="num ${Math.abs(x.bias) >= (u === 'm' ? 0.15 : 0.7) ? 'warn' : ''}">${x.bias > 0 ? '+' : ''}${x.bias.toFixed(u === 'm' ? 2 : 1)}</b><small>±${x.mae.toFixed(u === 'm' ? 2 : 1)}${u}</small>` : '—');
      html += `<section class="lab-sec"><h4 class="rd-h">📡 予報のブレ <small>何日前の予報が、直前の予報からどれだけズレたか（日中の最大値・過去${rows[0].days}日）</small></h4>
        <table class="skill"><thead><tr><th></th>${rows.map((k) => `<th>${k.lead}日前</th>`).join('')}</tr></thead><tbody>
        <tr><th>風 m/s</th>${rows.map((k) => `<td>${fmt(k.wind, 'm/s')}</td>`).join('')}</tr>
        ${sp.water === 'sea' ? `<tr><th>波 m</th>${rows.map((k) => `<td>${fmt(k.wave, 'm')}</td>`).join('')}</tr>` : ''}</tbody></table>
        <p class="muted small">マイナス＝予報が弱め・低めに出ていた。予報どうしの比較なので、実測との差ではありません。</p></section>`;
    }

    // 6) Crowding
    const cr = I.crowd(book, sp.id, 6, state.now);
    if (cr.n >= 5) {
      const cell = (label, v) => `<div class="lab-crowd-c"><span>${label}</span><b class="num">${v == null ? '—' : v}</b><small>${v == null ? '' : '名'}</small></div>`;
      html += `<section class="lab-sec"><h4 class="rd-h">👥 混雑の目安 <small>過去6週の入場者数（中央値）</small></h4>
        <div class="lab-crowd">${cell('平日', cr.weekday)}${cell('土曜', cr.sat)}${cell('日曜', cr.sun)}</div></section>`;
    }
    html += `<p class="muted small">FishHunterが公開釣果と過去の気象を毎日記録した「釣果日誌」から計算しています。過去データでの検証では、似た日の釣果から当日の釣果の有無をある程度見分けられました（AUC 約0.72）。ただし今は1シーズン分のため、効いているのは主に時期の近さです。</p>`;
    $('#lab').innerHTML = html;
    FH.motion.stagger($('#lab'));
  }
  /** 根拠と分析: one evidence card at a time; tabs whose card has nothing to show are disabled. */
  function updateEvTabs(pick) {
    const btns = $$('#evTabs [data-evtab]');
    const avail = btns.filter((b) => { const c = $('#' + b.dataset.evtab); return c && !c.hidden; });
    btns.forEach((b) => { b.disabled = !avail.includes(b); });
    let want = pick || store.get('fh.evtab', 'targetCard');
    if (!avail.some((b) => b.dataset.evtab === want)) want = avail.length ? avail[0].dataset.evtab : null;
    if (pick) store.set('fh.evtab', pick);
    btns.forEach((b) => { const on = b.dataset.evtab === want; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $$('#evTabs .ev-panes > .card').forEach((c) => c.classList.toggle('ev-active', c.id === want));
    $('#evTabs').hidden = !avail.length;
  }
  /** Evidence level + calibrated chance under the spot score. */
  function renderChance(sp, fish, wins, now) {
    const el = $('#spotChance');
    const lv = evLevel(sp, fish);
    const w = wins[0];
    const ch = lv !== 'C' ? chanceAt(sp, fish, w ? w.peakT : now) : null;
    const cal = FH.feed.calibration && FH.feed.calibration();
    const sc = cal && cal.species && cal.species[fish.id];
    const name = shortName(fish.name);
    let html = `<div class="chance-row">${evidenceChip(sp, fish)}<span class="small">${{ A: 'この釣り場の釣果記録にもとづく', B: 'エリアの釣果報告あり・この釣り場の記録はなし', C: '天気と季節だけの目安（この釣り場の釣果記録なし）' }[lv]}</span></div>`;
    if (ch) {
      html += `<div class="chance-gauge">${gaugeSvg(ch.p, fish.color || '#5de4ff')}<div>`;
      html += `<p class="chance-main">📈 ${lv === 'A' ? '' : '<span class="chip evb">参考</span> '}${w ? '次の時合' : '今'}と似た条件の日、管理釣り場で<b>${esc(name)}</b>の釣果報告があったのは <b class="num">${pctTxt(ch.p)}</b><span class="muted small">（${ch.local ? "この釣り場の平均" : "全体平均"} ${pctTxt(ch.base)}）</span></p>
        <p class="muted small">管理釣り場・ボート店の毎日の釣果（${ch.n}日分）から算出。多くの人が釣る場所での「誰かが釣った日」の割合で、一人あたりの確率ではありません。</p></div></div>`;
    } else if (sp.water === 'sea' && sc && sc.base < 0.05) {
      html += `<p class="muted small">${esc(name)}は管理釣り場ではほとんど釣れない（${pctTxt(sc.base)}の日）ため、実績からの目安は出せません。</p>`;
    }
    el.innerHTML = html;
    el.hidden = false;
  }
  /* 🧭 Plan board: when / where / how / why / watch-outs, assembled from every analysis on this page. */
  function renderPlan(sp, fish, cur, wins, now) {
    const box = $('#planCard');
    const d = state.data;
    if (!d || !cur) { box.hidden = true; return; }
    const w = wins[0];
    const t = w ? w.peakT : now;
    const c = E.conditions(sp, t, d);
    const r = E.score(sp, fish, c, hookOpts(sp, fish, c));
    const tac = E.tactics(sp, fish, c);
    const name = shortName(fish.name);
    const rows = [], plain = [];
    const text = [`【${sp.name} × ${name}】FishHunter 作戦`];
    const strip = (x) => String(x || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const add = (ic, k, v, sub) => { plain.push({ ic, k, v: strip(v), sub: strip(sub) }); rows.push(`<div class="pl-row"><span class="pl-ic">${ic}</span><div><div class="pl-k">${k}</div><div class="pl-v">${v}</div>${sub ? `<div class="pl-s">${sub}</div>` : ''}</div></div>`); text.push(`${k}：${v.replace(/<[^>]+>/g, '')}${sub ? '（' + sub.replace(/<[^>]+>/g, '') + '）' : ''}`); };

    // いつ
    const pch = evLevel(sp, fish) === 'A' ? chanceAt(sp, fish, t) : null;
    if (w) add('⏰', 'いつ', `<b>${esc(range(w.start, w.end, now))}</b> ・ ${esc(E.verdict(w.peak).label)} ${w.peak}`, esc(w.tags.join('・')) + (pch ? ` ／ 似た条件の日の釣果報告 ${pctTxt(pch.p)}` : ''));
    else add('⏰', 'いつ', '72時間以内に目立った時合なし', '別の釣り場・魚種も検討を');

    // どこ
    const T = FH.feed.target ? FH.feed.target(sp, fish) : null;
    const zone = T && T.p && T.p.zones && T.p.zones[0];
    if (zone) add('📍', 'どこ', `<b>${esc(zone.label)}</b>`, `${esc(T.label)}の実績：${zone.days}日で釣果${zone.d14 ? `・直近14日で${zone.d14}日` : ''}`);
    else if (tac.aim && tac.aim.length) add('📍', 'どこ', esc(tac.aim[0]), tac.aim[1] ? esc(tac.aim[1]) : '');

    // どう
    const method = (T && T.p && T.p.methods && T.p.methods[0] && T.p.methods[0][0]) || tac.method.name;
    add('🎣', 'どう', `<b>${esc(method)}</b> ・ ${esc(tac.layer)}`, `カラー：${esc(tac.color.main)}`);

    // なぜ
    const why = [];
    const pos = r.factors.filter((f) => f.key !== 'season' && f.impact > 1).sort((a, b) => b.impact - a.impact).slice(0, 2).map((f) => f.label);
    if (pos.length) why.push(pos.join('・') + 'が好条件');
    const book = FH.feed.daybook && FH.feed.daybook();
    if (book && FH.insight && FH.feed.hasBook(sp.id)) {
      const day = new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
      const dc = FH.insight.dayConditions(sp, day, d);
      if (dc) {
        const near = FH.insight.analogs(book, sp.id, dc, day, 6);
        const hit = near.filter((x) => x.e.f[fish.id]).length;
        if (near.length) why.push(`似た${near.length}日のうち${hit}日で釣果`);
        if (dc.ss != null && dc.ss <= 3) why.push(dc.ss <= 0 ? '時化の当日' : `時化から${dc.ss}日目`);
      }
    }
    const L = FH.feed.official && FH.feed.official() && FH.feed.official().landings;
    const ls = L && L.species && L.species[fish.id];
    if (ls && ls.avg5 > 0) why.push(`沖の水揚げは5年平均の${Math.round((ls.t / ls.avg5) * 100)}%（${L.month}月）`);
    why.push({ A: 'この釣り場の釣果記録あり', B: 'エリアの報告のみ', C: '天気と季節だけの目安' }[evLevel(sp, fish)]);
    add('💡', 'なぜ', why.length ? esc(why.join(' ／ ')) : `旬度 ${Math.round(r.season * 100)}%`, '');

    // 注意
    const warn = [...r.safety.reasons];
    const lead = Math.round((t - now) / 86400e3);
    const k = lead >= 2 && FH.feed.forecastSkill ? FH.feed.forecastSkill(lead) : null;
    if (k && k.wind && k.wind.bias <= -0.7) warn.push(`${k.lead}日先の風予報は実際より約${Math.abs(k.wind.bias).toFixed(1)}m/s弱めに出がち`);
    const cr = book && FH.insight ? FH.insight.crowd(book, sp.id, 6, now) : null;
    if (cr && cr.n >= 5) { const dow = new Date(t + 9 * 3600e3).getUTCDay(); const v = dow === 6 ? cr.sat : dow === 0 ? cr.sun : cr.weekday; if (v != null) warn.push(`混雑の目安 約${v}名（${dow === 6 ? '土曜' : dow === 0 ? '日曜' : '平日'}の中央値）`); }
    if (sp.rules) warn.push(sp.rules);
    add(r.safety.level >= 1 ? '⚠️' : '✅', '注意', warn.length ? esc(warn.slice(0, 3).join(' ／ ')) : '特になし', '');

    box.hidden = false;
    $('#planScope').textContent = w ? `ピーク ${hm(w.peakT)} 時点の条件で作成` : '';
    $('#plan').innerHTML = `<div class="tl-wrap">${timelineSvg(sp, fish, now, wins)}</div>` + rows.join('');
    state.planText = text.join('\n') + '\n' + location.origin + location.pathname;
    state.plan = { rows: plain, score: w ? w.peak : r.score, win: w, cond: c };
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
      if (T.colors && T.colors.length) {
        const n = T.colors.reduce((a, c) => a + c[1] + c[2], 0);
        html += `<div class="tg-colors"><span class="rd-h">🎨 カラーの実績</span>${T.colors.slice(0, 6).map(([c, pos, neg]) => `<span class="chip ${pos > neg ? 'ev' : pos < neg ? 'neg' : ''}">${esc(c)} ${pos ? '👍' + pos : ''}${neg ? ' 👎' + neg : ''}</span>`).join('')}${n < 3 ? '<span class="muted small">（まだ件数が少ない参考値）</span>' : ''}</div>`;
      }
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
  const EV = { A: ['📊', '実績あり', 'ev'], B: ['🗺', 'エリア情報', 'evb'], C: ['☁', '天気のみ', 'evc'] };
  const evLevel = (sp, fish) => (FH.feed.evidenceLevel ? FH.feed.evidenceLevel(sp, fish) : 'C');
  function evidenceChip(sp, fish) {
    const [ic, label, cls] = EV[evLevel(sp, fish)];
    return `<span class="chip ${cls}" title="根拠：${label}">${ic} ${label}</span>`;
  }
  /** 実績の釣果日率 at instant t (engine score without evidence/personal extras, as calibrated). */
  function chanceAt(sp, fish, t) {
    if (!state.data || !FH.feed.chance) return null;
    const c = E.conditions(sp, t, state.data);
    return c.hasWx ? FH.feed.chance(sp, fish, E.score(sp, fish, c).score) : null;
  }
  const pctTxt = (x) => Math.round(x * 100) + '%';
  /** Evidence + calibrated chance for a pick card. */
  // The pier-calibrated chance is shown for spots with their own record (A), marked 参考 for
  // area-only spots (B), and not at all for weather-only spots (C) — it would be borrowed evidence.
  function pickEvidence(p) {
    const lv = evLevel(p.spot, p.sp);
    const ch = lv !== 'C' ? chanceAt(p.spot, p.sp, p.win.peakT) : null;
    return evidenceChip(p.spot, p.sp) + (ch ? `<span class="chip ${lv === 'A' ? 'ev' : 'evb'}" title="管理釣り場（直江津・東港）で、似た条件の日にこの魚の釣果報告があった割合">${lv === 'A' ? '' : '参考 '}釣果日 ${pctTxt(ch.p)}</span>` : '');
  }
  /** Measured forecast drift for this many days ahead (from data/forecast-skill.json). */
  function skillNote(lead) {
    if (lead < 2) return '';
    const k = FH.feed.forecastSkill ? FH.feed.forecastSkill(lead) : null;
    if (!k) return lead > 3 ? '<p class="muted small">※3日以上先の予報は精度が下がります</p>' : '';
    const parts = [];
    if (k.wind && Math.abs(k.wind.bias) >= 0.7) parts.push(`風は平均${Math.abs(k.wind.bias).toFixed(1)}m/s${k.wind.bias < 0 ? '弱め' : '強め'}に出がち`);
    if (k.wave && Math.abs(k.wave.bias) >= 0.15) parts.push(`波は平均${Math.abs(k.wave.bias).toFixed(1)}m${k.wave.bias < 0 ? '低め' : '高め'}に出がち`);
    if (!parts.length) return `<p class="muted small">📡 ${k.lead}日前の予報のブレ：風±${k.wind ? k.wind.mae.toFixed(1) : '—'}m/s・波±${k.wave ? k.wave.mae.toFixed(1) : '—'}m（過去${k.days}日の実績）</p>`;
    return `<p class="small skill-note">📡 過去${k.days}日の実績では、${k.lead}日前の予報は${parts.join('、')}。${k.wind && k.wind.bias <= -0.7 ? '風は強めに見積もってください。' : ''}</p>`;
  }
  /** ★ favourites side by side for the weekend (engine.favCompare). */
  function renderFavCompare() {
    const box = $('#favCompare');
    const P = FH.prefs.get();
    if (!state.data) { box.innerHTML = ''; return; }
    if (!P.favorites.length) {
      box.innerHTML = '<p class="muted small fc-hint">★ 釣り場をお気に入り登録すると、土日のどこ・いつが一番かを並べて比べられます。</p>';
      return;
    }
    const fc = E.favCompare(state.data, state.now, P.favorites, { species: P.species });
    if (!fc.rows.length || !fc.days.some((d) => d.inRange)) { box.innerHTML = '<p class="muted small fc-hint">★ お気に入りの週末比較：まだ予報の範囲外です。</p>'; return; }
    const top = fc.rows[0];
    const cell = (v, isBest) => `<td class="${v == null ? 'na' : 'tone-' + tone(v)}${isBest ? ' best' : ''}">${v == null ? '—' : v}</td>`;
    box.innerHTML = `<div class="card fc-card"><div class="card-head"><h3>★ お気に入りの週末比較 <small>各釣り場のいちばん良い魚種・時間帯のピーク</small></h3></div>
      <p class="tg-call">👉 いちばん良いのは <b>${esc(top.spot.name)} × ${esc(shortName(top.sp.name))}</b>、<b>${fc.days[top.best.d].label}曜の${fc.blocks[top.best.b]}</b>（ピーク ${top.best.score}）</p>
      <div class="fc-wrap"><table class="fc"><thead><tr><th rowspan="2"></th>${fc.days.map((d) => `<th colspan="4">${d.label} ${md(d.day)}</th>`).join('')}</tr>
        <tr>${fc.days.map(() => fc.blocks.map((b) => `<th>${b}</th>`).join('')).join('')}</tr></thead>
        <tbody>${fc.rows.map((r) => `<tr class="fc-row" data-spot="${r.spot.id}" data-sp="${r.sp.id}" tabindex="0" role="button"><th><b>${esc(r.spot.name)}</b><small>${esc(shortName(r.sp.name))}</small></th>${r.cells.map((row, di) => row.map((v, bi) => cell(v, di === r.best.d && bi === r.best.b)).join('')).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="muted small">荒天で危険な時間は除外。数字をタップするとその釣り場を表示します。</p></div>`;
  }
  /* ── HUNT ── */
  /** 🔬 研究メモ: sourced ecology findings for this fish (+ Japan Sea background for sea spots). */
  function scienceHtml(fish, sp) {
    const S = FH.SCIENCE || {};
    const items = [...(S[fish.id] || []), ...(sp.water === 'sea' && fish.habitat.includes('sea') ? S._sea || [] : [])];
    if (!items.length) return '';
    return `<details class="more science" open><summary><span>🔬 研究メモ（論文・公的機関の資料より）</span></summary><ul>${items.map(([t, src, url]) =>
      `<li>${esc(t)}<a class="small" href="${esc(url)}" target="_blank" rel="noopener">— ${esc(src)}</a></li>`).join('')}</ul></details>`;
  }
  /** 🎯 予測の答え合わせ: score at log time vs what actually happened. */
  function reviewHtml(speciesId) {
    const rv = FH.catchlog.review(speciesId);
    if (!rv.trips.length) return '';
    const V = { hit: ['✓', '的中'], over: ['✗', '予測が高すぎ'], under: ['✗', '予測が低すぎ'], mid: ['△', '中間'] };
    const hits = rv.trips.filter((t) => t.verdict === 'hit').length, judged = rv.trips.filter((t) => t.verdict !== 'mid').length;
    return `<div class="review"><h4 class="rd-h">🎯 予測の答え合わせ <small>記録した釣行 ${rv.trips.length}回（同じ日・釣り場・魚種は1回）</small></h4>
      ${judged ? `<p class="tg-call">スコア70以上で釣れた／50未満で釣れなかった＝的中：<b>${hits}/${judged}回</b>${rv.trips.length < 5 ? '（5回以上で傾向が見えてきます）' : ''}</p>` : ''}
      <table class="skill"><thead><tr><th>記録時のスコア</th><th>釣行</th><th>釣れた</th><th>平均匹数</th></tr></thead><tbody>
      ${rv.buckets.map((b) => `<tr><th>${b.label}</th><td>${b.n}</td><td>${b.rate == null ? '—' : Math.round(b.rate * 100) + '%'}</td><td>${b.avg == null ? '—' : b.avg.toFixed(1)}</td></tr>`).join('')}</tbody></table>
      <ul class="rv-list">${rv.trips.slice(0, 5).map((t) => `<li class="rv-${t.verdict}"><b>${V[t.verdict][0]}</b> ${md(t.t)} ${esc((FH.spotById[t.spotId] || {}).name || t.spotId)} × ${esc(shortName((FH.speciesById[t.speciesId] || { name: t.speciesId }).name))} ・ スコア${t.score} → ${t.count ? t.count + '匹' : 'ボウズ'} <span class="muted small">${V[t.verdict][1]}</span></li>`).join('')}</ul></div>`;
  }

    return { renderOfficial, renderLab, updateEvTabs, renderChance, renderPlan, renderTarget, skillNote, renderFavCompare, reviewHtml, scienceHtml, evidenceChip, chanceAt, pickEvidence, EV, evLevel, pctTxt };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
