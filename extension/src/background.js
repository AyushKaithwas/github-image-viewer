// Service worker: performs downloads and cross-origin image fetches on behalf
// of the content script (content scripts are bound by GitHub's CORS rules).

// url -> queue of { name, folder } for downloads we started, so we can pick the
// final filename once Chrome has worked out the real extension from the response.
const pendingNames = new Map();

function takePending(url) {
  const queue = pendingNames.get(url);
  const want = queue?.shift();
  if (queue && !queue.length) pendingNames.delete(url);
  return want;
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

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const want = takePending(item.url);
  if (!want) return; // not ours: Chrome uses its default name

  const suggested = item.filename.split(/[\\/]/).pop() || '';
  const extMatch = suggested.match(/\.[a-z0-9]{2,5}$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : MIME_EXT[item.mime] || '';
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
        const queue = pendingNames.get(url);
        if (want && queue?.includes(want)) queue.splice(queue.indexOf(want), 1);
        resolve({ ok: false, error: chrome.runtime.lastError?.message || 'Download failed' });
      } else {
        resolve({ ok: true, id });
      }
    });
  });
}

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
      const blob = await res.blob();
      return { ok: true, type: blob.type, data: toBase64(await blob.arrayBuffer()) };
    } catch (err) {
      lastError = String(err?.message || err);
    }
  }
  return { ok: false, error: lastError };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'giv:download') {
    download(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'giv:download-many') {
    // Start all at once so one slow image doesn't hold up the rest.
    Promise.all(msg.items.map(download)).then((results) => {
      const ok = results.filter((r) => r.ok).length;
      sendResponse({ ok: ok > 0, count: ok, total: msg.items.length });
    });
    return true;
  }
  if (msg?.type === 'giv:fetch') {
    fetchImage(msg.urls).then(sendResponse);
    return true;
  }
  return false;
});
