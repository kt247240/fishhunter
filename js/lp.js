/* FishHunter landing page: live scene (astronomy only, no network) and
 * coverage lists generated from the same knowledge base as the app. */
(function (g) {
  'use strict';
  const FH = g.FH;
  const esc = FH.ui.esc;
  document.getElementById('nSpots').textContent = FH.SPOTS.length;
  document.getElementById('nSpecies').textContent = FH.SPECIES.length;
  document.getElementById('areaChips').innerHTML = FH.AREAS.map((a) => {
    const n = FH.SPOTS.filter((s) => s.area === a);
    return n.length ? `<span class="chip">${esc(n[0].pref)}・${esc(a)} <b>${n.length}</b></span>` : '';
  }).join('');
  document.getElementById('speciesChips').innerHTML = FH.SPECIES.map((s) => `<span class="chip dot" style="--c:${s.color}">${esc(s.name)}</span>`).join('');

  let t = null;
  try {
    const v = new URLSearchParams(location.search).get('t');
    if (v) { const p = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + '+09:00'); if (isFinite(p)) t = p; }
  } catch (_) { /* ignore */ }

  const spot = FH.spotById.naoetsu;
  const scene = FH.scene.create(document.getElementById('scene'), document.getElementById('sceneUi'));
  const paint = () => {
    const now = t || Date.now();
    const cond = FH.engine.conditions(spot, now, null);
    scene.update({ spot, species: FH.speciesById.aori, cond: Object.assign({}, cond, { wave: 0.5, cloud: 20 }), score: null, t: now });
  };
  paint();
  if (!t) setInterval(paint, 5 * 60e3);
})(typeof globalThis !== 'undefined' ? globalThis : this);
