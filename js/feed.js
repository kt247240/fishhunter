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
  const evCache = new Map();

  async function load() {
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
    intel.stats = { d7: aggregate(intel.reports, Date.now() - 7 * DAY), d30: aggregate(intel.reports, Date.now() - 30 * DAY) };
    evCache.clear();
  }

  function aggregate(reports, since) {
    const bucket = () => ({ reports: 0, fish: 0, maxSize: null, last: 0, methods: {}, times: {} });
    const add = (map, r, c) => {
      const k = c.sp || c.name;
      const b = map[k] || (map[k] = Object.assign(bucket(), { sp: c.sp, name: c.name }));
      b.reports++; b.fish += c.mention ? 0 : c.count || 1;
      if (c.max != null) b.maxSize = Math.max(b.maxSize || 0, c.max);
      b.last = Math.max(b.last, r.date || 0);
      if (c.method) b.methods[c.method] = (b.methods[c.method] || 0) + 1;
      (r.time.buckets || []).forEach((t) => { b.times[t] = (b.times[t] || 0) + 1; });
    };
    const spots = {}, areas = {}, all = {};
    for (const r of reports) {
      if (!r.date || r.date < since || r.type === 'boat') continue;
      for (const c of r.catches) {
        r.spots.forEach((sid) => add(spots[sid] || (spots[sid] = {}), r, c));
        if (r.area) add(areas[r.area] || (areas[r.area] = {}), r, c);
        add(all, r, c);
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
    const bySpot = st.spots[spot.id];
    if (bySpot && bySpot.length) return { scope: 'spot', label: spot.name, list: bySpot };
    const byArea = (st.areas[spot.area] || []).filter((x) => fits(spot, x));
    if (byArea.length) return { scope: 'area', label: spot.area + 'エリア', list: byArea };
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
    const rs = reportsFor((r) => r.notices && r.notices.length && (r.spots.includes(spot.id) || (!r.spots.length && r.area === spot.area)), days);
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

  function list({ limit = 40 } = {}) {
    if (!intel) return [];
    return intel.reports.filter((r) => r.catches.some((c) => !c.mention)).slice(0, limit);
  }

  FH.feed = {
    load, refreshCommunity: async () => { await mergeCommunity(); }, evidence, radar, recent, insight, list, observed, notices, pierMap, visitors,
    loaded: () => !!intel,
    generatedAt: () => (intel && intel.generated_at) || null,
    sources: () => (intel && intel.sources) || [],
    linkOnly: () => (intel && intel.linkOnly) || []
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
