/* FishHunter — Open-Meteo Weather + Marine loader.
 * One batched request per API for every spot. Weather and Marine fail
 * independently; last good data is cached and reused (flagged stale).
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const CACHE_KEY = 'fh.wx.v3';
  const TTL = 30 * 60e3;
  const WX_URL = 'https://api.open-meteo.com/v1/forecast';
  const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
  const WX_VARS = ['temperature_2m', 'precipitation', 'pressure_msl', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'weather_code'];
  const MARINE_VARS = ['wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'sea_surface_temperature'];

  function readCache() {
    try { return JSON.parse(g.localStorage.getItem(CACHE_KEY)) || null; } catch (_) { return null; }
  }
  function writeCache(obj) {
    try { g.localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (_) { /* quota / private mode */ }
  }

  /** Nudge a sea spot ~4km toward open water so the marine grid picks a sea cell. */
  function seaward(spot) {
    const f = ((spot.face || 0) * Math.PI) / 180;
    return { lat: spot.lat + 0.04 * Math.cos(f), lon: spot.lon + 0.05 * Math.sin(f) };
  }

  function qs(params) {
    return Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function getJSON(url, tries = 3) {
    let err;
    for (let k = 0; k < tries; k++) {
      try {
        const r = await FH.diag.fetchWithTimeout(url, { cache: 'no-store' }, 20000);
        const j = await r.json();
        if (j && j.error) throw new Error(j.reason || 'API error');
        return Array.isArray(j) ? j : [j];
      } catch (e) { err = e; if (k < tries - 1) await sleep(800 * Math.pow(2, k) + Math.random() * 400); }
    }
    throw err;
  }
  function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

  /** Run a per-chunk loader; merge successes, fail only if every chunk failed. */
  async function chunked(spots, size, loader) {
    const parts = await Promise.allSettled(chunks(spots, size).map(loader));
    const ok = parts.filter((p) => p.status === 'fulfilled');
    if (!ok.length) throw parts[0].reason;
    const out = Object.assign({}, ...ok.map((p) => p.value));
    const missing = spots.length - Object.keys(out).length;
    if (missing > 0) out._partial = missing;
    return out;
  }

  const loadWeather = (spots) => chunked(spots, 13, loadWeatherChunk);
  const loadMarine = (spots) => chunked(spots, 11, loadMarineChunk);

  async function loadWeatherChunk(spots) {
    const url = WX_URL + '?' + qs({
      latitude: spots.map((s) => s.lat.toFixed(3)).join(','),
      longitude: spots.map((s) => s.lon.toFixed(3)).join(','),
      hourly: WX_VARS.join(','),
      wind_speed_unit: 'ms', timezone: 'Asia/Tokyo', timeformat: 'unixtime',
      past_days: 3, forecast_days: 7
    });
    const arr = await getJSON(url);
    const out = {};
    arr.forEach((row, i) => {
      const h = row.hourly || {};
      out[spots[i].id] = {
        time: (h.time || []).map((t) => t * 1000),
        temp: h.temperature_2m, precip: h.precipitation, pressure: h.pressure_msl,
        cloud: h.cloud_cover, wind: h.wind_speed_10m, windDir: h.wind_direction_10m,
        gust: h.wind_gusts_10m, code: h.weather_code
      };
    });
    return out;
  }

  async function loadMarineChunk(spots) {
    const pts = spots.map(seaward);
    const url = MARINE_URL + '?' + qs({
      latitude: pts.map((p) => p.lat.toFixed(3)).join(','),
      longitude: pts.map((p) => p.lon.toFixed(3)).join(','),
      hourly: MARINE_VARS.join(','),
      timezone: 'Asia/Tokyo', timeformat: 'unixtime', past_days: 1, forecast_days: 7
    });
    const arr = await getJSON(url);
    const out = {};
    arr.forEach((row, i) => {
      const h = row.hourly || {};
      out[spots[i].id] = {
        time: (h.time || []).map((t) => t * 1000),
        wave: h.wave_height, waveDir: h.wave_direction, wavePeriod: h.wave_period,
        swell: h.swell_wave_height, sst: h.sea_surface_temperature
      };
    });
    return out;
  }

  /**
   * Load everything. Returns { wx, marine, fetchedAt, stale:{wx,marine} }.
   * Rejects only when there is neither fresh nor cached weather.
   */
  async function load(spots, { force = false } = {}) {
    const cache = readCache();
    if (!force && cache && Date.now() - cache.fetchedAt < TTL && cache.wx) {
      FH.diag.report('weather', { label: 'Open-Meteo Weather', state: 'ok', detail: 'キャッシュ使用（' + Math.round((Date.now() - cache.fetchedAt) / 60e3) + '分前）' });
      FH.diag.report('marine', { label: 'Open-Meteo Marine', state: cache.marine ? 'ok' : 'warn', detail: cache.marine ? 'キャッシュ使用' : 'データなし' });
      return Object.assign({}, cache, { stale: { wx: false, marine: false }, fromCache: true });
    }
    const seaSpots = spots.filter((s) => s.water === 'sea');
    const [wxR, mR] = await Promise.allSettled([
      FH.diag.track('weather', 'Open-Meteo Weather', async () => { const d = await loadWeather(spots); return Object.assign(d, { detail: (spots.length - (d._partial || 0)) + '/' + spots.length + '地点' }); }),
      FH.diag.track('marine', 'Open-Meteo Marine', async () => { const d = await loadMarine(seaSpots); return Object.assign(d, { detail: (seaSpots.length - (d._partial || 0)) + '/' + seaSpots.length + '地点' }); })
    ]);
    const strip = (o) => { if (o) { delete o.detail; delete o._partial; } return o; };
    const wx = wxR.status === 'fulfilled' ? strip(wxR.value) : (cache && cache.wx) || null;
    const marine = mR.status === 'fulfilled' ? strip(mR.value) : (cache && cache.marine) || null;
    if (!wx) throw new Error('気象データを取得できませんでした（キャッシュもありません）');
    const result = {
      wx, marine,
      fetchedAt: wxR.status === 'fulfilled' ? Date.now() : cache.fetchedAt,
      stale: { wx: wxR.status !== 'fulfilled', marine: mR.status !== 'fulfilled' }
    };
    if (wxR.status === 'fulfilled') writeCache({ wx, marine, fetchedAt: result.fetchedAt });
    if (result.stale.wx) FH.diag.report('weather', { state: 'warn', detail: '取得失敗 → キャッシュ使用' });
    if (result.stale.marine && marine) FH.diag.report('marine', { state: 'warn', detail: '取得失敗 → キャッシュ使用' });
    return result;
  }

  const WMO = {
    0: ['快晴', '☀'], 1: ['晴れ', '🌤'], 2: ['晴れ時々曇り', '⛅'], 3: ['曇り', '☁'],
    45: ['霧', '🌫'], 48: ['霧', '🌫'], 51: ['霧雨', '🌦'], 53: ['霧雨', '🌦'], 55: ['霧雨', '🌦'],
    61: ['小雨', '🌧'], 63: ['雨', '🌧'], 65: ['強い雨', '🌧'], 66: ['着氷性の雨', '🌧'], 67: ['着氷性の雨', '🌧'],
    71: ['小雪', '🌨'], 73: ['雪', '🌨'], 75: ['大雪', '❄'], 77: ['霧雪', '🌨'],
    80: ['にわか雨', '🌦'], 81: ['にわか雨', '🌧'], 82: ['激しいにわか雨', '⛈'],
    85: ['にわか雪', '🌨'], 86: ['強いにわか雪', '❄'], 95: ['雷雨', '⛈'], 96: ['雷雨・雹', '⛈'], 99: ['雷雨・雹', '⛈']
  };
  const weatherText = (code) => (WMO[code] || ['—', '·'])[0];
  const weatherIcon = (code) => (WMO[code] || ['—', '·'])[1];

  FH.weather = { load, weatherText, weatherIcon, readCache, CACHE_KEY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
