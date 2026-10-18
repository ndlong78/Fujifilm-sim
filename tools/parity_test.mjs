// Checks tools/simmodel.py against the real WebGL shader, pixel by pixel, for every film simulation.
// Usage: node tools/parity_test.mjs   (needs the `playwright` package and python3 with numpy)
// Renders the built-in sample chart, reads the GPU output with the split handle at each edge
// (all-original / all-processed), then runs the Python model on the same input.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'film-sim-lab.html'), 'utf8');
const SIMS = new Function(html.slice(html.indexOf('const SIMS = ['), html.indexOf('const SIM = Object')) + 'return SIMS;')();
const STRIDE = 3;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('file://' + join(root, 'index.html'));
await page.waitForTimeout(1000);
await page.click('#btnReset');
const box = await page.locator('#frame').boundingBox();
const setEdge = right => page.mouse.click(right ? box.x + box.width - 1 : box.x + 1, box.y + box.height / 2);
const grab = () => page.evaluate(stride => {
  const c = document.getElementById('gl'), g = c.getContext('webgl');
  const a = new Uint8Array(c.width * c.height * 4);
  g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, a);
  const out = [];
  for (let y = 2; y < c.height - 2; y += stride) for (let x = 4; x < c.width - 4; x += stride) {
    const o = (y * c.width + x) * 4; out.push(a[o], a[o + 1], a[o + 2]);
  }
  return out;
}, STRIDE);

const dir = mkdtempSync(join(tmpdir(), 'fsl-parity-'));
await setEdge(true); await page.waitForTimeout(150);
writeFileSync(join(dir, 'input.json'), JSON.stringify(await grab()));
const cases = [];
for (const s of SIMS) {
  const filters = s.filters ? ['std', 'r'] : ['std'];
  for (const f of filters) {
    await page.click('#sim-' + s.id);
    if (s.filters) await page.click(`#seg-filter-${f}`);
    await setEdge(false); await page.waitForTimeout(150);
    const file = `${s.id}-${f}.json`;
    writeFileSync(join(dir, file), JSON.stringify(await grab()));
    cases.push({ sim: s, filter: f, file });
    await setEdge(true);
  }
}
await browser.close();
writeFileSync(join(dir, 'cases.json'), JSON.stringify(cases));

const py = `
import json, sys, numpy as np
sys.path.insert(0, ${JSON.stringify(join(root, 'tools'))})
from simmodel import render
d = ${JSON.stringify(dir)}
inp = np.array(json.load(open(d + '/input.json')), float).reshape(-1, 3) / 255
worst = 0
# Pass rule: at most 0.1% of pixels off by more than 2 levels. The few outliers are extreme blues at the
# gamut boundary, where float32 cbrt on the GPU flips a bisection step. Acros carries built-in grain (noise),
# so its error is measured but not judged by the same rule.
for c in json.load(open(d + '/cases.json')):
    gpu = np.array(json.load(open(d + '/' + c['file'])), float).reshape(-1, 3)
    cpu = np.round(render(inp, c['sim'], c['filter']) * 255)
    diff = np.abs(gpu - cpu)
    over = (diff.max(1) > 2).mean() * 100
    if not c['sim'].get('grainBase'): worst = max(worst, over)
    print(f"{c['sim']['id'] + '/' + c['filter']:14s} max {diff.max():3.0f}  mean {diff.mean():.3f}  >2 levels: {over:.3f}%")
print(f'worst share of pixels >2 levels: {worst:.3f}%  ->', 'PASS' if worst <= 0.1 else 'FAIL')
sys.exit(0 if worst <= 0.1 else 1)
`;
execFileSync('python3', ['-c', py], { stdio: 'inherit' });
