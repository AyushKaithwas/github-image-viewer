// Records docs/demo.gif and the README screenshots on a live GitHub issue.
// Needs network access and ffmpeg.   npm run demo [-- <issue or PR URL>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, MOD, launchWithExtension, extensionWorker, acceptConsent, tempDir, viewer } from '../tests/lib.mjs';

const url = process.argv[2] || 'https://github.com/microsoft/vscode/issues/344285';
const docs = path.join(ROOT, 'docs');
const videoDir = tempDir('giv-video-');
const size = { width: 1280, height: 800 };

const ctx = await launchWithExtension({ viewport: size, recordVideo: { dir: videoDir, size } });
await acceptConsent(await extensionWorker(ctx));
const page = ctx.pages()[0];
const v = viewer(page);

// Headless video has no cursor, so draw one, plus click ripples and key labels.
await page.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = `
      #demo-cursor { position: fixed; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px; margin: -2px 0 0 -3px;
        background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1 3.8 7.3-2.6 1.3-3.8-7.3L5 20z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>') no-repeat;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
      .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 36px; height: 36px; margin: -18px 0 0 -18px;
        border-radius: 50%; border: 2px solid #4493f8; animation: demo-ripple .5s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
      #demo-keys { position: fixed; z-index: 2147483647; left: 50%; bottom: 96px; transform: translateX(-50%); pointer-events: none;
        font: 600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #fff; background: rgba(13,17,23,.85);
        border: 1px solid rgba(240,246,252,.25); border-radius: 12px; padding: 8px 18px; opacity: 0; transition: opacity .2s; }
    `;
    document.head.append(css);
    const cursor = Object.assign(document.createElement('div'), { id: 'demo-cursor' });
    const keys = Object.assign(document.createElement('div'), { id: 'demo-keys' });
    const top = () => { document.documentElement.append(cursor); document.documentElement.append(keys); };
    top();
    addEventListener('mousemove', (e) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; top(); }, true);
    addEventListener('mousedown', (e) => {
      const r = Object.assign(document.createElement('div'), { className: 'demo-ripple' });
      r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`;
      document.documentElement.append(r); top();
      setTimeout(() => r.remove(), 600);
    }, true);
    let t;
    window.__demoKey = (label) => { keys.textContent = label; keys.style.opacity = '1'; top(); clearTimeout(t); t = setTimeout(() => (keys.style.opacity = '0'), 900); };
  });
});

const wait = (ms) => page.waitForTimeout(ms);
let mouse = { x: 640, y: 400 };
const moveTo = async (x, y, steps = 25) => { await page.mouse.move(x, y, { steps }); mouse = { x, y }; };
const click = async (x, y) => { await moveTo(x, y); await wait(150); await page.mouse.down(); await wait(60); await page.mouse.up(); };
const key = async (combo, label = combo) => { await page.evaluate((l) => window.__demoKey(l), label); await page.keyboard.press(combo); };

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.markdown-body img');
await wait(2500);
await page.mouse.move(mouse.x, mouse.y);
const first = page.locator('.markdown-body img').first();
await page.evaluate(() => document.querySelector('.markdown-body img').scrollIntoView({ block: 'center' }));
await wait(1200);

// Open from the page
const box = await first.boundingBox();
await click(box.x + box.width * 0.5, box.y + box.height * 0.45);
await wait(1400);
await page.screenshot({ path: path.join(docs, 'viewer.png') });

// Click to zoom at a point, pan, click back to fit
const r = await v.imageRect();
await click(r.x + r.w * 0.28, r.y + r.h * 0.32);
await wait(1100);
await page.screenshot({ path: path.join(docs, 'zoom.png') });
await page.mouse.down();
await moveTo(mouse.x - 260, mouse.y - 120, 30);
await page.mouse.up();
await wait(700);
await click(mouse.x, mouse.y);
await wait(1000);

// Browse
await key('ArrowRight', '→');
await wait(1100);
await key('ArrowRight', '→');
await wait(1100);
const thumb = await v.q('.thumb').nth(5).boundingBox();
await click(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
await wait(1200);
await moveTo(size.width - 60, size.height / 2);
await wait(200);
await click(size.width - 40, size.height / 2 - 20);
await wait(1100);

// Help, download, close
await key('?');
await wait(1800);
await page.screenshot({ path: path.join(docs, 'shortcuts.png') });
await key('Escape', 'esc');
await wait(600);
await key('d', 'D  download');
await wait(1500);
await key(`${MOD}+ArrowLeft`, MOD === 'Meta' ? '⌘ ←  first image' : 'Ctrl ←  first image');
await wait(1200);
await key('Escape', 'esc');
await wait(1600);

const video = page.video();
await ctx.close();
const webm = await video.path();

// Two-pass palette GIF: small file, clean colours.
const gif = path.join(docs, 'demo.gif');
const filters = 'fps=12,scale=960:-1:flags=lanczos';
const palette = path.join(videoDir, 'palette.png');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '2.2', '-i', webm, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '2.2', '-i', webm, '-i', palette, '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
console.log(`demo.gif: ${(fs.statSync(gif).size / 1e6).toFixed(1)} MB`);
