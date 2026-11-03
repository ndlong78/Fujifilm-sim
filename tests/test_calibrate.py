"""Calibration recovers known parameters from a synthetic pair.

Usage: python3 tests/test_calibrate.py   (needs numpy, scipy; node for reading SIMS)
A target is rendered from a perturbed Classic Chrome with mild noise; the fit starts from Provia.
"""
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'tools'))
from simmodel import render  # noqa: E402
from calibrate import fit, load_sims  # noqa: E402


def main():
    rng = np.random.default_rng(1)
    base = rng.beta(2, 2, (12000, 3))
    sims = load_sims()
    truth = dict(sims['cc'], sat=0.78, con=0.35, sh=1.6, hue=[-4, -9, -12, 3, -10, -2],
                 satS=[0.85, 0.75, 0.7, 0.9, 1.0, 0.8], tH=[0.004, 0.012])
    target = np.clip(render(base, truth) + rng.normal(0, 1.5 / 255, base.shape), 0, 1)
    fitted, before, after = fit(base, target, sims['provia'])
    hue_err = np.abs(np.array(fitted['hue']) - truth['hue']).max()
    print(f'error before {before.mean():.2f}, after {after.mean():.2f}; worst hue error {hue_err:.2f} deg')
    ok = before.mean() > 3 and after.mean() < 0.8 and hue_err < 1.5
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
