// FishHunter forecast skill: how far the N-days-ahead forecast drifted from the final (day-0) run.
// Open-Meteo Previous Runs (weather) and the marine API's *_previous_dayN variables let us measure it
// for the last ~3 months at once. The day-0 run stands in for "what happened" (no buoy/AMeDAS here),
// so this is forecast drift, reported as such in the app.

const H = 3600e3;
export const LEADS = [1, 2, 3, 5];

/** Hourly {time[], [var]: []} → { 'YYYY-MM-DD': max over 05–17 JST } (days with ≥10 hours only). */
export function dailyMax(hourly, key) {
  const o = {};
  (hourly.time || []).forEach((t, i) => {
    const d = new Date(t + 9 * H), h = d.getUTCHours();
    const v = (hourly[key] || [])[i];
    if (h < 5 || h > 17 || v == null) return;
    (o[d.toISOString().slice(0, 10)] ||= []).push(v);
  });
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v.length >= 10).map(([k, v]) => [k, Math.max(...v)]));
}

/** { bias, mae, n } of forecast − final over shared days (null below 10 days). */
export function drift(final, forecast) {
  const ks = Object.keys(forecast).filter((k) => final[k] != null);
  if (ks.length < 10) return null;
  const e = ks.map((k) => forecast[k] - final[k]);
  const r2 = (x) => Math.round(x * 100) / 100;
  return { bias: r2(e.reduce((a, b) => a + b, 0) / e.length), mae: r2(e.reduce((a, b) => a + Math.abs(b), 0) / e.length), n: ks.length };
}

/** hourly: merged hourly block with base keys and base_previous_dayN keys. */
export function skillFor(hourly, base) {
  const fin = dailyMax(hourly, base);
  const out = {};
  for (const L of LEADS) { const d = drift(fin, dailyMax(hourly, `${base}_previous_day${L}`)); if (d) out[L] = d; }
  return out;
}
