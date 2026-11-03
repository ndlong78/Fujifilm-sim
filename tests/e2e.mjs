// End-to-end tests for index.html in headless Chromium (WebGL via SwiftShader).
// Usage: node tests/e2e.mjs   (needs the `playwright` package and python3; run ./build.sh first)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'file://' + join(root, 'index.html');
const tmp = mkdtempSync(join(tmpdir(), 'fsl-e2e-'));
const html = readFileSync(join(root, 'film-sim-lab.html'), 'utf8');
const between = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
const { SIMS, PRESETS, CONTROLS } = new Function(between('const SIMS = [', 'let R = ') + 'return { SIMS, PRESETS, CONTROLS };')();

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

// ---- static: every preset uses a real sim and values its controls can show
{
  const lim = {};
  for (const list of Object.values(CONTROLS)) for (const s of list)
    lim[s[1]] = s[0] === 'range' ? { min: s[3], max: s[4], step: s[5] } : { opts: s[3].map(o => String(o[0])) };
  const bad = [];
  for (const p of PRESETS) {
    if (!SIMS.some(s => s.id === p.sim)) bad.push(`${p.name}: sim ${p.sim}`);
    for (const [k, v] of Object.entries(p)) {
      const L = lim[k];
      if (!L) continue;
      const off = L.opts ? !L.opts.includes(String(v))
        : v < L.min || v > L.max || Math.abs((v - L.min) / L.step - Math.round((v - L.min) / L.step)) > 1e-9;
      if (off) bad.push(`${p.name}: ${k}=${v}`);
    }
  }
  check(`${PRESETS.length} presets within control ranges`, !bad.length, bad.join('; '));
}

// ---- test LUTs
const writeCube = (name, f, n = 17) => {
  const L = [`TITLE "${name}"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++)
    L.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).map(v => v.toFixed(6)).join(' '));
  const file = join(tmp, name + '.cube');
  writeFileSync(file, L.join('\n') + '\n');
  return file;
};
const identityCube = writeCube('identity', (r, g, b) => [r, g, b]);
const invertCube = writeCube('invert', (r, g, b) => [1 - r, 1 - g, 1 - b]);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async (opts = {}) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(url);
  await page.waitForTimeout(1000);
  return page;
};
// every 3rd pixel, skipping 4px at the edges (the split line sits on an edge when dragged fully across)
const pixels = page => page.evaluate(() => {
  const c = document.getElementById('gl'), g = c.getContext('webgl'), a = new Uint8Array(c.width * c.height * 4);
  g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, a);
  const out = [];
  for (let y = 4; y < c.height - 4; y += 3) for (let x = 4; x < c.width - 4; x += 3) {
    const o = (y * c.width + x) * 4; out.push(a[o], a[o + 1], a[o + 2], 255);
  }
  return { data: out };
});
const setRange = async (page, id, v) => { await page.fill('#' + id, String(v)); await page.dispatchEvent('#' + id, 'input'); };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

const page = await open();
const box = await page.locator('#frame').boundingBox();
const splitTo = right => page.mouse.click(right ? box.x + box.width - 1 : box.x + 1, box.y + box.height / 2);

// ---- boot and presets
check('sample chart renders', (await page.$eval('#gl', c => c.width)) === 1800);
for (const id of await page.$$eval('[id^="preset-"]', e => e.map(x => x.id))) await page.click('#' + id);
check('every preset applies', true, `${PRESETS.length} clicked`);

// ---- LUT import (float path where available)
await page.click('#btnReset'); await splitTo(false); await page.waitForTimeout(150);
const base = (await pixels(page)).data;
await page.setInputFiles('#lutFile', identityCube); await page.waitForTimeout(300);
check('identity LUT leaves the image unchanged', maxDiff(base, (await pixels(page)).data) <= 1, await page.textContent('#lutInfo'));
await page.setInputFiles('#lutFile', invertCube); await page.waitForTimeout(300);
const inv = (await pixels(page)).data;
const invDiff = maxDiff(base.map((v, i) => i % 4 === 3 ? v : 255 - v), inv);
check('invert LUT inverts', invDiff <= 1, `max diff ${invDiff}`);
await page.click('#btnLutOff');

// ---- JSON import clamps to camera ranges
await page.fill('#jsonIn', JSON.stringify({ name: 'T', sim: 'velvia', drp: 'weak', hl: 9, ev: 2.4, grain: 5 }));
await page.click('#btnJsonLoad'); await page.waitForTimeout(150);
const card = await page.textContent('#card');
check('JSON import validates values', card.includes('D-Range Priority: Weak') && card.includes('Exposure Compensation: +2/3') && card.includes('Grain Effect: Off'));
await page.fill('#jsonIn', '{bad'); await page.click('#btnJsonLoad');
check('bad JSON is reported', (await page.textContent('#toast')).startsWith('JSON không hợp lệ'));

// ---- D-Range Priority Auto ≡ DR200 + Highlight −1 + Shadow −1 (Fuji X Weekly's X-Trans V finding)
await page.click('#btnReset'); await splitTo(false);
await page.click('#seg-drp-auto'); await page.waitForTimeout(150);
const drpAuto = (await pixels(page)).data;
check('DR-P hides DR and tone curve', await page.$eval('#in-hl', e => e.closest('.row').hidden));
await page.click('#seg-drp-off'); await page.click('#seg-dr-200');
await setRange(page, 'in-hl', -1); await setRange(page, 'in-sh', -1); await page.waitForTimeout(150);
check('DR-P Auto equals DR200 H-1 S-1', maxDiff(drpAuto, (await pixels(page)).data) === 0);

// ---- .cube export reproduces the recipe: apply the exported LUT to the input and compare with the render
await page.click('#preset-' + PRESETS.findIndex(p => p.name === 'Kodachrome 64 (X-Trans V)'));
await page.click('#seg-grain-0'); await setRange(page, 'in-sharp', 0); await setRange(page, 'in-clarity', 0);
await splitTo(true); await page.waitForTimeout(150);
const input = await pixels(page);
await splitTo(false); await page.waitForTimeout(150);
const output = (await pixels(page)).data;
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnCube')]);
const cubePath = join(tmp, 'export.cube');
await download.saveAs(cubePath);
const cubeTextOut = readFileSync(cubePath, 'utf8');
const n = +cubeTextOut.match(/LUT_3D_SIZE (\d+)/)[1];
const vals = cubeTextOut.split('\n').filter(l => /^[\d.-]+ [\d.-]+ [\d.-]+$/.test(l)).map(l => l.split(' ').map(Number));
check('.cube file is complete', vals.length === n ** 3 && download.suggestedFilename().endsWith('.cube'), `${download.suggestedFilename()}, ${n}³`);
const at = (r, g, b) => vals[r + g * n + b * n * n];
const errs = [];
for (let i = 0; i < input.data.length; i += 4) {
  const c = [0, 1, 2].map(k => input.data[i + k] / 255 * (n - 1));
  const i0 = c.map(Math.floor).map(v => Math.min(v, n - 2)), f = c.map((v, k) => v - i0[k]);
  for (let ch = 0; ch < 3; ch++) {
    let v = 0;
    for (const dr of [0, 1]) for (const dg of [0, 1]) for (const db of [0, 1])
      v += at(i0[0] + dr, i0[1] + dg, i0[2] + db)[ch] * (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
    errs.push(Math.abs(v * 255 - output[i + ch]));
  }
}
errs.sort((a, b) => a - b);
const mean = errs.reduce((a, b) => a + b, 0) / errs.length, p99 = errs[Math.floor(errs.length * 0.99)];
check('.cube matches the live render', mean < 1.5 && p99 < 6, `mean ${mean.toFixed(2)}, p99 ${p99.toFixed(1)} levels`);

// ---- preset search (accent-insensitive) and share link round trip
await page.fill('#presetSearch', 'ha noi'); await page.dispatchEvent('#presetSearch', 'input');
const visible = () => page.$$eval('.preset[id^="preset-"]', e => e.filter(b => !(b.closest('.item') || b).hidden).map(b => b.querySelector('b').textContent));
const hn = await visible();
check('search folds accents', hn.length === 1 && hn[0] === 'Hà Nội Mùa Đông', hn.join(', '));
await page.fill('#presetSearch', 'classic neg dr-p'); await page.dispatchEvent('#presetSearch', 'input');
const cnDrp = await visible();
check('search combines words', cnDrp.length === 2 && await page.$eval('#drpHead', h => !h.hidden), cnDrp.join(', '));
await page.fill('#presetSearch', 'zzz'); await page.dispatchEvent('#presetSearch', 'input');
check('empty search result is explained', !(await page.$eval('#presetNone', e => e.hidden)) && (await page.textContent('#presetCount')) === '0/' + PRESETS.length);
await page.fill('#presetSearch', ''); await page.dispatchEvent('#presetSearch', 'input');

await page.click('#preset-' + PRESETS.findIndex(p => p.name === 'Pacific Blues (X-Trans V)'));
await setRange(page, 'in-wbR', 3);                 // a modified recipe, not just a preset
const sharedCard = (await page.textContent('#card')).split('\n').slice(0, 12).join('\n');
await page.click('#btnShare');
const link = await page.inputValue('#shareUrl');
const fresh = await open();
await fresh.goto(link.replace(/^https?:\/\/[^#]+/, url)); await fresh.waitForTimeout(800);
const openedCard = (await fresh.textContent('#card')).split('\n').slice(0, 12).join('\n');
check('share link restores the recipe', link.includes('#r=') && openedCard === sharedCard, `${link.length} chars`);
await fresh.close();

// ---- JPEG export
await page.click('#btnExport'); await page.waitForTimeout(1200);
check('JPEG export opens', !(await page.$eval('#modal', m => m.hidden)), await page.textContent('#expInfo'));
await page.click('#btnClose');
check('no console errors (desktop)', !page.errors.length, page.errors.join(' | '));

// ---- inside the Claude artifact viewer: .cube is wrapped in a .zip and saved through `downloads`
const viewer = await open({
  init: () => {
    window.claude = { use: async name => name !== 'downloads' ? null : {
      save: async ({ filename, data }) => { window.__saved = { filename, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) }; return { status: 'saved' }; },
    } };
  },
});
await viewer.click('#btnCube'); await viewer.waitForTimeout(800);
const saved = await viewer.evaluate(() => window.__saved);
const zipPath = join(tmp, 'export.zip');
writeFileSync(zipPath, Buffer.from(saved?.bytes || []));
let zipInfo = '';
try {
  zipInfo = execFileSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; i=z.infolist()[0]; print(i.filename, len(z.read(i)))', zipPath]).toString().trim();
} catch (e) { zipInfo = String(e.stderr || e); }
check('viewer saves a valid .zip holding the .cube', saved?.filename?.endsWith('.zip') && /\.cube \d+$/.test(zipInfo), `${saved?.filename} → ${zipInfo}`);
check('no console errors (viewer)', !viewer.errors.length, viewer.errors.join(' | '));

// ---- phone width: nothing scrolls sideways
const phone = await open({ viewport: { width: 400, height: 860 } });
check('no horizontal scroll at 400px', (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 400);

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
