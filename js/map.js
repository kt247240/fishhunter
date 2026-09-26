/* FishHunter — spot map (Leaflet, lazy-loaded from cdnjs with SRI).
 * Core UI never depends on this: if the CDN or tiles fail, the ranking list
 * and spot facts keep working and the map area shows a fallback message.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const SRI = {
    js: 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==',
    css: 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw=='
  };
  let loading = null;
  let map = null;
  let markers = new Map();
  let userMarker = null;

  function loadLeaflet() {
    if (g.L) return Promise.resolve(true);
    if (loading) return loading;
    loading = FH.diag.track('map', '地図ライブラリ', () => new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = CDN + 'leaflet.min.css'; css.integrity = SRI.css; css.crossOrigin = 'anonymous';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = CDN + 'leaflet.min.js'; s.integrity = SRI.js; s.crossOrigin = 'anonymous'; s.async = true;
      const timer = setTimeout(() => reject(new Error('タイムアウト')), 10000);
      s.onload = () => { clearTimeout(timer); resolve({ detail: 'Leaflet 1.9.4' }); };
      s.onerror = () => { clearTimeout(timer); s.remove(); css.remove(); reject(new Error('CDN読込失敗')); };
      document.head.appendChild(s);
    })).then(() => true).catch(() => { loading = null; return false; });
    return loading;
  }

  let ensuring = null;
  function ensure(el) {
    if (map) return Promise.resolve(true);
    if (!ensuring) ensuring = create(el).finally(() => { ensuring = null; });
    return ensuring;
  }
  async function create(el) {
    let ok = await loadLeaflet();
    if (!ok) { await new Promise((r) => setTimeout(r, 1500)); ok = await loadLeaflet(); }
    if (!ok || !g.L) {
      el.innerHTML = '<div class="map-fallback"><div>地図を読み込めませんでした（オフライン／CDN不通）。<br>ランキングとカルテはこのまま使えます。<br><br><button class="btn sm" type="button" data-map-retry>再試行</button></div></div>';
      return false;
    }
    el.innerHTML = '';
    const L = g.L;
    const pale = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxZoom: 18, className: 'tiles-pale',
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>'
    });
    const photo = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', {
      maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（写真）</a>'
    });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    });
    map = L.map(el, { zoomControl: true, attributionControl: true, layers: [pale] }).setView([37.0, 138.4], 7);
    L.control.layers({ '淡色地図': pale, '航空写真': photo, 'OSM': osm }, null, { position: 'topright' }).addTo(map);
    pale.on('tileerror', () => FH.diag.report('tiles', { label: '地図タイル', state: 'warn', detail: '一部タイル取得失敗' }));
    pale.once('load', () => FH.diag.report('tiles', { label: '地図タイル', state: 'ok', detail: '国土地理院' }));
    return true;
  }

  /** items: [{spot, score, label}] ; selectedId ; onSelect(spotId) */
  function render(items, selectedId, onSelect, fit) {
    if (!map || !g.L) return;
    const L = g.L;
    const keep = new Set();
    items.forEach(({ spot, score, label }) => {
      keep.add(spot.id);
      const t = score == null ? 'bad' : FH.ui.tone(score);
      const html = `<div class="fh-marker tone-${t}${spot.id === selectedId ? ' sel' : ''}${score == null ? ' off' : ''}">${score == null ? '·' : score}</div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
      let m = markers.get(spot.id);
      if (!m) {
        m = L.marker([spot.lat, spot.lon], { icon, title: spot.name, riseOnHover: true }).addTo(map);
        m.on('click', () => onSelect(spot.id));
        markers.set(spot.id, m);
      } else m.setIcon(icon);
      m.setZIndexOffset(spot.id === selectedId ? 1000 : score || 0);
      m.bindTooltip(`<b>${FH.ui.esc(spot.name)}</b><br>${FH.ui.esc(label || '')}`, { direction: 'top', offset: [0, -14] });
    });
    for (const [id, m] of markers) if (!keep.has(id)) { map.removeLayer(m); markers.delete(id); }
    if (fit && items.length) map.fitBounds(L.latLngBounds(items.map((i) => [i.spot.lat, i.spot.lon])).pad(0.15));
  }

  function focus(spot, zoom = 11) { if (map && spot) map.flyTo([spot.lat, spot.lon], Math.max(map.getZoom(), zoom), { duration: 0.6 }); }
  function showUser(pos) {
    if (!map || !g.L || !pos) return;
    if (userMarker) userMarker.setLatLng([pos.lat, pos.lon]);
    else userMarker = g.L.circleMarker([pos.lat, pos.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#5de4ff', fillOpacity: 1 }).addTo(map).bindTooltip('現在地');
  }
  function invalidate() { if (map) setTimeout(() => map.invalidateSize(), 60); }

  /* ───────── wind particle layer (idea from cambecc/earth; own implementation) ─────────
   * Sparse spot winds → IDW-interpolated screen-space grid → ~700 fading particle trails.
   * Paused while panning/zooming, when hidden, and under prefers-reduced-motion. */
  const wind = { on: false, points: [], cv: null, ctx: null, grid: null, parts: [], raf: 0, cell: 28 };
  const reduceMotion = () => !!(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function windCanvas() {
    if (wind.cv || !map) return;
    const el = map.getContainer();
    wind.cv = document.createElement('canvas');
    wind.cv.className = 'wind-layer';
    el.appendChild(wind.cv);
    wind.ctx = wind.cv.getContext('2d');
    map.on('movestart zoomstart', () => { stopWind(); clearWind(); });
    map.on('moveend zoomend resize', () => { if (wind.on) startWind(); });
  }
  function clearWind() { if (wind.ctx) wind.ctx.clearRect(0, 0, wind.cv.width, wind.cv.height); }
  function stopWind() { cancelAnimationFrame(wind.raf); wind.raf = 0; }

  function buildGrid() {
    const size = map.getSize();
    const dpr = Math.min(2, g.devicePixelRatio || 1);
    wind.cv.width = size.x * dpr; wind.cv.height = size.y * dpr;
    wind.cv.style.width = size.x + 'px'; wind.cv.style.height = size.y + 'px';
    wind.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.ceil(size.x / wind.cell) + 1, rows = Math.ceil(size.y / wind.cell) + 1;
    const grid = new Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const ll = map.containerPointToLatLng([i * wind.cell, j * wind.cell]);
      let su = 0, sv = 0, sw = 0;
      for (const p of wind.points) {
        const d2 = (p.lat - ll.lat) ** 2 + ((p.lon - ll.lng) * 0.8) ** 2 + 1e-4;
        const w = 1 / (d2 * d2);
        su += p.u * w; sv += p.v * w; sw += w;
      }
      const k = 0.22; // m/s → px/frame
      grid[j * cols + i] = sw ? [su / sw * k, -sv / sw * k] : [0, 0];
    }
    wind.grid = { cols, rows, data: grid, w: size.x, h: size.y };
    wind.parts = Array.from({ length: Math.min(900, Math.round(size.x * size.y / 520)) }, () => spawn());
  }
  function spawn() { return { x: Math.random() * wind.grid.w, y: Math.random() * wind.grid.h, age: Math.floor(Math.random() * 80) }; }
  function vec(x, y) {
    const G = wind.grid;
    const i = Math.max(0, Math.min(G.cols - 1, Math.round(x / wind.cell))), j = Math.max(0, Math.min(G.rows - 1, Math.round(y / wind.cell)));
    return G.data[j * G.cols + i];
  }
  function frame() {
    if (!wind.on || document.hidden || !map.getContainer().offsetParent) { wind.raf = requestAnimationFrame(frame); return; }
    const c = wind.ctx, G = wind.grid;
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = 'rgba(0,0,0,0.93)'; c.fillRect(0, 0, G.w, G.h);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,70,110,.75)' : 'rgba(235,250,255,.9)';
    c.lineWidth = 1.5; c.beginPath();
    for (const p of wind.parts) {
      const [dx, dy] = vec(p.x, p.y);
      const nx = p.x + dx, ny = p.y + dy;
      if (++p.age > 90 || nx < 0 || ny < 0 || nx > G.w || ny > G.h || (Math.abs(dx) + Math.abs(dy) < 0.02)) { Object.assign(p, spawn(), { age: 0 }); continue; }
      c.moveTo(p.x, p.y); c.lineTo(nx, ny);
      p.x = nx; p.y = ny;
    }
    c.stroke();
    wind.raf = requestAnimationFrame(frame);
  }
  function startWind() {
    if (!map || !wind.on || !wind.points.length) return;
    windCanvas(); stopWind(); buildGrid(); clearWind();
    if (reduceMotion()) return;
    wind.raf = requestAnimationFrame(frame);
  }
  /** points: [{lat, lon, speed (m/s), dir (deg, meteorological "from")}] */
  function setWind(points) {
    wind.points = (points || []).filter((p) => p.speed != null && p.dir != null).map((p) => {
      const to = ((p.dir + 180) * Math.PI) / 180;
      return { lat: p.lat, lon: p.lon, u: p.speed * Math.sin(to), v: p.speed * Math.cos(to) };
    });
    if (wind.on) startWind();
  }
  function showWind(on) {
    wind.on = !!on;
    if (!map) return;
    windCanvas();
    if (wind.on) startWind(); else { stopWind(); clearWind(); }
  }

  FH.map = { ensure, render, focus, showUser, invalidate, setWind, showWind, windOn: () => wind.on, ready: () => !!map };
})(typeof globalThis !== 'undefined' ? globalThis : this);
