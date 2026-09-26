import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const lp = fs.readFileSync(path.join(root, 'index.html'), 'utf8') + fs.readFileSync(path.join(root, 'ops.html'), 'utf8');
const fail = (...m) => { console.error(...m); process.exit(1); };

// 1. Every local asset referenced by app.html exists.
const refs = [...(html + lp).matchAll(/<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"/gi)].map((m) => m[1]);
const missing = refs.filter((r) => !/^(?:https?:|data:|#)/.test(r) && !fs.existsSync(path.join(root, r.split('?')[0])));
if (missing.length) fail('Missing assets:', missing);

// 2. Every JS module parses.
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f).concat('sw.js');
for (const p of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, p)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

// 3. Every module in js/ is loaded by app.html and cached by the service worker.
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
for (const p of jsFiles.filter((f) => f.startsWith('js/'))) {
  const viaWorker = jsFiles.some((f) => fs.readFileSync(path.join(root, f), 'utf8').includes(`new Worker('${p}')`));
  if (!html.includes(`src="${p}"`) && !lp.includes(`src="${p}"`) && !viaWorker) fail('Module not loaded by app.html / index.html / ops.html / a Worker:', p);
  if (!sw.includes(`'${p}'`)) fail('Module missing from sw.js SHELL:', p);
}

// 3b. Every file the service worker pre-caches exists.
const shell = [...sw.matchAll(/'([^'\s]+\.(?:html|css|js|webp|svg|webmanifest))'/g)].map((m) => m[1]);
const swMissing = shell.filter((f) => !fs.existsSync(path.join(root, f)));
if (swMissing.length) fail('sw.js caches missing files:', swMissing);

// 4. Stability rules from README.
if (/document\.write\s*\(/.test(html + jsFiles.map((p) => fs.readFileSync(path.join(root, p), 'utf8')).join('\n'))) fail('document.write() is forbidden');

// 5. DOM contract.
const requiredIds = ['spotPick', 'spotName', 'spotScore', 'facts', 'huntTarget', 'huntScore', 'chart', 'postFeed', 'fieldNow', 'systemDiag',
  'topPicks', 'factors', 'windows', 'tactics', 'rankList', 'map', 'logForm', 'analysis'];
for (const id of requiredIds) if (!html.includes(`id="${id}"`)) fail('Missing DOM id:', id);

// 6. Manifest is valid JSON.
JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));

console.log('FishHunter static validation: OK');
