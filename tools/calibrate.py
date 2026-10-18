#!/usr/bin/env python3
"""Fit one Film Sim Lab simulation to a real Fujifilm camera pair.

Shoot ONE RAW frame, then use in-camera RAW conversion (or X RAW STUDIO) to export two JPEGs with
identical settings: DR100, WB fixed (not Auto), Highlight/Shadow/Color 0, Color Chrome Off,
Sharpness/Clarity 0, Grain Off, Noise Reduction anything.
  base.jpg   - PROVIA/STANDARD   (the app treats its input photo as a standard rendering)
  target.jpg - the simulation to fit
Scenes with many saturated colours (a ColorChecker, flowers, signage) constrain all six hue sectors.

  python3 tools/calibrate.py base.jpg target.jpg --sim cc            # refine Classic Chrome
  python3 tools/calibrate.py base.jpg acros_r.jpg --sim acros --filter r

Prints error before/after (OKLab distance x100, about 1 = just noticeable) and a SIMS entry to paste
into film-sim-lab.html, then run ./build.sh and node tools/parity_test.mjs.
"""
import argparse
import json
import pathlib
import subprocess
import sys

import numpy as np
from scipy.optimize import least_squares

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from simmodel import render, srgb_to_oklab, SECTOR_HUES  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent

COLOR_KEYS = [('sat', 1, 0.3, 1.6), ('con', 1, -1.0, 1.0), ('hl', 1, -3.0, 3.0), ('sh', 1, -3.0, 3.0),
              ('gam', 1, 0.8, 1.25), ('lift', 1, 0.0, 0.08), ('hue', 6, -25.0, 25.0), ('satS', 6, 0.4, 1.6),
              ('lumS', 6, 0.7, 1.3), ('tS', 2, -0.03, 0.03), ('tH', 2, -0.03, 0.03)]
MONO_KEYS = [('con', 1, -1.0, 1.0), ('hl', 1, -3.0, 3.0), ('sh', 1, -3.0, 3.0), ('gam', 1, 0.8, 1.25),
             ('lift', 1, 0.0, 0.08), ('toneBase', 2, -0.06, 0.06)]


def load_sims():
    """Read the SIMS table straight from film-sim-lab.html (node evaluates the JS literal)."""
    html = (ROOT / 'film-sim-lab.html').read_text(encoding='utf8')
    block = html[html.index('const SIMS = ['):html.index('const SIM = Object')]
    js = block + '\nprocess.stdout.write(JSON.stringify(SIMS));'
    return {s['id']: s for s in json.loads(subprocess.run(['node', '-e', js], capture_output=True, check=True, text=True).stdout)}


def load_pair(base_path, target_path, long_side=640, max_px=12000):
    from PIL import Image
    a, b = Image.open(base_path).convert('RGB'), Image.open(target_path).convert('RGB')
    if a.size != b.size:
        sys.exit(f'Images differ in size: {a.size} vs {b.size}. Export both from the same RAW.')
    s = long_side / max(a.size)
    size = (max(1, round(a.size[0] * s)), max(1, round(a.size[1] * s)))
    # box downscale averages out noise and sub-pixel misalignment
    a, b = (np.asarray(im.resize(size, Image.BOX), float).reshape(-1, 3) / 255 for im in (a, b))
    keep = (a.max(1) < 0.985) & (b.max(1) < 0.985)       # drop clipped highlights: no information
    a, b = a[keep], b[keep]
    if len(a) > max_px:                                   # fixed seed: same pixels every run
        idx = np.random.default_rng(0).choice(len(a), max_px, replace=False)
        a, b = a[idx], b[idx]
    return a, b


def pack(p, keys):
    return np.concatenate([np.atleast_1d(np.asarray(p[k], float)) for k, n, *_ in keys])


def unpack(x, keys, base):
    p, i = dict(base), 0
    for k, n, *_ in keys:
        p[k] = float(x[i]) if n == 1 else [float(v) for v in x[i:i + n]]
        i += n
    return p


def bounds(keys):
    lo = np.concatenate([[b0] * n for k, n, b0, b1 in keys])
    hi = np.concatenate([[b1] * n for k, n, b0, b1 in keys])
    return lo, hi


def delta(p, base, target_lab, filt):
    return (srgb_to_oklab(render(base, p, filt)) - target_lab) * 100


def fit(base, target, init, filt='std', reg=0.05):
    """Least-squares fit of a SIMS entry so that render(base) ≈ target. Returns (params, err_before, err_after)."""
    keys = MONO_KEYS if init.get('mono') else COLOR_KEYS
    init = dict(init, toneBase=init.get('toneBase', [0, 0]))
    x0 = np.clip(pack(init, keys), *bounds(keys))
    lo, hi = bounds(keys)
    span = hi - lo
    target_lab = srgb_to_oklab(target)

    def residual(x):
        d = delta(unpack(x, keys, init), base, target_lab, filt).ravel()
        # weak pull toward the starting values keeps sectors the photo barely covers from drifting
        return np.concatenate([d / np.sqrt(len(base)), reg * (x - x0) / span])

    res = least_squares(residual, x0, bounds=(lo, hi), loss='soft_l1', f_scale=0.02, x_scale=span / 10)
    out = unpack(res.x, keys, init)
    err = lambda p: np.linalg.norm(delta(p, base, target_lab, filt), axis=1)
    return out, err(init), err(out)


def coverage(base):
    lab = srgb_to_oklab(base)
    C = np.hypot(lab[:, 1], lab[:, 2])
    h = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) % 360
    d = np.abs((h[:, None] - SECTOR_HUES[None, :] + 180) % 360 - 180)
    near = (d < 30) & (C[:, None] > 0.06)
    return dict(zip('RYGCBM', near.mean(0) * 100))


def js_entry(p):
    r = lambda v: round(v, 3)
    keys = ['id', 'name', 'card', 'sw']
    parts = [f"{k}: {json.dumps(p[k], ensure_ascii=False)}" for k in keys if k in p]
    if p.get('mono'):
        parts += ['mono: true'] + (['filters: true'] if p.get('filters') else [])
        parts += [f"{k}: {r(p[k])}" for k in ('con', 'hl', 'sh', 'gam', 'lift')]
        parts += [f"grainBase: {p.get('grainBase', 0)}", f"toneBase: {[r(v) for v in p['toneBase']]}"]
    else:
        parts += [f"{k}: {r(p[k])}" for k in ('sat', 'con', 'hl', 'sh', 'gam', 'lift')]
        parts += [f"{k}: {[r(v) for v in p[k]]}" for k in ('hue', 'satS', 'lumS', 'tS', 'tH')]
    return '  { ' + ', '.join(parts) + ' },'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('base'); ap.add_argument('target')
    ap.add_argument('--sim', required=True, help='SIMS id to start from, e.g. provia, cc, cn, acros')
    ap.add_argument('--filter', default='std', choices=['std', 'ye', 'r', 'g'])
    ap.add_argument('--reg', type=float, default=0.05, help='pull toward current values (0 = none)')
    a = ap.parse_args()
    sims = load_sims()
    if a.sim not in sims:
        sys.exit('Unknown --sim. Choose from: ' + ', '.join(sims))
    base, target = load_pair(a.base, a.target)
    print(f'{len(base)} pixels used. Hue coverage (% of pixels, saturated):',
          ', '.join(f'{k} {v:.1f}' for k, v in coverage(base).items()))
    p, e0, e1 = fit(base, target, sims[a.sim], a.filter, a.reg)
    for label, e in (('current', e0), ('fitted ', e1)):
        print(f'{label}: mean {e.mean():.2f}  p95 {np.percentile(e, 95):.2f}  max {e.max():.2f}')
    print('\nPaste into SIMS in film-sim-lab.html:\n' + js_entry(p))


if __name__ == '__main__':
    main()
