// Shared helpers for the browser tests.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
/** Set EXTENSION_PATH to test another copy, e.g. the unzipped store package. */
export const EXTENSION = process.env.EXTENSION_PATH || path.join(ROOT, 'extension');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
export const OUTPUT = path.join(ROOT, 'tests', 'output');
export const IS_MAC = process.platform === 'darwin';
/** The platform's primary modifier, matching what the extension listens for. */
export const MOD = IS_MAC ? 'Meta' : 'Control';

export const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Set CHROME_PATH to use a specific Chromium build; otherwise Playwright's. */
export function chromePath() {
  return process.env.CHROME_PATH || chromium.executablePath();
}

/** Launch Chromium with the unpacked extension loaded. */
export function launchWithExtension({ headless = true, viewport = { width: 1440, height: 900 }, args = [], ...rest } = {}) {
  return chromium.launchPersistentContext(tempDir('giv-profile-'), {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    headless,
    viewport,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, ...args],
    permissions: ['clipboard-read', 'clipboard-write'],
    ...rest,
  });
}

/** The extension's service worker (Chromium may run its own workers too). */
export async function extensionWorker(ctx) {
  for (let i = 0; i < 100; i++) {
    const sw = ctx.serviceWorkers().find((w) => w.url().endsWith('/src/background.js'));
    if (sw) return sw;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('extension service worker did not start');
}

export function reporter(title) {
  const results = [];
  console.log(`\n${title}\n`);
  return {
    check(name, ok, detail = '') {
      results.push(!!ok);
      console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? `  (${detail})` : ''}`);
    },
    finish() {
      const passed = results.filter(Boolean).length;
      console.log(`\n  ${passed}/${results.length} passed\n`);
      return passed === results.length ? 0 : 1;
    },
  };
}

/** Helpers for reading the viewer's shadow DOM. */
export function viewer(page) {
  const host = page.locator('#github-image-viewer');
  const q = (sel) => host.locator(sel);
  return {
    host,
    q,
    text: (sel) => q(sel).textContent({ timeout: 2000 }).catch(() => null),
    zoom: async () => parseInt(await q('.zoom').textContent(), 10),
    imageRect: () => q('.img').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
    isOpen: () => host.isVisible(),
  };
}

/** Record the one-time consent the viewer asks for, as if the user had clicked Continue. */
export const acceptConsent = (sw) => sw.evaluate(() => chrome.storage.local.set({ consented: true }));
