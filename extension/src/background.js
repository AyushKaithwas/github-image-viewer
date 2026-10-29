// Service worker: performs downloads and cross-origin image fetches on behalf
// of the content script (content scripts are bound by GitHub's CORS rules).

// Naming intent for downloads we started, so we can pick the final filename once
// Chrome has worked out the real file type from the response. Keyed by download id
// once chrome.downloads.download reports it; until then, queued by URL.
const pendingNames = new Map();
const namesById = new Map();

function takePending(url) {
  const queue = pendingNames.get(url);
  const want = queue?.shift();
  if (queue && !queue.length) pendingNames.delete(url);
  return want;
}

function dropPending(url, want) {
  const queue = pendingNames.get(url);
  const i = queue ? queue.indexOf(want) : -1;
  if (i < 0) return false;
  queue.splice(i, 1);
  if (!queue.length) pendingNames.delete(url);
  return true;
}

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/tiff': '.tiff',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp', '.ico', '.tif', '.tiff']);

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let want = namesById.get(item.id);
  namesById.delete(item.id);
  want ??= takePending(item.url);
  if (!want) return; // not ours: Chrome uses its default name

  // Only ever save with an image extension: the server's suggested name (e.g. from
  // Content-Disposition) can carry anything, like ".v2" or ".exe".
  const suggested = item.filename.split(/[\\/]/).pop() || '';
  const suffix = suggested.match(/\.[a-z0-9]{2,5}$/i)?.[0].toLowerCase();
  const ext = MIME_EXT[item.mime] || (IMAGE_EXT.has(suffix) ? suffix : '');
  const name = (want.name || suggested.replace(/\.[a-z0-9]{2,5}$/i, '') || 'image') + ext;
  suggest({
    filename: want.folder ? `${want.folder}/${name}` : name,
    conflictAction: 'uniquify',
  });
});

function download({ url, name, folder }) {
  const want = name || folder ? { name, folder } : null;
  if (want) pendingNames.set(url, [...(pendingNames.get(url) || []), want]);
  return new Promise((resolve) => {
    chrome.downloads.download({ url, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        if (want) dropPending(url, want);
        resolve({ ok: false, error: chrome.runtime.lastError?.message || 'Download failed' });
      } else {
        // Pin the name to this download, so two downloads of the same URL can't
        // swap names if their responses arrive out of order.
        if (want && dropPending(url, want)) namesById.set(id, want);
        resolve({ ok: true, id });
      }
    });
  });
}

// Only fetch from GitHub's own hosts (the same list as host_permissions in the
// manifest), and only download over HTTPS.
const FETCH_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'camo.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'user-images.githubusercontent.com',
  'media.githubusercontent.com',
  'gist.githubusercontent.com',
]);

function httpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

const canFetch = (value) => FETCH_HOSTS.has(httpsUrl(value)?.hostname);
const isDownload = (d) => !!httpsUrl(d?.url) && ['string', 'undefined'].includes(typeof d.name) && ['string', 'undefined'].includes(typeof d.folder);

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImage(urls) {
  let lastError = 'Could not fetch image';
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      // Redirects are followed (github.com/…/raw/ → raw.githubusercontent.com), but
      // only responses from the allowed hosts are used.
      if (!canFetch(res.url)) {
        lastError = 'Redirected to an unsupported address';
        continue;
      }
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) {
        lastError = `Not an image (${blob.type || 'unknown type'})`;
        continue;
      }
      return { ok: true, type: blob.type, data: toBase64(await blob.arrayBuffer()) };
    } catch (err) {
      lastError = String(err?.message || err);
    }
  }
  return { ok: false, error: lastError };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.type === 'giv:download') {
    if (!isDownload(msg)) return sendResponse({ ok: false, error: 'Unsupported address' });
    download(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'giv:download-many') {
    if (!Array.isArray(msg.items) || !msg.items.every(isDownload)) return sendResponse({ ok: false, count: 0, total: 0 });
    // Start all at once so one slow image doesn't hold up the rest.
    Promise.all(msg.items.map(download)).then((results) => {
      const ok = results.filter((r) => r.ok).length;
      sendResponse({ ok: ok > 0, count: ok, total: msg.items.length });
    });
    return true;
  }
  if (msg?.type === 'giv:fetch') {
    const urls = Array.isArray(msg.urls) ? msg.urls.filter(canFetch) : [];
    if (!urls.length) return sendResponse({ ok: false, error: 'Unsupported address' });
    fetchImage(urls).then(sendResponse);
    return true;
  }
  return false;
});
