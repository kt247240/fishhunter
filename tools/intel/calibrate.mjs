// FishHunter calibration: engine score → "how often was this fish actually caught on such a day".
// Rows come from the daybook (managed piers that report every open day): for each day and species,
// the day's peak condition score (05–17 JST, engine without evidence/personal extras) and whether the
// species was reported caught. A logistic curve per species, its slope shrunk toward the pooled slope
// so thin species don't overfit. In-sample (the season weights were also tuned on these logs) — the
// app says so.

const H = 3600e3;
const sig = (z) => 1 / (1 + Math.exp(-z));
const X = (score) => (score - 60) / 10;

/** Peak engine score over 05–17 JST of one day (null without weather). */
export function dayPeak(FH, spot, sp, day, data) {
  const E = FH.engine, t0 = Date.parse(day + 'T05:00:00+09:00');
  let best = null;
  for (let h = 0; h <= 12; h++) {
    const c = E.conditions(spot, t0 + h * H, data);
    if (!c.hasWx) continue;
    const s = E.score(spot, sp, c).score;
    if (best == null || s > best) best = s;
  }
  return best;
}

/** Fit p = σ(a + b·x) by gradient descent with L2 on (b − prior) and a weak prior on a. */
export function fitLogistic(rows, { prior = 0, lambda = 2, iters = 3000, lr = 0.1 } = {}) {
  let a = 0, b = prior;
  const n = rows.length || 1;
  for (let k = 0; k < iters; k++) {
    let ga = 0, gb = 0;
    for (const [x, y] of rows) { const e = sig(a + b * x) - y; ga += e; gb += e * x; }
    ga = ga / n + 0.01 * a / n; gb = gb / n + lambda * (b - prior) / n;
    a -= lr * ga; b -= lr * gb;
  }
  return { a, b };
}

/**
 * rows: [{ sp, score, caught }] → { pooled: {a, b, n}, species: { sp: {a, b, n, base, lo, hi} } }
 * lo/hi: score range seen in training (the app doesn't extrapolate beyond it).
 */
export function calibrate(rows) {
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const all = rows.map((r) => [X(r.score), r.caught ? 1 : 0]);
  const pooled = fitLogistic(all, { lambda: 0.01 });
  const species = {};
  for (const sp of [...new Set(rows.map((r) => r.sp))]) {
    const rs = rows.filter((r) => r.sp === sp);
    if (rs.length < 30) continue;
    const pos = rs.filter((r) => r.caught).length;
    if (!pos) continue;
    const f = fitLogistic(rs.map((r) => [X(r.score), r.caught ? 1 : 0]), { prior: pooled.b, lambda: 20 });
    const scores = rs.map((r) => r.score);
    species[sp] = { a: r4(f.a), b: r4(f.b), n: rs.length, base: r4(pos / rs.length), lo: Math.min(...scores), hi: Math.max(...scores) };
  }
  return { pooled: { a: r4(pooled.a), b: r4(pooled.b), n: rows.length }, species };
}

/** Probability for a species at a score (clamped to the trained score range), or null. */
export function probability(cal, sp, score) {
  const s = cal && cal.species && cal.species[sp];
  if (!s || score == null) return null;
  return sig(s.a + s.b * X(Math.max(s.lo, Math.min(s.hi, score))));
}
