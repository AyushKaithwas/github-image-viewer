// Download naming test. Playwright and CDP clients take over Chrome's download
// handling (and skip extension filename hooks), so this launches Chromium
// directly and talks to the service worker over a raw DevTools socket.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EXTENSION, FIXTURES, chromePath, reporter, tempDir } from './lib.mjs';
import './fixtures/make-images.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = tempDir('giv-profile-');
const downloads = tempDir('giv-downloads-');
fs.mkdirSync(path.join(profile, 'Default'));
fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));

// Serves a PNG at any path, including extensionless ones like GitHub's /user-attachments/assets/<id>.
const png = fs.readFileSync(path.join(FIXTURES, 'assets', 'b.png'));
const server = http.createServer((_, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(png)).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath(), [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--no-first-run',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
  target = list.find((t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'));
}
if (!target) throw new Error('extension service worker not found');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const evaluate = (expression) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});

const folder = 'GitHub images/octo-org octo-app pull 42';
await evaluate(`Promise.all([
  download({ url: '${base}/user-attachments/assets/2222-bbbb', name: '2222-bbbb' }),
  download({ url: '${base}/shots/1.png?jwt=1', name: '01 Before', folder: '${folder}' }),
  download({ url: '${base}/shots/2', name: '02 After', folder: '${folder}' }),
])`);
await sleep(2500);

const files = (function list(dir, pre = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? list(path.join(dir, d.name), `${pre}${d.name}/`) : [`${pre}${d.name}`]));
})(downloads);

const { check, finish } = reporter('Download naming');
check('extensionless URL gets its real extension', files.includes('2222-bbbb.png'), files.join(', '));
check('"download all" saves into a per-page folder', files.includes(`${folder}/01 Before.png`), files.join(', '));
check('file type is taken from the response when the URL has none', files.includes(`${folder}/02 After.png`), files.join(', '));

ws.close();
chrome.kill();
server.close();
process.exit(finish());
