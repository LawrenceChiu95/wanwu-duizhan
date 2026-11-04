# 镜头晃不晃 · 交叉核对：同一个截帧目录，不用整帧相位相关，改用 Wren 的分块匹配。每块（32 px）在下一帧 ±48 px 里找最像的位置，
# 整帧取所有有纹理块的中位数，上下两半各取各的中位数看是不是反向（转/滚）。指标和过线同 camera-motion.py，写 motion-blockmatch.json。
# Usage: /tmp/feel-work/venv/bin/python -I web/scripts/camera-blockmatch.py <dir from camera-motion.mjs>
# 过线（Elara 98f93d28）：平均 ≤40 px/s，最差一秒 ≤150 px/s，上下两半反向 ≤5% 帧对，位移 >30 px 的帧合计 ≤0.3 秒（只看镜头，不看 safe/rim）。
import json, sys, time, pathlib
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image

BLOCK, REACH = 32, 48  # block size and search range (± px, full resolution)
COARSE = 2  # full search on the pyramid level 2**COARSE times smaller, then ±2 px refinement on each finer level
MIN_STD = 4.0  # grey-level std a block needs to count as textured (the background is mostly dark)
MIN_BLOCKS = 4  # a half (or the frame) with fewer textured blocks counts as not moving
TIE = 0.01  # cost per px of offset, so flat or ambiguous blocks prefer the smaller move
OUTSIDE = -1e4  # padding outside the frame: never a match

t_start = time.time()
d = pathlib.Path(sys.argv[1])
cap = json.loads((d / 'capture.json').read_text())
times = np.array(cap['times']) / 1000.0
frames = [np.asarray(Image.open(d / f'f{i:03d}.png').convert('L'), dtype=np.float32) for i in range(len(times))]
H, W = frames[0].shape
ny, nx, step = H // BLOCK, W // BLOCK, 1 << COARSE
oy, ox = (H - ny * BLOCK) // 2 // step * step, (W - nx * BLOCK) // 2 // step * step
# Top-left corner of every grid block (full-res px), row-major; which blocks sit in the top half.
by, bx = (a.ravel() for a in np.meshgrid(oy + BLOCK * np.arange(ny), ox + BLOCK * np.arange(nx), indexing='ij'))
top = by + BLOCK / 2 < H / 2


def pyramid(a):
    levels = [a]
    for _ in range(COARSE):
        a = a[:a.shape[0] // 2 * 2, :a.shape[1] // 2 * 2]
        a = 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])
        levels.append(a)
    return levels


def coarse(a, b):
    """Exhaustive search at the coarsest level for every grid block: integer (dy, dx) per block, in that level's px."""
    s, r, y0, x0 = BLOCK >> COARSE, REACH >> COARSE, oy >> COARSE, ox >> COARSE
    A = a[y0:y0 + ny * s, x0:x0 + nx * s]
    P = np.pad(b, r, constant_values=OUTSIDE)
    offs = [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1)]
    cost = np.empty((len(offs), ny * nx), np.float32)
    for k, (dy, dx) in enumerate(offs):
        B = P[r + y0 + dy:r + y0 + dy + ny * s, r + x0 + dx:r + x0 + dx + nx * s]
        cost[k] = np.abs(A - B).reshape(ny, s, nx, s).mean(axis=(1, 3)).ravel() + TIE * step * (abs(dy) + abs(dx))
    return np.array(offs)[cost.argmin(axis=0)]


def refine(a, b, level, guess, sel):
    """±2 px around guess (dy, dx at this level) for blocks sel. Returns the best offsets and their 5×5 cost tables."""
    s, r, scale = BLOCK >> level, 2, 1 << level
    pad = (REACH >> level) + 4 * r  # covers the guess (at most the reach plus earlier ±2 steps) and this search
    P = np.pad(b, pad, constant_values=OUTSIDE)
    y, x = by[sel] // scale, bx[sel] // scale
    A = sliding_window_view(a, (s, s))[y, x]
    # Each block's search window in one gather, then the 25 candidates are plain slices of it.
    wy, wx = pad + y + guess[:, 0] - r, pad + x + guess[:, 1] - r
    assert wy.min() >= 0 and wx.min() >= 0
    win = sliding_window_view(P, (s + 2 * r, s + 2 * r))[wy, wx]
    cost = np.empty((2 * r + 1, 2 * r + 1, len(sel)), np.float32)
    for i in range(2 * r + 1):
        for j in range(2 * r + 1):
            total = np.abs(guess + (i - r, j - r)).sum(axis=1) * scale
            cost[i, j] = np.abs(A - win[:, i:i + s, j:j + s]).mean(axis=(1, 2)) + TIE * total
    flat = cost.reshape(-1, len(sel)).argmin(axis=0)
    i, j = np.divmod(flat, 2 * r + 1)
    return guess + np.stack([i - r, j - r], axis=1), cost, i, j


def subpixel(cost, i, j):
    """Equiangular (V-shaped) fit around the minimum on each axis: the right shape for an absolute-difference cost."""
    n = np.arange(cost.shape[2])
    out = np.zeros((len(n), 2))
    for axis, (c0, lo, hi, ok) in enumerate([
        (cost[i, j, n], cost[np.maximum(i - 1, 0), j, n], cost[np.minimum(i + 1, 4), j, n], (i > 0) & (i < 4)),
        (cost[i, j, n], cost[i, np.maximum(j - 1, 0), n], cost[i, np.minimum(j + 1, 4), n], (j > 0) & (j < 4)),
    ]):
        den = np.maximum(lo, hi) - c0
        out[:, axis] = np.where(ok & (den > 1e-6), np.clip(0.5 * (lo - hi) / np.where(den > 1e-6, den, 1), -0.5, 0.5), 0)
    return out


def match(pa, pb):
    """Motion of every textured block from frame a to frame b as (dx, dy) full-res px, and which blocks those are."""
    a0 = pa[0]
    std = a0[oy:oy + ny * BLOCK, ox:ox + nx * BLOCK].reshape(ny, BLOCK, nx, BLOCK).std(axis=(1, 3)).ravel()
    sel = np.flatnonzero(std >= MIN_STD)
    if len(sel) == 0:
        return np.zeros((0, 2)), sel
    guess = coarse(pa[COARSE], pb[COARSE])[sel]
    for level in range(COARSE - 1, -1, -1):
        guess, cost, i, j = refine(pa[level], pb[level], level, guess * 2, sel)
    v = guess + subpixel(cost, i, j)
    return v[:, ::-1], sel


def median(v):
    return np.median(v, axis=0) if len(v) >= MIN_BLOCKS else np.zeros(2)


pyrs = [pyramid(f) for f in frames]
whole, tops, bottoms, used, thin = [], [], [], [], 0
for pa, pb in zip(pyrs, pyrs[1:]):
    v, sel = match(pa, pb)
    t = top[sel]
    whole.append(median(v))
    tops.append(median(v[t]))
    bottoms.append(median(v[~t]))
    used.append(len(sel))
    thin += int(t.sum() < MIN_BLOCKS or (~t).sum() < MIN_BLOCKS)
whole, tops, bottoms = map(np.array, (whole, tops, bottoms))
# Same metrics as camera-motion.py from here on.
dt = np.diff(times)
mag = np.linalg.norm(whole, axis=1)
span = times[-1] - times[0]
mean = mag.sum() / span
ends = times[1:]
worst = max(mag[(ends > t0) & (ends <= t0 + 1.0)].sum() for t0 in np.arange(times[0], times[-1] - 1.0 + 1e-9, 0.1))
moving = whole[mag >= 0.5]
rev = int(sum(1 for p, q in zip(moving, moving[1:]) if np.dot(p, q) < 0))
tm, bm = np.linalg.norm(tops, axis=1), np.linalg.norm(bottoms, axis=1)
opposite = int(np.sum((tm >= 1) & (bm >= 1) & (np.sum(tops * bottoms, axis=1) < 0)))
big = mag > 30
out = {
    'method': 'blockmatch', 'width': cap['width'], 'height': cap['height'], 'pairs': len(mag), 'span_s': round(span, 2),
    'mean_px_s': round(float(mean), 2), 'worst_second_px_s': round(float(worst), 2), 'reversals': rev,
    'opposite_halves_pct': round(100 * opposite / len(mag), 1), 'over30_s': round(float(dt[big].sum()), 2),
    'max_pair_px': round(float(mag.max()), 2), 'moving_pairs': int((mag >= 0.5).sum()),
    'blocks_grid': ny * nx, 'textured_blocks_mean': round(float(np.mean(used)), 1), 'textured_blocks_min': int(min(used)),
    'pairs_with_thin_half': thin,
    'safe': cap.get('safe'), 'rim_overflow_px': (cap.get('rim') or {}).get('px'), 'frame': cap.get('frame'), 'errors': cap.get('errors'),
    'runtime_s': round(time.time() - t_start, 1),
}
out['pass'] = out['mean_px_s'] <= 40 and out['worst_second_px_s'] <= 150 and out['opposite_halves_pct'] <= 5 and out['over30_s'] <= 0.3
(d / 'motion-blockmatch.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
print(json.dumps(out, ensure_ascii=False))
