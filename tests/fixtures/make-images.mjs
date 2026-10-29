// Generates the gradient PNGs the end-to-end test serves as "GitHub" images.
import fs from 'node:fs';
import { encodePng } from '../../scripts/png.mjs';

const dir = new URL('./assets/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });

const gradient = (w, h, c1, c2) =>
  encodePng(w, h, (x, y) => {
    const t = (x / w + y / h) / 2;
    const stripe = (Math.floor(x / 80) + Math.floor(y / 80)) % 2 ? 40 : 0;
    return c1.map((a, i) => Math.min(255, Math.round(a + (c2[i] - a) * t) + stripe));
  });

const images = {
  'a.png': [2400, 1500, [30, 60, 200], [200, 80, 160]],
  'b.png': [1600, 1000, [20, 160, 90], [230, 220, 60]],
  'c.png': [1800, 1200, [220, 90, 30], [90, 20, 120]],
  'd.png': [1800, 1200, [40, 40, 40], [160, 200, 240]],
  'portrait.png': [800, 1600, [120, 30, 30], [30, 120, 160]],
  'badge.png': [100, 20, [60, 160, 60], [60, 160, 60]],
  'hidden.png': [400, 300, [0, 0, 0], [255, 255, 255]],
};
for (const [name, [w, h, c1, c2]] of Object.entries(images)) {
  const file = new URL(name, dir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, gradient(w, h, c1, c2));
}
