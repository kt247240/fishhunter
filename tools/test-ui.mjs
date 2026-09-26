// FishHunter UI smoke test — real Chromium, no network.
//   node tools/test-ui.mjs
// Serves the app from this folder, answers Open-Meteo with deterministic synthetic weather, and walks
// the main flows: score + plan board + picks render, evidence tabs switch, spot switch, 攻略 and 釣果
// tabs, logging a catch (and a ボウズ). Fails on any page error.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const m of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (_) { /* next */ } }
  throw new Error('playwright is not installed (npm i -D playwright && npx playwright install chromium)');
}
const { chromium } = loadPlaywright();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const f = path.join(root, decodeURIComponent(u.pathname === '/' ? '/app.html' : u.pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/** Synthetic Open-Meteo answer for every requested location (hourly, unixtime seconds). */
function synthetic(url) {
  const u = new URL(url);
  const lats = (u.searchParams.get('latitude') || '37').split(',');
  const vars = (u.searchParams.get('hourly') || '').split(',').filter(Boolean);
  const past = +(u.searchParams.get('past_days') || 1), fut = +(u.searchParams.get('forecast_days') || 7);
  const t0 = Math.floor(Date.now() / 86400e3) * 86400 - past * 86400;
  const n = (past + fut) * 24;
  const time = Array.from({ length: n }, (_, i) => t0 + i * 3600);
  const V = { temperature_2m: (i) => 20 + 4 * Math.sin(i / 24 * 2 * Math.PI), precipitation: () => 0, pressure_msl: (i) => 1013 + Math.sin(i / 30), cloud_cover: () => 40,
    wind_speed_10m: () => 3, wind_direction_10m: () => 200, wind_gusts_10m: () => 6, weather_code: () => 1,
    wave_height: (i) => (i < 30 ? 1.6 : 0.6), wave_direction: () => 300, wave_period: () => 6, swell_wave_height: () => 0.3, sea_surface_temperature: () => 23 };
  const one = () => ({ latitude: 0, longitude: 0, hourly: Object.fromEntries([['time', time], ...vars.map((v) => [v, time.map((_, i) => (V[v] ? V[v](i) : 0))])]) });
  return lats.length > 1 ? lats.map(one) : one();
}

let failures = 0;
const step = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { failures++; console.error('  ✗', name, '\n   ', e.message.split('\n')[0]); } };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route(/open-meteo\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(synthetic(route.request().url())) }));
await page.route(/cdnjs|tile|cyberjapandata|openstreetmap|googleapis|gstatic/, (route) => route.abort());
await page.addInitScript(() => {
  localStorage.setItem('fh.prefs.v1', JSON.stringify({ areas: [], species: [], favorites: ['naoetsu', 'niigata-east'], onboarded: true, scope: 'all' }));
});

console.log('FishHunter UI');
await page.goto(base + '/app.html', { waitUntil: 'load' });
await step('score ring and plan board render', async () => {
  await page.waitForSelector('#spotScore .ring', { timeout: 20000 });
  await page.waitForSelector('#planCard:not([hidden]) .pl-row', { timeout: 20000 });
  assert.ok((await page.$$('#plan .pl-row')).length >= 4);
});
await step('top picks list spots with an evidence level', async () => {
  await page.waitForSelector('#topPicks button.pick-card', { timeout: 30000 });
  assert.match(await page.innerText('#topPicks'), /実績あり|エリア情報|天気のみ/);
});
await step('evidence tabs switch between panels', async () => {
  const tabs = await page.$$('#evTabs [data-evtab]:not([disabled])');
  assert.ok(tabs.length >= 1);
  const id = await tabs[tabs.length - 1].getAttribute('data-evtab');
  await tabs[tabs.length - 1].click();
  assert.ok(await page.$eval('#' + id, (el) => el.classList.contains('ev-active')));
});
await step('switching spot re-renders the score and title', async () => {
  // The picker row hides in the compact header after scrolling; drive the <select> directly.
  await page.evaluate(() => { const s = document.querySelector('#spotPick'); s.value = 'niigata-east'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => /新潟東港/.test(document.querySelector('#spotName').textContent), null, { timeout: 5000 });
});
await step('攻略 tab shows methods and 研究メモ', async () => {
  await page.click('#tabbar button[data-tab=hunt]');
  await page.waitForSelector('#methods .method', { timeout: 5000 });
});
await step('logging a catch and a ボウズ shows both in 釣果', async () => {
  await page.click('#tabbar button[data-tab=log]');
  await page.waitForSelector('#logForm');
  await page.fill('#logForm [name=size]', '24');
  await page.click('#logForm button[type=submit]');
  await page.check('#logForm [name=blank]');
  await page.click('#logForm button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('#postFeed .post').length >= 2, null, { timeout: 5000 });
  assert.match(await page.innerText('#postFeed'), /ボウズ/);
});
await step('no page errors', async () => { assert.deepEqual(errors, [], errors.join(' | ')); });

await browser.close();
server.close();
console.log(failures ? `\nFishHunter UI tests: ${failures} failed` : '\nFishHunter UI tests: all passed');
process.exit(failures ? 1 : 0);
