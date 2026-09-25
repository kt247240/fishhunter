/* FishHunter — public catch-intel snapshot (produced by the fishhunter-main
 * GitHub Actions pipeline). Optional: the app is fully usable without it.
 * Treated as evidence of recent activity in an area, never as proof of fish
 * at a specific cast point.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const SOURCES = [
    'data/runtime-snapshot.json',
    'https://raw.githubusercontent.com/kt247240/anon-lab-os/fishhunter-main/fishhunter/data/runtime-snapshot.json'
  ];
  const DAY = 86400e3;
  let snap = null;
  const evCache = new Map();

  function parseDate(txt) {
    if (!txt) return null;
    const m = String(txt).match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600e3 + 12 * 3600e3; // JST noon
  }

  async function load() {
    let lastErr = null;
    for (const url of SOURCES) {
      try {
        const j = await FH.diag.track('feed', '釣果スナップショット', async () => {
          const r = await FH.diag.fetchWithTimeout(url, { cache: 'no-store' }, 8000);
          const d = await r.json();
          if (!d || !Array.isArray(d.items)) throw new Error('形式不正');
          return Object.assign(d, { detail: `${d.items.length}件 / ${url.startsWith('http') ? 'GitHub' : '同梱'}` });
        });
        snap = j;
        snap.items.forEach((it) => { it._t = parseDate(it.date_text); });
        evCache.clear();
        return snap;
      } catch (e) { lastErr = e; }
    }
    FH.diag.report('feed', { label: '釣果スナップショット', state: 'warn', detail: '未接続（任意機能）: ' + (lastErr && lastErr.message) });
    return null;
  }

  function itemMatchesSpecies(it, sp) {
    const hay = (it.species || []).join(' ') + ' ' + (it.title || '');
    return sp.aliases.some((a) => hay.includes(a));
  }
  function itemsForSpot(spot) {
    if (!snap) return [];
    const direct = (snap.by_spot && snap.by_spot[spot.id]) || [];
    if (direct.length) return direct;
    const al = spot.feedAliases || [spot.name];
    return snap.items.filter((it) => (it.spot_hits || []).some((h) => al.includes(h)) || al.some((a) => (it.title || '').includes(a)));
  }

  /** { count, freshness 0..1, latestText } for recent (≤10 days) reports. */
  function evidence(spot, sp) {
    if (!snap) return null;
    const k = spot.id + ':' + sp.id;
    if (evCache.has(k)) return evCache.get(k);
    const now = Date.now();
    const hits = itemsForSpot(spot).filter((it) => itemMatchesSpecies(it, sp)).map((it) => (it._t === undefined ? parseDate(it.date_text) : it._t)).filter((t) => t && now - t <= 10 * DAY && t <= now + DAY);
    let r = null;
    if (hits.length) {
      const latest = Math.max(...hits);
      const days = Math.max(0, Math.floor((now - latest) / DAY));
      r = { count: hits.length, freshness: Math.max(0.2, 1 - days / 10), latestText: days === 0 ? '今日' : days + '日前' };
    }
    evCache.set(k, r);
    return r;
  }

  function list({ limit = 30 } = {}) {
    if (!snap) return [];
    return snap.items
      .filter((it) => (it.species || []).length || it._t)
      .slice()
      .sort((a, b) => (b._t || 0) - (a._t || 0))
      .slice(0, limit);
  }

  FH.feed = { load, evidence, list, loaded: () => !!snap, generatedAt: () => (snap && snap.generated_at) || null };
})(typeof globalThis !== 'undefined' ? globalThis : this);
