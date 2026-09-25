/* FishHunter — service health registry.
 * Every external dependency reports here; the UI renders it in #systemDiag.
 */
(function (g) {
  'use strict';
  const FH = (g.FH = g.FH || {});
  const services = new Map();
  const listeners = new Set();
  const log = [];

  function report(id, info) {
    const prev = services.get(id) || {};
    const next = Object.assign({ id, label: id }, prev, info, { at: Date.now() });
    services.set(id, next);
    log.unshift({ id, ok: next.state === 'ok', state: next.state, detail: next.detail || '', at: next.at });
    if (log.length > 40) log.length = 40;
    listeners.forEach((fn) => { try { fn(next); } catch (_) { /* listener isolation */ } });
  }

  /** Wrap an async call with timing + state reporting. Never throws the timing itself. */
  async function track(id, label, fn) {
    const t0 = (g.performance || Date).now();
    report(id, { label, state: 'loading', detail: '接続中…' });
    try {
      const r = await fn();
      const ms = Math.round((g.performance || Date).now() - t0);
      report(id, { label, state: 'ok', ms, detail: (r && r.detail) || 'OK' });
      return r;
    } catch (e) {
      const ms = Math.round((g.performance || Date).now() - t0);
      report(id, { label, state: 'error', ms, detail: String((e && e.message) || e) });
      throw e;
    }
  }

  async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('タイムアウト (' + timeoutMs / 1000 + 's)');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function environment() {
    const n = g.navigator || {};
    return {
      online: n.onLine !== false,
      sw: !!(n.serviceWorker && n.serviceWorker.controller),
      storage: (() => { try { const k = '__fh'; g.localStorage.setItem(k, '1'); g.localStorage.removeItem(k); return true; } catch (_) { return false; } })(),
      standalone: !!(g.matchMedia && g.matchMedia('(display-mode: standalone)').matches)
    };
  }

  FH.diag = {
    report, track, fetchWithTimeout, environment,
    all: () => [...services.values()],
    log: () => log.slice(),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
  // Legacy global name referenced by the project README.
  g.FishHunterDiagnostics = FH.diag;
})(typeof globalThis !== 'undefined' ? globalThis : this);
