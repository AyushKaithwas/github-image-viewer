// Renders the Chrome Web Store promo images into store/ (small tile 440x280, marquee 1400x560).
import fs from 'node:fs';
import { chromium } from 'playwright';

const icon = fs.readFileSync(new URL('../extension/icons/icon128.png', import.meta.url)).toString('base64');
const shot = fs.readFileSync(new URL('../docs/viewer.png', import.meta.url)).toString('base64');
const out = new URL('../store/', import.meta.url);
fs.mkdirSync(out, { recursive: true });

const page = (w, h, body) => `<!doctype html><html><head><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${w}px; height: ${h}px; overflow: hidden; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    background: radial-gradient(120% 140% at 0% 0%, #1f3a75 0%, #0d1117 55%), #0d1117; }
  .icon { width: 1em; height: 1em; background: url(data:image/png;base64,${icon}) center / 133% no-repeat; }
  h1 { font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; }
  p { color: #9da7b3; line-height: 1.35; }
</style></head><body>${body}</body></html>`;

const assets = {
  'promo-small.png': [440, 280, `
    <div style="padding: 34px 32px; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 14px;">
      <div class="icon" style="font-size: 64px"></div>
      <h1 style="font-size: 30px">Image Viewer<br>for GitHub</h1>
      <p style="font-size: 15px">View PR screenshots without leaving the page.</p>
    </div>`],
  'promo-marquee.png': [1400, 560, `
    <div style="display: flex; align-items: center; height: 100%; padding: 0 0 0 90px; gap: 60px;">
      <div style="flex: 0 0 460px; display: flex; flex-direction: column; gap: 22px;">
        <div class="icon" style="font-size: 96px"></div>
        <h1 style="font-size: 54px">Image Viewer<br>for GitHub</h1>
        <p style="font-size: 22px">Click a screenshot in a pull request. Zoom, compare, copy and download without leaving the page.</p>
      </div>
      <img src="data:image/png;base64,${shot}" style="width: 760px; border-radius: 12px; box-shadow: 0 30px 80px rgba(0,0,0,.6); border: 1px solid #30363d;">
    </div>`],
};

const browser = await chromium.launch();
for (const [name, [w, h, body]] of Object.entries(assets)) {
  const tab = await browser.newPage({ viewport: { width: w, height: h } });
  await tab.setContent(page(w, h, body));
  await tab.screenshot({ path: new URL(name, out).pathname });
  await tab.close();
}
await browser.close();
console.log('store assets written to store/');
