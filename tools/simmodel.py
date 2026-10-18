"""NumPy port of the Film Sim Lab colour pipeline (film-sim-lab.html fragment shader).

Covers the part that defines a film simulation: sRGB decode, tone curve, OKLCh per-hue edits,
split-tone, gamut mapping and the monochrome branch. Recipe controls are at camera defaults
(DR100, AWB, Highlight/Shadow/Color 0, Color Chrome Off, no sharpness/clarity/grain/LUT),
which is how calibration pairs should be shot. tools/parity_test.mjs checks this file against
the real WebGL output; keep both in step when the shader changes.
"""
import numpy as np

SECTOR_HUES = np.array([29.2, 109.8, 142.5, 194.8, 264.1, 328.4])
FILTERS = {'std': [0.2126, 0.7152, 0.0722], 'ye': [0.3, 0.66, 0.04], 'r': [0.62, 0.36, 0.02], 'g': [0.16, 0.76, 0.08]}

M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
               [0.2119034982, 0.6806995451, 0.1073969566],
               [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
               [1.9779984951, -2.4285922050, 0.4505937099],
               [0.0259040371, 0.7827717662, -0.8086757660]])
M2I = np.array([[1.0, 0.3963377774, 0.2158037573],
                [1.0, -0.1055613458, -0.0638541728],
                [1.0, -0.0894841775, -1.2914855480]])
M1I = np.array([[4.0767416621, -3.3077115913, 0.2309699292],
                [-1.2684380046, 2.6097574011, -0.3413193965],
                [-0.0041960863, -0.7034186147, 1.7076147010]])


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def to_lin(c):
    return np.where(c >= 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)


def to_srgb(c):
    c = np.maximum(c, 0.0)
    return np.where(c >= 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, c * 12.92)


def lin2lab(c):
    return np.cbrt(np.maximum(c @ M1.T, 0.0)) @ M2.T


def lab2lin(c):
    return ((c @ M2I.T) ** 3) @ M1I.T


def in_gamut(c):
    return np.all((c >= -1e-4) & (c <= 1.0001), axis=-1)


def fit_gamut(lab):
    c = lab2lin(lab)
    bad = ~in_gamut(c)
    if bad.any():
        lo = np.zeros(bad.sum()); hi = np.ones(bad.sum())
        lb = lab[bad]
        for _ in range(10):
            k = 0.5 * (lo + hi)
            ok = in_gamut(lab2lin(np.column_stack([lb[:, 0], lb[:, 1:] * k[:, None]])))
            lo = np.where(ok, k, lo); hi = np.where(ok, hi, k)
        c[bad] = lab2lin(np.column_stack([lb[:, 0], lb[:, 1:] * lo[:, None]]))
    return np.clip(c, 0.0, 1.0)


def curve(x, p):
    x = np.clip(x, 0.0, 1.0)
    bs = 6.75 * x * (1 - x) ** 2
    bh = 6.75 * x * x * (1 - x)
    y = x + 0.12 * p['con'] * (bh - bs) - 0.04 * p['sh'] * bs + 0.04 * p['hl'] * bh
    y = np.clip(y, 0.0, 1.0) ** p['gam']
    return p['lift'] + (1 - p['lift']) * y


def render(srgb, p, filt='std'):
    """srgb: (N, 3) floats in [0, 1]. p: one SIMS entry (dict). Returns (N, 3) sRGB in [0, 1]."""
    lin = np.clip(to_lin(srgb), 0.0, 1.0)
    if p.get('mono'):
        m = curve(to_srgb(lin @ np.array(FILTERS[filt if p.get('filters') else 'std'])), p)
        mk = smoothstep(0.0, 0.3, m) * (1 - 0.6 * smoothstep(0.7, 1.0, m))
        mlab = lin2lab(np.repeat(to_lin(m)[:, None], 3, axis=1))
        mlab[:, 1:] += np.outer(mk, p.get('toneBase', [0, 0]))
        return to_srgb(fit_gamut(mlab))

    lab = lin2lab(to_lin(curve(to_srgb(lin), p)))
    L = lab[:, 0]; C = np.hypot(lab[:, 1], lab[:, 2])
    h = np.degrees(np.arctan2(lab[:, 2], lab[:, 1]))
    h = np.where(h < SECTOR_HUES[0], h + 360, h)
    ctr = np.append(SECTOR_HUES, SECTOR_HUES[0] + 360)
    seg = np.clip(np.searchsorted(ctr, h, side='right') - 1, 0, 5)
    t = smoothstep(ctr[seg], ctr[seg + 1], h)
    wrap = lambda a: np.append(np.asarray(a, float), a[0])
    hue, sat_s, lum_s = wrap(p['hue']), wrap(p['satS']), wrap(p['lumS'])
    hs = hue[seg] + (hue[seg + 1] - hue[seg]) * t
    ss = sat_s[seg] + (sat_s[seg + 1] - sat_s[seg]) * t
    vs = lum_s[seg] + (lum_s[seg + 1] - lum_s[seg]) * t
    sw = smoothstep(0.015, 0.06, C)
    h = h + hs * sw
    C = C * (1 + (ss - 1) * sw) * p['sat']
    L = L * (1 + (vs - 1) * sw)
    hr = np.radians(h)
    lab = np.column_stack([L, C * np.cos(hr), C * np.sin(hr)])
    lab[:, 1:] += np.outer((1 - L) ** 2, p['tS']) + np.outer(L ** 2, p['tH'])
    return to_srgb(fit_gamut(lab))


def srgb_to_oklab(srgb):
    return lin2lab(to_lin(np.clip(srgb, 0, 1)))
