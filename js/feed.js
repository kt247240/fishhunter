/* FishHunter — catch intel (data/intel.json, produced by tools/intel/collect.mjs
 * on every deploy). Structured catches from official managed-area feeds and
 * public SNS posts. Optional: the app works without it. Treated as evidence of
 * recent activity in an area, never as proof of fish at a specific cast point.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const DAY = 86400e3;
  let intel = null;
  let hot = null;
  let book = null;
  let skill = null;
  let official = null;
  const evCache = new Map();

  /** Long-term evidence (data/hotspots.json: 60 days of catch DAYS per spot × species × pier zone). */
  async function loadHot() {
    try {
      const r = await FH.diag.fetchWithTimeout('data/hotspots.json', { cache: 'no-store' }, 10000);
      const j = await r.json();
      if (j && j.spots) hot = j;
    } catch (_) { /* optional */ }
  }

  async function loadBook() {
    try {
      const r = await FH.diag.fetchWithTimeout('data/daybook.json', { cache: 'no-store' }, 10000);
      const j = await r.json();
      if (j && Array.isArray(j.days)) book = j;
    } catch (_) { /* optional */ }
  }

  async function loadSkill() {
    try {
      const r = await FH.diag.fetchWithTimeout('data/forecast-skill.json', { cache: 'no-store' }, 10000);
      const j = await r.json();
      if (j && j.spots) skill = j;
    } catch (_) { /* optional */ }
  }

  /**
   * Forecast drift at `lead` days (nearest measured lead) — for one spot, or averaged over all.
   * → { lead, wind: {bias, mae, n}|null, wave: {…}|null, days }
   */
  function forecastSkill(lead, spotId = null) {
    if (!skill) return null;
    const ids = spotId ? [spotId].filter((id) => skill.spots[id]) : Object.keys(skill.spots);
    if (!ids.length) return null;
    const leads = [...new Set(ids.flatMap((id) => Object.keys(skill.spots[id].wind || {}).map(Number)))].sort((a, b) => a - b);
    if (!leads.length) return null;
    const L = leads.reduce((a, b) => (Math.abs(b - lead) < Math.abs(a - lead) ? b : a));
    const avg = (k) => {
      const xs = ids.map((id) => skill.spots[id][k] && skill.spots[id][k][L]).filter(Boolean);
      if (!xs.length) return null;
      const m = (f) => Math.round((xs.reduce((a, x) => a + x[f], 0) / xs.length) * 100) / 100;
      return { bias: m('bias'), mae: m('mae'), n: Math.min(...xs.map((x) => x.n)) };
    };
    return { lead: L, wind: avg('wind'), wave: avg('wave'), days: skill.days };
  }

  async function loadOfficial() {
    try {
      const r = await FH.diag.fetchWithTimeout('data/official.json', { cache: 'no-store' }, 10000);
      const j = await r.json();
      if (j && j.schema) official = j;
    } catch (_) { /* optional */ }
  }

  /** 海況情報 layer means, when the survey is recent enough to describe instant t (≤ 45 days). */
  function kaikyo(t) {
    const k = official && official.kaikyo;
    if (!k || !k.obs) return null;
    const obsT = Date.UTC(k.year - (k.obs.to[0] > k.month ? 1 : 0), k.obs.to[0] - 1, k.obs.to[1]);
    return Math.abs(t - obsT) <= 45 * DAY ? Object.assign({ obsT }, k) : null;
  }

  async function load() {
    const hp = Promise.all([loadHot(), loadBook(), loadSkill(), loadOfficial()]);
    try { return await loadIntel(); } finally { await hp; }
  }
  async function loadIntel() {
    try {
      const d = await FH.diag.track('feed', '釣果インテル', async () => {
        const r = await FH.diag.fetchWithTimeout('data/intel.json', { cache: 'no-store' }, 10000);
        const j = await r.json();
        if (!j || !Array.isArray(j.reports)) throw new Error('形式不正');
        const ok = (j.sources || []).filter((s) => s.ok).length;
        return Object.assign(j, { detail: `${j.reports.length}件 ・ ソース ${ok}/${(j.sources || []).length}` });
      });
      intel = d;
      await mergeCommunity();
      return intel;
    } catch (e) {
      FH.diag.report('feed', { label: '釣果インテル', state: 'warn', detail: '未取得（任意機能）: ' + (e && e.message) });
      if (FH.community && FH.community.enabled()) { intel = { reports: [], sources: [], stats: null }; await mergeCommunity(); return intel; }
      return null;
    }
  }

  /** Merge live community posts and (re)compute the per-spot / per-area tallies on the device. */
  async function mergeCommunity() {
    if (!intel) return;
    let ugc = [];
    if (FH.community && FH.community.enabled()) ugc = FH.community.asReports(await FH.community.recent());
    intel.reports = [...intel.reports.filter((r) => r.type !== 'ugc'), ...ugc].sort((a, b) => (b.date || 0) - (a.date || 0));
    const now = Date.now();
    intel.stats = { d7: aggregate(intel.reports, now - 7 * DAY), prev7: aggregate(intel.reports, now - 14 * DAY, now - 7 * DAY), d30: aggregate(intel.reports, now - 30 * DAY) };
    evCache.clear();
  }

  function aggregate(reports, since, until = Infinity) {
    const bucket = () => ({ reports: 0, fish: 0, maxSize: null, last: 0, methods: {}, times: {} });
    // One report = one vote per species, however many lines it spends on that fish.
    const add = (map, r, k, cs) => {
      const b = map[k] || (map[k] = Object.assign(bucket(), { sp: cs[0].sp, name: cs[0].name }));
      b.reports++;
      b.last = Math.max(b.last, r.date || 0);
      for (const c of cs) {
        b.fish += c.mention ? 0 : c.count || 1;
        if (c.max != null) b.maxSize = Math.max(b.maxSize || 0, c.max);
      }
      new Set(cs.map((c) => c.method).filter(Boolean)).forEach((m) => { b.methods[m] = (b.methods[m] || 0) + 1; });
      (r.time.buckets || []).forEach((t) => { b.times[t] = (b.times[t] || 0) + 1; });
    };
    const spots = {}, areas = {}, all = {};
    for (const r of reports) {
      if (!r.date || r.date < since || r.date >= until || r.type === 'boat') continue;
      const groups = new Map();
      for (const c of r.catches) { const k = c.sp || c.name; groups.has(k) ? groups.get(k).push(c) : groups.set(k, [c]); }
      for (const [k, cs] of groups) {
        r.spots.forEach((sid) => add(spots[sid] || (spots[sid] = {}), r, k, cs));
        if (r.area) add(areas[r.area] || (areas[r.area] = {}), r, k, cs);
        add(all, r, k, cs);
      }
    }
    const list = (m) => Object.values(m).sort((a, b) => b.fish - a.fish || b.last - a.last).slice(0, 12);
    const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, list(v)]));
    return { spots: map(spots), areas: map(areas), all: list(all) };
  }

  const reportsFor = (pred, days) => {
    if (!intel) return [];
    const since = Date.now() - days * DAY;
    return intel.reports.filter((r) => r.date && r.date >= since && pred(r));
  };

  /** { count, freshness 0..1, latestText } — used by the engine as a score bonus. */
  function evidence(spot, sp) {
    if (!intel) return null;
    const k = spot.id + ':' + sp.id;
    if (evCache.has(k)) return evCache.get(k);
    const hits = reportsFor((r) => r.type !== 'boat' && r.spots.includes(spot.id) && r.catches.some((c) => c.sp === sp.id && !c.mention), 7);
    let res = null;
    if (hits.length) {
      const latest = Math.max(...hits.map((r) => r.date));
      const days = Math.max(0, Math.floor((Date.now() - latest) / DAY));
      res = { count: hits.length, freshness: Math.max(0.25, 1 - days / 7), latestText: days === 0 ? '今日' : days + '日前' };
    }
    evCache.set(k, res);
    return res;
  }

  /** Does this catch belong to the same kind of water as the spot (sea vs lake/river)? */
  function fits(spot, c) {
    if (c.sp) { const sp = FH.speciesById[c.sp]; return !!sp && sp.habitat.includes(spot.water); }
    return spot.water === 'sea'; // unnamed extras (シイラ, メジナ, …) are sea fish
  }

  /** Species tally for a spot (falls back to its area). */
  function radar(spot, days = 7) {
    if (!intel) return null;
    const key = days <= 7 ? 'd7' : 'd30';
    const st = intel.stats && intel.stats[key];
    if (!st) return null;
    const prev = intel.stats.prev7 || { spots: {}, areas: {} };
    const withTrend = (list, before) => list.map((x) => {
      const p = (before || []).find((y) => (y.sp || y.name) === (x.sp || x.name));
      const a = x.fish || x.reports, b = p ? p.fish || p.reports : 0;
      const trend = !b ? (a >= 3 ? 'new' : null) : a >= b * 1.3 ? 'up' : a <= b * 0.7 ? 'down' : 'flat';
      return Object.assign({}, x, { trend, prev: b });
    });
    const bySpot = st.spots[spot.id];
    if (days <= 7 && bySpot && bySpot.length) return { scope: 'spot', label: spot.name, list: withTrend(bySpot, prev.spots[spot.id]) };
    if (bySpot && bySpot.length) return { scope: 'spot', label: spot.name, list: bySpot };
    const byArea = (st.areas[spot.area] || []).filter((x) => fits(spot, x));
    if (byArea.length) return { scope: 'area', label: spot.area + 'エリア', list: days <= 7 ? withTrend(byArea, prev.areas[spot.area]) : byArea };
    return { scope: 'none', label: spot.name, list: [] };
  }

  function recent(spot, n = 6) {
    const shore = (r) => r.type !== 'boat' && r.catches.some((c) => !c.mention);
    const own = reportsFor((r) => r.spots.includes(spot.id) && shore(r), 14);
    const list = own.length ? own : reportsFor((r) => r.area === spot.area && shore(r) && r.catches.some((c) => !c.mention && fits(spot, c)), 14);
    return list.slice(0, n);
  }

  /** Recent colour notes + method tally for a species around this spot's area. */
  function insight(spot, sp) {
    if (!intel) return null;
    const rs = reportsFor((r) => r.type !== 'boat' && (r.spots.includes(spot.id) || r.area === spot.area) && r.catches.some((c) => c.sp === sp.id), 14);
    if (!rs.length) return null;
    const methods = {};
    rs.forEach((r) => r.catches.filter((c) => c.sp === sp.id && c.method).forEach((c) => { methods[c.method] = (methods[c.method] || 0) + 1; }));
    const colors = [...new Set(rs.flatMap((r) => r.colors || []))].slice(0, 2);
    const sizes = rs.flatMap((r) => r.catches.filter((c) => c.sp === sp.id && c.max).map((c) => c.max));
    return {
      reports: rs.length,
      methods: Object.entries(methods).sort((a, b) => b[1] - a[1]).slice(0, 3),
      colors, maxSize: sizes.length ? Math.max(...sizes) : null
    };
  }

  /** Fresh measured conditions for a spot (e.g. lake water temperature), or null. */
  function observed(spotId, maxDays = 3) {
    const o = intel && intel.observations && intel.observations[spotId];
    return o && Date.now() - o.date <= maxDays * DAY ? o : null;
  }

  /** Recent notices (openings, closures, stocking…) for a spot or its area. */
  function notices(spot, days = 30, n = 3) {
    // Managed-area operational notices (closures, hours) go stale fast; co-op notices stay relevant longer.
    const rs = reportsFor((r) => r.notices && r.notices.length && (r.spots.includes(spot.id) || (!r.spots.length && r.area === spot.area)) &&
      (r.type !== 'official' || Date.now() - r.date <= 3 * DAY) && !r.notices.every((n) => /\d+\s*(匹|本|杯|cm)/i.test(n)), days);
    return rs.slice(0, n).map((r) => ({ text: r.notices[0], src: r.srcName, date: r.date, url: r.url }));
  }

  /**
   * Where on a managed pier catches happen (直江津: metres + 内側/外側, 東港: post numbers).
   * Uses the target species when it has enough positioned catches, otherwise all species.
   */
  function pierMap(spot, sp, days = 14) {
    const rs = reportsFor((r) => r.type === 'official' && r.spots.includes(spot.id), days);
    const all = rs.flatMap((r) => r.catches.filter((c) => c.pos && !c.mention));
    if (all.length < 5) return null;
    const mine = all.filter((c) => c.sp === sp.id);
    const use = mine.length >= 3 ? mine : all;
    const kind = use.some((c) => c.pos.m != null) ? 'm' : 'no';
    const bins = new Map();
    const add = (key, label, order, side, w) => {
      const b = bins.get(key) || { label, order, in: 0, out: 0, total: 0 };
      if (side === '内側') b.in += w; else if (side === '外側') b.out += w;
      b.total += w; bins.set(key, b);
    };
    for (const c of use) {
      const w = c.count || 1;
      if (c.pos.tip) add('tip', '先端', 999, c.pos.side, w);
      else if (kind === 'm' && c.pos.m != null) { const k = Math.floor(c.pos.m / 100); add('m' + k, k * 100 + 'm〜', k, c.pos.side, w); }
      else if (kind === 'no' && c.pos.no) c.pos.no.forEach((n) => { const k = Math.floor((n - 1) / 10); add('n' + k, `${k * 10 + 1}〜${k * 10 + 10}番`, k, null, w / c.pos.no.length); });
    }
    const list = [...bins.values()].sort((a, b) => a.order - b.order);
    const top = list.slice().sort((a, b) => b.total - a.total)[0];
    return { kind, bins: list, species: mine.length >= 3 ? sp.name : null, n: use.length, top };
  }

  /** Latest and average visitor counts at a managed fishing area (crowding hint). */
  function visitors(spot, days = 14) {
    const rs = reportsFor((r) => r.visitors != null && r.spots.includes(spot.id), days);
    if (!rs.length) return null;
    const avg = Math.round(rs.reduce((a, r) => a + r.visitors, 0) / rs.length);
    return { latest: rs[0].visitors, date: rs[0].date, avg, max: Math.max(...rs.map((r) => r.visitors)) };
  }

  /**
   * Evidence for "where exactly": this spot's own record, else its area's.
   * → { scope, label, reportDays, from, to, sources, rate, p: {days,d30,d14,d7,fish,max,last,methods,tb,zones} }
   */
  function target(spot, sp) {
    if (!hot) return null;
    const S = hot.spots[spot.id];
    if (S && S.sp[sp.id] && S.reportDays >= 3) return pack('spot', spot.name, S, S.sp[sp.id], sp);
    const A = hot.spots['@' + spot.area];
    if (A && A.sp[sp.id]) return pack('area', spot.area + 'エリア', A, A.sp[sp.id], sp);
    return S && S.reportDays >= 5 ? pack('spot', spot.name, S, null, sp) : null;
  }
  function pack(scope, label, S, p, sp) {
    const colors = (S.colors && S.colors[sp.id]) || null;
    return { scope, label, reportDays: S.reportDays, from: S.from, to: S.to, sources: S.sources, days: hot.days, p, colors, rate: p ? p.days / Math.max(1, S.reportDays) : 0 };
  }
  /** Spots ranked by days with this species reported caught (last 30 days). */
  function hotRank(sp) {
    if (!hot || !hot.rank) return [];
    return (hot.rank[sp.id] || []).map((r) => Object.assign({}, r, { spot: FH.spotById[r.spot], spotId: r.spot })).filter((r) => r.spot);
  }

  function list({ limit = 40 } = {}) {
    if (!intel) return [];
    return intel.reports.filter((r) => r.catches.some((c) => !c.mention)).slice(0, limit);
  }

  FH.feed = {
    stats: () => (intel && intel.stats) || null,
    observations: () => {
      const o = {};
      if (intel && intel.observations) for (const id of Object.keys(intel.observations)) { const v = observed(id); if (v) o[id] = v; }
      return o;
    },
    target, hotRank, hotLoaded: () => !!hot,
    daybook: () => book,
    official: () => official, kaikyo,
    forecastSkill, skillLeads: () => (skill ? [...new Set(Object.values(skill.spots).flatMap((v) => Object.keys(v.wind || {}).map(Number)))].sort((a, b) => a - b) : []),
    hasBook: (spotId) => !!(book && book.days.some((e) => e.s === spotId && e.c)),
    load, refreshCommunity: async () => { await mergeCommunity(); }, evidence, radar, recent, insight, list, observed, notices, pierMap, visitors,
    loaded: () => !!intel,
    generatedAt: () => (intel && intel.generated_at) || null,
    sources: () => (intel && intel.sources) || [],
    linkOnly: () => (intel && intel.linkOnly) || []
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
