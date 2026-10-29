// End-to-end test: loads the extension into Chromium, serves a copy of GitHub's
// PR markup at github.com, and drives the viewer with real mouse and keyboard input.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { FIXTURES, OUTPUT, IS_MAC, MOD, launchWithExtension, extensionWorker, reporter, viewer } from './lib.mjs';
import './fixtures/make-images.mjs';

const PR_URL = 'https://github.com/octo-org/octo-app/pull/42';
const assets = path.join(FIXTURES, 'assets');
const shots = path.join(OUTPUT, 'e2e');
fs.mkdirSync(shots, { recursive: true });

const ctx = await launchWithExtension();
const sw = await extensionWorker(ctx);

// Serve the fixture page and images in place of the real GitHub hosts.
const imageFor = (url) => {
  const key = url.match(/(aaa|bbb|ccc|ddd|portrait|hidden|badge)/)?.[1];
  return fs.readFileSync(path.join(assets, `${{ aaa: 'a', bbb: 'b', ccc: 'c', ddd: 'd' }[key] || key}.png`));
};
const README_URL = 'https://github.com/octo-org/octo-app/blob/main/README.md';
const RAW = { 'shot.png': 'b.png', 'thumb.png': 'hidden.png', 'full.png': 'a.png' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#4493f8"/></svg>';
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  const raw = url.match(/\/raw\/main\/docs\/(?:assets\/)?([\w.]+)/)?.[1];
  if (raw === 'diagram.svg') return route.fulfill({ contentType: 'image/svg+xml', body: SVG });
  if (raw) return RAW[raw] ? route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(assets, RAW[raw])) }) : route.fulfill({ status: 404, body: '' });
  if (url === README_URL) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(FIXTURES, 'readme.html')) });
  if (url.startsWith('https://github.com/octo-org/')) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(FIXTURES, 'pr.html')) });
  if (url.includes('objects.githubusercontent.com')) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(assets, 'a.png')) });
  if (/githubusercontent\.com|shields\.io|user-attachments/.test(url)) return route.fulfill({ contentType: 'image/png', body: imageFor(url) });
  return route.fulfill({ status: 404, body: '' });
});

// An extension page also receives the content script's runtime messages, so it can
// record exactly what the viewer asks the service worker to download.
const extPage = await ctx.newPage();
await extPage.goto(`chrome-extension://${new URL(sw.url()).host}/manifest.json`);
await extPage.evaluate(() => {
  window.sent = [];
  chrome.runtime.onMessage.addListener((msg) => { window.sent.push(msg); });
});

const page = ctx.pages()[0];
await page.bringToFront();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(PR_URL);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));

const { check, finish } = reporter('End-to-end (fixture page)');
const v = viewer(page);
const settle = (ms = 400) => page.waitForTimeout(ms);
const counter = () => v.text('.counter');
const caption = () => v.text('.caption');

// --- Opening ---
await page.click('img[alt="build"]').catch(() => {});
check('badge links keep their normal behaviour', !(await v.host.count()) || !(await v.isOpen()));
if (page.url() !== PR_URL) await page.goBack();

// --- One-time consent ---
await page.click('#first');
await settle(300);
check('the first click asks for consent before reading the page', (await v.q('.consent').isVisible()) && (await v.q('.thumb').count()) === 0);
const focused = [];
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Tab');
  focused.push(await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.textContent.trim()));
}
check('Tab reaches the privacy policy link and both buttons', ['Privacy policy', 'Not now', 'Continue'].every((t) => focused.includes(t)), focused.join(' | '));
await page.keyboard.press('Escape');
await settle(300);
check('"Not now" (Esc) closes without opening or remembering', !(await v.isOpen()) && !(await sw.evaluate(() => chrome.storage.local.get('consented'))).consented);
await page.click('#first');
await settle(300);
await v.q('[data-action="consentYes"]').click();
await settle(450);
check('Continue opens the clicked image and is remembered', (await counter()) === '1 / 5' && (await sw.evaluate(() => chrome.storage.local.get('consented'))).consented === true);

await page.keyboard.press('Escape');
await settle(450);
await page.click('#first');
await settle(450);
check('clicking an image opens the viewer, without asking again', (await v.isOpen()) && !(await v.q('.consent').isVisible()));
check('gallery has the 5 visible images (badge and collapsed image skipped)', (await counter()) === '1 / 5', await counter());
check('caption comes from the table header', (await caption()) === 'Before', await caption());
check('author and natural size are shown', (await v.text('.sub')) === '@octocat · 2400 × 1500', await v.text('.sub'));
check('page scrolling is locked', await page.evaluate(() => document.documentElement.style.overflow === 'hidden'));
check('thumbnail strip lists every image', (await v.q('.thumb').count()) === 5);
const fit = await v.zoom();
check('large image is fitted to the screen', fit < 100, `${fit}%`);
await page.screenshot({ path: path.join(shots, 'open.png') });

// --- Navigation ---
await page.keyboard.press('ArrowRight');
await settle(250);
check('→ shows the next image', (await counter()) === '2 / 5' && (await caption()) === 'After');
await page.keyboard.press('ArrowRight');
await settle(300);
check('caption comes from a label row above the image', (await caption()) === 'Empty state', await caption());
await v.q('.nav.next').click();
await settle(250);
check('next button', (await caption()) === 'Loading state');
await v.q('.thumb').nth(4).click();
await settle(250);
check('thumbnail click + caption from alt text', (await counter()) === '5 / 5' && (await caption()) === 'Mobile layout');
check('next button is disabled on the last image', await v.q('.nav.next').isDisabled());
await page.keyboard.press('Home');
await settle(250);
check('Home goes to the first image', (await counter()) === '1 / 5');
await page.keyboard.press(`${MOD}+ArrowRight`);
await settle(250);
check(`${MOD}+→ goes to the last image`, (await counter()) === '5 / 5');
await page.keyboard.press(`${MOD}+ArrowLeft`);
await settle(250);
check(`${MOD}+← goes to the first image`, (await counter()) === '1 / 5');

// --- Zoom ---
const r0 = await v.imageRect();
const p = { x: r0.x + r0.w * 0.3, y: r0.y + r0.h * 0.4 };
await page.mouse.click(p.x, p.y);
await settle(450);
const r1 = await v.imageRect();
check('click zooms in', (await v.zoom()) > fit, `${await v.zoom()}%`);
check('the clicked point stays under the cursor', Math.abs((p.x - r1.x) / r1.w - 0.3) < 0.02 && Math.abs((p.y - r1.y) / r1.h - 0.4) < 0.02);
await page.screenshot({ path: path.join(shots, 'zoomed.png') });
await page.mouse.click(p.x, p.y);
await settle(450);
check('clicking again returns to fit', (await v.zoom()) === fit);
await settle(400);
await page.mouse.dblclick(p.x, p.y);
await settle(600);
check('double-click zooms in once and stays zoomed', (await v.zoom()) > fit, `${await v.zoom()}%`);
await page.keyboard.press('0');
await settle();
check('0 fits to screen', (await v.zoom()) === fit);
await page.keyboard.press(`${MOD}+Equal`);
await settle();
check(`${MOD}+= zooms in`, (await v.zoom()) > fit);
await page.keyboard.press(`${MOD}+Digit0`);
await settle();
check(`${MOD}+0 fits`, (await v.zoom()) === fit);
await page.keyboard.press('1');
await settle();
check('1 shows actual size', (await v.text('.zoom')) === '100%');
const before = (await v.imageRect()).x;
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(900, 500, { steps: 5 });
await page.mouse.up();
check('dragging pans a zoomed image', Math.round((await v.imageRect()).x - before) === 200);
check('a drag is not a click (still zoomed, same image)', (await v.text('.zoom')) === '100%' && (await counter()) === '1 / 5');
await page.keyboard.press('0');
await settle();
await page.mouse.move(720, 450);
await page.mouse.wheel(0, -300);
await settle(150);
check('scroll wheel zooms', (await v.zoom()) > fit);
await page.keyboard.press('0');
await settle();

// --- Swipe, rotate, help ---
await page.mouse.move(900, 450);
await page.mouse.down();
await page.mouse.move(600, 450, { steps: 6 });
await page.mouse.up();
await settle(300);
check('dragging at fit swipes to the next image', (await counter()) === '2 / 5');
await page.keyboard.press('r');
await settle();
check('R rotates', (await v.q('.img').evaluate((el) => el.style.transform)).includes('rotate(90deg)'));
await v.q('[data-action="rotate"]').focus();
await page.keyboard.press('?');
check('? opens shortcut help', await v.q('.help').isVisible());
await page.keyboard.press('Enter');
await page.keyboard.press('Space');
check('keys under the help overlay do nothing', (await v.q('.img').evaluate((el) => el.style.transform)).includes('rotate(90deg)') && (await v.q('.help').isVisible()) && (await counter()) === '2 / 5');
const help = await v.text('.help-card');
check('help shows this platform’s keys', IS_MAC ? help.includes('⌘←') && !help.includes('Home') : help.includes('Home') && help.includes('Ctrl'));
await page.screenshot({ path: path.join(shots, 'help.png') });
await page.keyboard.press('Escape');
check('Esc closes help first, viewer stays open', !(await v.q('.help').isVisible()) && (await v.isOpen()));
check('closing help returns focus to where it was', await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.dataset.action === 'rotate'));

// --- Copy ---
await page.keyboard.press('l');
await settle(200);
check('L copies the image link', (await page.evaluate(() => navigator.clipboard.readText())) === 'https://github.com/user-attachments/assets/2222-bbbb');
await page.keyboard.press('c');
await settle(1500);
const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types)).catch((e) => [String(e)]);
check('C copies the image as PNG', types.includes('image/png'), types.join());

// --- Downloads (what the viewer requests; filenames on disk are tested in downloads.mjs) ---
await page.keyboard.press('d');
await page.keyboard.press('Shift+D');
await extPage.waitForFunction(() => window.sent.filter((m) => m.type.startsWith('giv:download')).length >= 2, null, { timeout: 5000 }).catch(() => {});
const sent = await extPage.evaluate(() => window.sent);
const one = sent.find((m) => m.type === 'giv:download');
const all = sent.find((m) => m.type === 'giv:download-many');
check('D requests the full-size image', one?.url === 'https://github.com/user-attachments/assets/2222-bbbb' && one?.name === '2222-bbbb', JSON.stringify(one));
check('⇧D requests all 5 images, not the hidden one', all?.items.length === 5 && !all.items.some((i) => i.url.includes('hidden')), JSON.stringify(all?.items.map((i) => i.url)));
check('⇧D names files after captions, in a per-page folder',
  all?.items[0].folder === 'GitHub images/octo-org octo-app pull 42' &&
  JSON.stringify(all.items.map((i) => i.name)) === JSON.stringify(['1 Before', '2 After', '3 Empty state', '4 Loading state', '5 Mobile layout']),
  JSON.stringify(all?.items.map((i) => i.name)));

// --- The service worker only acts on addresses it should ---
const ask = (msg) => extPage.evaluate((m) => chrome.runtime.sendMessage(m), msg);
const offHost = await ask({ type: 'giv:fetch', urls: ['https://example.com/a.png'] });
check('the worker refuses to fetch from non-GitHub hosts', offHost?.ok === false, JSON.stringify(offHost));
const insecure = await ask({ type: 'giv:download', url: 'http://example.com/a.png', name: 'a' });
check('the worker refuses plain-http downloads', insecure?.ok === false, JSON.stringify(insecure));

// --- Closing ---
await page.keyboard.press('Escape');
await settle(450);
check('Esc closes the viewer', !(await v.isOpen()));
check('page scrolling is restored', await page.evaluate(() => document.documentElement.style.overflow === ''));
const popup = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await page.click('#first', { modifiers: [MOD] });
check(`${MOD}-click still opens a new tab`, !!(await popup) && !(await v.isOpen()));
await page.click('img[alt="Mobile layout"]');
await settle();
check('opening on a later image starts there', (await counter()) === '5 / 5');
await page.mouse.click(150, 450);
await settle(450);
check('clicking the backdrop closes', !(await v.isOpen()));

// --- README page: linked originals, SVG, broken images, keyboard and focus ---
await page.goto(README_URL);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
await page.focus('a:has(#plain)');
await page.keyboard.press('Enter');
await settle(450);
check('Enter on an image link opens the viewer', (await v.isOpen()) && (await counter()) === '1 / 7', await counter());
if (!(await v.isOpen())) {
  await page.bringToFront();
  await page.click('#plain');
  await settle(450);
}
check('README image shows the file itself, not its /blob/ page', (await v.q('.img').getAttribute('src')).endsWith('/raw/main/docs/shot.png'));
for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
const inside = () => page.evaluate(() => document.activeElement?.id === 'github-image-viewer');
check('Tab stays inside the viewer', await inside());
for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
check('Shift+Tab stays inside the viewer', await inside());
await page.keyboard.press('Escape');
await settle(450);
check('closing gives focus back to the image link', await page.evaluate(() => document.activeElement === document.querySelector('a:has(#plain)')));

await page.click('#thumb');
await settle(600);
check('a thumbnail opens its linked full-size image (even from an assets/ folder)', (await v.text('.sub')) === '2400 × 1500', await v.text('.sub'));
await page.keyboard.press('ArrowRight');
await settle(400);
await page.evaluate(() => navigator.clipboard.writeText('stale'));
await page.keyboard.press('c');
await settle(1500);
const svgTypes = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types)).catch((e) => [String(e)]);
check('C copies an SVG as PNG', (await caption()) === 'Architecture' && svgTypes.includes('image/png'), `${await v.text('.toast')} ${svgTypes.join()}`);
await page.keyboard.press('ArrowRight');
await settle(600);
check('a broken image shows the error state', await v.q('.error').isVisible());
const original = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await v.q('.error button').click();
check('"Open original" in the error state opens the image and keeps the viewer open', !!(await original) && (await v.isOpen()));
await page.bringToFront();
await page.keyboard.press('ArrowRight');
await settle(600);
check('a missing full-size original falls back to the thumbnail', (await v.text('.sub')) === '400 × 300', await v.text('.sub'));
await page.evaluate(() => navigator.clipboard.writeText('stale'));
await page.keyboard.press('c');
await settle(1500);
const fbTypes = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types)).catch((e) => [String(e)]);
check('…and copying it copies the thumbnail', fbTypes.includes('image/png'), `${await v.text('.toast')} ${fbTypes.join()}`);

await page.setViewportSize({ width: 800, height: 420 });
await page.keyboard.press('?');
await page.mouse.move(400, 210);
await page.mouse.wheel(0, 400);
await settle(300);
check('the shortcut list scrolls on a short window', (await v.q('.help-card').evaluate((el) => el.scrollTop)) > 0);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await settle(450);
await page.setViewportSize({ width: 1440, height: 900 });
const textTab = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await page.click('#textlink', { position: { x: 150, y: 10 } });
check('clicking the text of a link that also holds an image still follows the link', !!(await textTab) && !(await v.isOpen()));
await page.bringToFront();
await page.click('#offhost');
await settle(600);
check('an original on a host the extension can\'t copy from is not shown instead of the image', (await v.text('.sub')) === '400 × 300', await v.text('.sub'));
await page.keyboard.press('Escape');

await ctx.close();
process.exit(finish());
