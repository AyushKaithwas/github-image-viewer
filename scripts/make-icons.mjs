// Renders extension/icons/icon{16,32,48,128}.png (supersampled vector shapes).
import fs from 'node:fs';
import { encodePng } from './png.mjs';

const out = new URL('../extension/icons/', import.meta.url);

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inTriangle = (x, y, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([x, y], a, b), d2 = s([x, y], b, c), d3 = s([x, y], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

// Colour at unit coordinates (u, v), or null for transparent.
function shade(u, v) {
  if (!inRoundRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) return null;
  const t = (u + v) / 2; // blue → violet
  const bg = [0x44 + (0x89 - 0x44) * t, 0x93 + (0x57 - 0x93) * t, 0xf8 + (0xe5 - 0xf8) * t];
  const white = [255, 255, 255];
  if (inRoundRect(u, v, 0.2, 0.24, 0.8, 0.76, 0.07)) {
    if (!inRoundRect(u, v, 0.255, 0.295, 0.745, 0.705, 0.03)) return white; // frame
    if ((u - 0.6) ** 2 + (v - 0.42) ** 2 <= 0.055 ** 2) return white; // sun
    if (inTriangle(u, v, [0.27, 0.7], [0.44, 0.47], [0.61, 0.7])) return white; // mountains
    if (inTriangle(u, v, [0.47, 0.7], [0.59, 0.55], [0.73, 0.7])) return white;
  }
  return bg;
}

for (const size of [16, 32, 48, 128]) {
  const ss = 6;
  const png = encodePng(size, size, (x, y) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < ss; sy++) {
      for (let sx = 0; sx < ss; sx++) {
        const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
      }
    }
    return n ? [r / n, g / n, b / n, (255 * n) / (ss * ss)].map(Math.round) : [0, 0, 0, 0];
  }, { alpha: true });
  fs.writeFileSync(new URL(`icon${size}.png`, out), png);
}
console.log('icons written to extension/icons/');
