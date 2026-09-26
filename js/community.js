/* FishHunter — みんなの釣果 (anonymous community catches via Supabase REST).
 * Only coarse structured fields leave the device (spot, species, size, count,
 * method, colour, light band, tide). No memo, photo, GPS or account. */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const COLS = 'id,created_at,caught_at,spot_id,species_id,size_cm,count,method,lure_color,light,tide,handle';
  const KEY = 'fh.device.v1';
  let cache = null;

  const cfg = () => FH.config || {};
  const enabled = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);

  function device() {
    try {
      let d = g.localStorage.getItem(KEY);
      if (!d) {
        const b = new Uint8Array(16);
        (g.crypto || {}).getRandomValues ? g.crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
        d = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
        g.localStorage.setItem(KEY, d);
      }
      return d;
    } catch (_) { return 'nostorage-' + Date.now().toString(16).padStart(16, '0'); }
  }
  const handle = () => 'ANON-' + device().slice(0, 4).toUpperCase();

  function headers(extra) {
    return Object.assign({ apikey: cfg().supabaseAnonKey, Authorization: 'Bearer ' + cfg().supabaseAnonKey, 'Content-Type': 'application/json' }, extra || {});
  }

  /** Share one catch-log entry anonymously. */
  async function post(entry) {
    if (!enabled()) throw new Error('みんなの釣果は準備中です');
    if (entry.count === 0) throw new Error('ボウズの記録は共有しません');
    const c = entry.cond || {};
    const body = {
      caught_at: new Date(entry.t).toISOString(), spot_id: entry.spotId, species_id: entry.speciesId,
      size_cm: entry.size || null, count: Math.max(1, Math.min(300, entry.count || 1)),
      method: entry.method ? String(entry.method).slice(0, 20) : null,
      lure_color: entry.lureColor ? String(entry.lureColor).slice(0, 20) : null,
      light: ['朝マズメ', '夕マズメ', '日中', '夜'].includes(c.light) ? c.light : null,
      tide: c.tide || null, handle: handle(), device: device()
    };
    const r = await FH.diag.fetchWithTimeout(cfg().supabaseUrl.replace(/\/$/, '') + '/rest/v1/catch_posts', {
      method: 'POST', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body)
    }, 12000).catch((e) => { throw new Error(/HTTP 4/.test(e.message) ? '送信できませんでした（上限・入力内容）' : e.message); });
    cache = null;
    return r.ok;
  }

  /** Recent visible posts (14 days), cached for 5 minutes. */
  async function recent() {
    if (!enabled()) return [];
    if (cache && Date.now() - cache.at < 5 * 60e3) return cache.rows;
    const since = new Date(Date.now() - 14 * 86400e3).toISOString();
    const url = cfg().supabaseUrl.replace(/\/$/, '') + `/rest/v1/catch_posts?select=${COLS}&caught_at=gte.${encodeURIComponent(since)}&order=caught_at.desc&limit=200`;
    try {
      const rows = await FH.diag.track('community', 'みんなの釣果', async () => {
        const r = await FH.diag.fetchWithTimeout(url, { headers: headers() }, 10000);
        const j = await r.json();
        return Object.assign(j, { detail: j.length + '件（14日）' });
      });
      cache = { at: Date.now(), rows: rows.filter((x) => FH.spotById[x.spot_id] && FH.speciesById[x.species_id]) };
      return cache.rows;
    } catch (_) { return (cache && cache.rows) || []; }
  }

  /** Posts converted to the intel report shape used by the radar. */
  function asReports(rows) {
    return rows.map((x) => {
      const sp = FH.speciesById[x.species_id];
      return {
        id: 'ugc-' + x.id, src: 'community', srcName: 'みんなの釣果', type: 'ugc', author: x.handle,
        title: `${FH.spotById[x.spot_id].name} ${sp.name}`, url: null, date: Date.parse(x.caught_at),
        area: FH.spotById[x.spot_id].area, spots: [x.spot_id], text: '',
        catches: [{ sp: sp.id, name: sp.name, alias: sp.name, count: x.count, min: x.size_cm, max: x.size_cm, method: x.method, mention: false }],
        time: { buckets: x.light ? [{ 朝マズメ: '朝', 夕マズメ: '夕', 日中: '昼', 夜: '夜' }[x.light]] : [], hours: [] },
        colors: x.lure_color ? [`${x.lure_color}で釣果`] : [], notices: []
      };
    });
  }

  FH.community = { enabled, post, recent, asReports, handle };
})(typeof globalThis !== 'undefined' ? globalThis : this);
