// Live test: a visible Chrome with the extension, on a real public GitHub issue,
// driven with real mouse and keyboard input. Needs network access.
//   npm run test:live [-- <issue or PR URL>]
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT, MOD, launchWithExtension, extensionWorker, acceptConsent, reporter, viewer } from './lib.mjs';

const url = process.argv[2] || 'https://github.com/microsoft/vscode/issues/344285';
const shots = path.join(OUTPUT, 'live');
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });

const ctx = await launchWithExtension({ headless: !!process.env.HEADLESS, viewport: { width: 1440, height: 860 }, args: ['--window-size=1440,960'] });
const sw = await extensionWorker(ctx);
await acceptConsent(sw);
const extPage = await ctx.newPage(); // for reading chrome.downloads
await extPage.goto(`chrome-extension://${new URL(sw.url()).host}/manifest.json`);
const page = ctx.pages()[0];
await page.bringToFront();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const { check, finish } = reporter(`Live: ${url}`);
const v = viewer(page);
const settle = (ms = 450) => page.waitForTimeout(ms);
let n = 0;
const snap = (name) => page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-${name}.png`) });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.markdown-body img');
await settle(2500);
const first = page.locator('.markdown-body img').first();
await first.scrollIntoViewIfNeeded();
await first.click();
await settle();
check('clicking a GitHub image opens the viewer', await v.isOpen());
const counter = await v.text('.counter');
check('gallery collects the screenshots', /^1 \/ \d+$/.test(counter), counter);
check('author and size are shown', /^@\S+ · \d+ × \d+$/.test(await v.text('.sub')), await v.text('.sub'));
await snap('open');

const fit = await v.zoom();
const r = await v.imageRect();
const p = { x: r.x + r.w * 0.3, y: r.y + r.h * 0.4 };
await page.mouse.click(p.x, p.y);
await settle();
const r2 = await v.imageRect();
check('click zooms in, anchored at the cursor', (await v.zoom()) > fit && Math.abs((p.x - r2.x) / r2.w - 0.3) < 0.02);
await snap('zoomed');
await page.mouse.click(p.x, p.y);
await settle(800);
await page.mouse.dblclick(p.x, p.y);
await settle(700);
check('double-click zooms in and stays zoomed', (await v.zoom()) > fit);
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(560, 380, { steps: 8 });
await page.mouse.up();
check('drag pans without un-zooming', (await v.zoom()) > fit);
await settle();
await page.mouse.click(720, 450);
await settle();
check('click while zoomed returns to fit', (await v.zoom()) === fit);

await page.keyboard.press('ArrowRight');
await settle();
check('→ next image', (await v.text('.counter')).startsWith('2 /'));
await v.q('.thumb').nth(3).click();
await settle();
check('thumbnail jumps to an image', (await v.text('.counter')).startsWith('4 /'));
await snap('thumbnail');
await page.keyboard.press(`${MOD}+ArrowLeft`);
await settle();
check(`${MOD}+← first image`, (await v.text('.counter')).startsWith('1 /'));

await page.keyboard.press('l');
await settle(300);
check('L copies the image link', /^https:\/\//.test(await page.evaluate(() => navigator.clipboard.readText())));
await v.q('[data-action="copy"]').click();
await settle(2500);
const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types)).catch(() => []);
check('copy puts a PNG on the clipboard', types.includes('image/png'));

await page.keyboard.press('d');
await settle(800);
check('D starts a download', (await v.text('.toast')) === 'Downloading…');
const dl = await extPage.waitForFunction(() => chrome.downloads.search({}).then((l) => l.find((d) => d.state !== 'in_progress')), null, { timeout: 15000 })
  .then((h) => h.jsonValue()).catch(() => null);
check('the downloaded file is a complete image', dl?.state === 'complete' && dl.mime?.startsWith('image/'), JSON.stringify(dl));

await page.keyboard.press('Escape');
await settle();
check('Esc closes and restores scrolling', !(await v.isOpen()) && (await page.evaluate(() => document.documentElement.style.overflow === '')));

await ctx.close();
process.exit(finish());
