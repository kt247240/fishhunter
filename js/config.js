/* FishHunter — public runtime configuration.
 * The Supabase URL and anon key are PUBLIC by design (they ship in every
 * client); access is controlled by Row Level Security in
 * tools/community/schema.sql. Leave empty to disable community posting. */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  FH.config = Object.assign({
    supabaseUrl: '',
    supabaseAnonKey: '',
    // Operator contact shown on privacy.html (required by app stores / Meta review).
    contactEmail: ''
  }, FH.config || {});
})(typeof globalThis !== 'undefined' ? globalThis : this);
