/* FishHunter — species silhouettes (inline SVG, tinted with the species colour).
 * FH.icons.fish(speciesId, { size, glow }) → '<svg …>' ; shapes are grouped by body plan.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  // viewBox 0 0 64 32, head to the right.
  const SHAPES = {
    torpedo: 'M2 16 L10 8 L12 14 C20 7 34 5 46 8 C54 10 60 13 62 16 C60 19 54 22 46 24 C34 27 20 25 12 18 L10 24 Z M28 8 L34 3 L38 8 M30 24 L35 28 L38 24',
    bream: 'M3 16 L10 7 L13 13 C18 4 30 1 42 3 C52 5 60 11 62 16 C60 22 52 28 42 29 C30 31 18 28 13 19 L10 25 Z M26 3 L32 0 L40 3',
    squid: 'M62 16 C60 9 52 6 40 7 L30 9 C26 5 22 5 20 8 C16 7 12 8 10 10 L2 6 L8 13 L1 16 L8 19 L2 26 L10 22 C12 24 16 25 20 24 C22 27 26 27 30 23 L40 25 C52 26 60 23 62 16 Z',
    flat: 'M3 16 C4 12 7 10 10 12 C16 6 30 4 44 6 C54 8 60 12 62 16 C60 20 54 24 44 26 C30 28 16 26 10 20 C7 22 4 20 3 16 Z',
    rock: 'M3 16 L9 9 L12 14 C16 9 22 6 30 5 L32 1 L36 5 L40 2 L43 6 C52 7 60 11 62 17 C60 23 52 27 40 27 C28 27 18 24 12 19 L9 24 Z',
    diamond: 'M4 16 L10 10 L13 14 C20 6 30 2 38 3 L42 0 L44 4 C52 7 60 12 62 16 C58 22 48 28 36 29 C26 30 18 24 13 18 L10 22 Z',
    trout: 'M2 16 L9 9 L12 14 C20 9 32 8 44 9 C54 10 60 13 62 16 C60 19 54 22 44 23 C32 24 20 23 12 18 L9 23 Z M22 9 L24 6 L27 9 M30 8 L35 4 L39 8',
    bass: 'M2 16 L9 8 L12 14 C18 8 28 6 38 6 C50 7 60 11 62 16 C60 21 52 25 40 26 C28 27 18 24 12 18 L9 24 Z M22 7 L26 2 L30 6 L33 3 L37 6',
    small: 'M4 16 L10 11 L12 15 C22 11 36 10 48 12 C56 13 61 15 62 16 C61 17 56 19 48 20 C36 22 22 21 12 17 L10 21 Z'
  };
  const BY_SPECIES = {
    aji: 'torpedo', saba: 'torpedo', inada: 'torpedo', sagoshi: 'torpedo', shiira: 'torpedo', seabass: 'torpedo',
    kurodai: 'bream', madai: 'bream', mejina: 'bream', aori: 'squid', hirame: 'flat', kasago: 'rock', kawahagi: 'diamond',
    sakuramasu: 'trout', yamame: 'trout', iwana: 'trout', niji: 'trout', bass: 'bass', kisu: 'small', wakasagi: 'small', ayu: 'small'
  };
  let uid = 0;
  function fish(spId, { size = 40, glow = false, cls = '' } = {}) {
    const sp = FH.speciesById && FH.speciesById[spId];
    const c = (sp && sp.color) || '#5de4ff';
    const d = SHAPES[BY_SPECIES[spId] || 'torpedo'];
    const id = 'fhg' + (++uid);
    const eye = BY_SPECIES[spId] === 'squid' ? '' : '<circle cx="54" cy="14" r="1.8" fill="rgba(4,17,28,.85)"/>';
    return `<svg class="fish-ico ${cls}" viewBox="0 0 64 32" width="${size}" height="${size / 2}" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".55"/></linearGradient></defs>
      <path d="${d}" fill="url(#${id})" stroke="${c}" stroke-width=".8" stroke-linejoin="round"${glow ? ` style="filter:drop-shadow(0 0 6px ${c})"` : ''}/>${eye}</svg>`;
  }
  FH.icons = { fish, shape: (id) => BY_SPECIES[id] || 'torpedo' };
})(typeof globalThis !== 'undefined' ? globalThis : this);
