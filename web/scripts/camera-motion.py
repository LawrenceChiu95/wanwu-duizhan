# 镜头晃不晃（Wren 的量法）：相邻两帧整帧相位相关求平移（CSS px），再分上下两半各求一次看是不是反向（转/滚）。
# Usage: <python with numpy + pillow> -I web/scripts/camera-motion.py <dir from camera-motion.mjs>
# 过线（Elara 98f93d28）：平均 ≤40 px/s，最差一秒 ≤150 px/s，上下两半反向 ≤5% 帧对，位移 >30 px 的帧合计 ≤0.3 秒；
# 10-28 跟拍取景版起「场地四角始终在画面里」换成「两颗陀螺始终整颗在画面里（安全区内）」，场地边缘不再算。
import json, sys, pathlib
import numpy as np
from PIL import Image

d = pathlib.Path(sys.argv[1])
cap = json.loads((d / 'capture.json').read_text())
times = np.array(cap['times']) / 1000.0
frames = [np.asarray(Image.open(d / f'f{i:03d}.png').convert('L'), dtype=np.float64) for i in range(len(times))]


def shift(a, b):
    """Translation of b relative to a (dx, dy) by phase correlation, with a parabolic sub-pixel peak."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    A, B = np.fft.fft2((a - a.mean()) * win), np.fft.fft2((b - b.mean()) * win)
    R = B * np.conj(A)
    R /= np.abs(R) + 1e-12
    r = np.fft.ifft2(R).real
    y, x = np.unravel_index(np.argmax(r), r.shape)

    def sub(c, n, m):
        l, cc, rr = m(c - 1), m(c), m(c + 1)
        den = l - 2 * cc + rr
        return c + (0.5 * (l - rr) / den if abs(den) > 1e-12 else 0.0)

    sx = sub(x, w, lambda k: r[y, k % w])
    sy = sub(y, h, lambda k: r[k % h, x])
    if sx > w / 2: sx -= w
    if sy > h / 2: sy -= h
    return np.array([sx, sy])


whole, tops, bottoms = [], [], []
for a, b in zip(frames, frames[1:]):
    h = a.shape[0] // 2
    whole.append(shift(a, b))
    tops.append(shift(a[:h], b[:h]))
    bottoms.append(shift(a[h:], b[h:]))
whole, tops, bottoms = map(np.array, (whole, tops, bottoms))
dt = np.diff(times)
mag = np.linalg.norm(whole, axis=1)
span = times[-1] - times[0]
mean = mag.sum() / span
# Worst one-second window (sum of |shift| over pairs that end inside it).
ends = times[1:]
worst = max(mag[(ends > t0) & (ends <= t0 + 1.0)].sum() for t0 in np.arange(times[0], times[-1] - 1.0 + 1e-9, 0.1))
# Direction reversals of the main component (pairs that moved at least 0.5 px).
moving = whole[mag >= 0.5]
rev = int(sum(1 for p, q in zip(moving, moving[1:]) if np.dot(p, q) < 0))
# Top and bottom halves moving opposite ways (both at least 1 px): the camera turning or rolling.
tm, bm = np.linalg.norm(tops, axis=1), np.linalg.norm(bottoms, axis=1)
opposite = int(np.sum((tm >= 1) & (bm >= 1) & (np.sum(tops * bottoms, axis=1) < 0)))
big = mag > 30
out = {
    'width': cap['width'], 'height': cap['height'], 'pairs': len(mag), 'span_s': round(span, 2),
    'mean_px_s': round(float(mean), 2), 'worst_second_px_s': round(float(worst), 2), 'reversals': rev,
    'opposite_halves_pct': round(100 * opposite / len(mag), 1), 'over30_s': round(float(dt[big].sum()), 2),
    'max_pair_px': round(float(mag.max()), 2), 'moving_pairs': int((mag >= 0.5).sum()),
    'safe': cap['safe'], 'frame': cap.get('frame'), 'presses': cap.get('presses'), 'truth': cap.get('truth'), 'errors': cap['errors'],
}
out['pass'] = out['mean_px_s'] <= 40 and out['worst_second_px_s'] <= 150 and out['opposite_halves_pct'] <= 5 and out['over30_s'] <= 0.3 \
    and all(v['px'] <= 0 for v in cap['safe'].values())
(d / 'motion.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
print(json.dumps(out, ensure_ascii=False))
