// Image Viewer for GitHub: intercepts clicks on images in rendered markdown
// (PR/issue bodies, comments, READMEs) and shows them in an in-page viewer.
(() => {
  'use strict';
  if (window.__githubImageViewer) return;
  window.__githubImageViewer = true;

  // ---------------------------------------------------------------------------
  // Finding images
  // ---------------------------------------------------------------------------

  const SCOPE = ['.markdown-body', '.comment-body', '.js-comment-body'];
  const SCOPE_SELECTOR = SCOPE.join(',');
  const IMG_SELECTOR = SCOPE.map((s) => `${s} img`).join(',');
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?)$/i;
  const GENERIC_ALT = /^(image|img|screenshot|screen shot|picture|photo|untitled|grafik|bild)$/i;
  const MIN_SIZE = 32; // smaller than this is a badge or an icon, not a picture

  const parseUrl = (u) => {
    try {
      return new URL(u, location.href);
    } catch {
      return null;
    }
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const ellipsize = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const sanitize = (s, max = 80) =>
    clean(s)
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, max) || 'image';

  // Does a link around an image point at the image itself (as GitHub's
  // markdown renderer does), rather than somewhere else (badges, CI links)?
  // GitHub hosts the viewer may load a linked original from. Kept in step with the
  // manifest's host_permissions, so that what's shown can also be copied.
  const ORIGINAL_HOSTS = /^(github\.com|(raw|private-user-images|user-images|media|gist)\.githubusercontent\.com)$/;
  // GitHub's attachment links: github.com/user-attachments/assets/<id> or /<owner>/<repo>/assets/<id>.
  const isAttachment = (u) => u.hostname === 'github.com' && /^\/(user-attachments|[^/]+\/[^/]+)\/assets\//.test(u.pathname);

  function isImageLink(href, img) {
    const u = parseUrl(href);
    if (!u) return false;
    if ([img.currentSrc, img.src, img.dataset.canonicalSrc].includes(u.href)) return true;
    if (/(^|\.)githubusercontent\.com$/.test(u.hostname)) return true;
    if (isAttachment(u)) return true;
    return IMAGE_EXT.test(u.pathname);
  }

  function isEligible(img, clicked) {
    if (!img.closest(SCOPE_SELECTOR)) return false;
    if (img.closest('g-emoji, .emoji, .avatar, .AvatarStack, .reaction-summary-item')) return false;
    if (img.matches('.emoji, .avatar')) return false;
    if (!img.currentSrc && !img.src) return false;
    const a = img.closest('a[href]');
    if (a && !isImageLink(a.href, img)) return false;
    if (img.complete && img.naturalWidth && (img.naturalWidth < MIN_SIZE || img.naturalHeight < MIN_SIZE)) return false;
    // Skip images the reader can't currently see, e.g. inside a collapsed <details>.
    if (!clicked) {
      const visible = img.checkVisibility
        ? img.checkVisibility({ visibilityProperty: true })
        : img.getClientRects().length > 0;
      if (!visible) return false;
    }
    return true;
  }

  function cellAtColumn(row, col) {
    let i = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan || 1;
      if (col >= i && col < i + span) return cell;
      i += span;
    }
    return null;
  }

  // Screenshots in PRs are often laid out in tables with a heading row
  // ("Before" | "After"). Use the heading of the image's column as caption.
  function tableCaption(img) {
    const cell = img.closest('td, th');
    const table = cell?.closest('table');
    if (!table || !img.closest(SCOPE_SELECTOR)?.contains(table)) return '';
    const own = clean(cell.textContent);
    if (own) return own.length <= 140 ? own : '';
    const row = cell.parentElement;
    let col = 0;
    for (const c of row.cells) {
      if (c === cell) break;
      col += c.colSpan || 1;
    }
    const rows = Array.from(table.rows);
    for (let r = rows.indexOf(row) - 1; r >= 0; r--) {
      const c = cellAtColumn(rows[r], col);
      if (!c || c.querySelector('img')) continue;
      const text = clean(c.textContent);
      if (text) return ellipsize(text, 140);
    }
    return '';
  }

  function captionFor(img) {
    const fromTable = tableCaption(img);
    if (fromTable) return fromTable;
    const fig = img.closest('figure')?.querySelector('figcaption');
    if (fig && clean(fig.textContent)) return ellipsize(clean(fig.textContent), 140);
    const alt = clean(img.getAttribute('alt'));
    if (alt && !GENERIC_ALT.test(alt)) return ellipsize(alt, 140);
    return clean(img.getAttribute('title'));
  }

  function authorFor(img) {
    // Classic PR/issue markup and the newer React issue view.
    const box = img.closest(
      '.timeline-comment, .review-comment, .js-comment-container, .TimelineItem, .react-issue-comment, ' +
        '[data-testid="issue-body"], [data-testid^="comment-viewer-outer-box"]'
    );
    const a = box?.querySelector(
      'a.author, a[data-testid="issue-body-header-author"], a[data-testid="avatar-link"], a[data-hovercard-type="user"]'
    );
    if (!a) return '';
    // Link text can be "Full Name (login)", so take the login from the profile URL.
    const fromHref = (parseUrl(a.getAttribute('href') || '')?.pathname || '').split('/').filter(Boolean).pop();
    const login = fromHref || clean(a.textContent);
    return /^[\w-]+(\[bot\])?$/.test(login) ? login : '';
  }

  function nameFor(img, full) {
    for (const candidate of [img.dataset.canonicalSrc, full, img.currentSrc || img.src]) {
      const u = candidate && parseUrl(candidate);
      if (!u || u.hostname === 'camo.githubusercontent.com') continue;
      const last = u.pathname.split('/').filter(Boolean).pop();
      if (!last) continue;
      let decoded = last;
      try {
        decoded = decodeURIComponent(last);
      } catch {}
      return decoded.replace(/\.[a-z0-9]{2,5}$/i, '');
    }
    return 'image';
  }

  // The colour the image sat on in the page, so transparent images stay legible.
  function backgroundFor(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#ffffff';
  }

  // Should the viewer show the linked file instead of the <img>? Only when the link is
  // a different raw file on GitHub, e.g. a README thumbnail linking to the full-size
  // image. Attachment links are the same picture as the <img> under another URL, and
  // going straight to an external URL would skip GitHub's camo image proxy.
  function isLargerOriginal(full, src) {
    const f = parseUrl(full);
    const s = parseUrl(src);
    if (!f || !s || f.origin + f.pathname === s.origin + s.pathname) return false;
    return f.protocol === 'https:' && ORIGINAL_HOSTS.test(f.hostname) && !isAttachment(f);
  }

  function toItem(img) {
    const src = img.currentSrc || img.src;
    let full = src;
    const a = img.closest('a[href]');
    const u = a && parseUrl(a.href);
    // Plain-http originals are skipped: the page's own (https) image is used instead.
    if (u?.protocol === 'https:' && isImageLink(a.href, img)) {
      // /blob/ links go to the HTML file page; /raw/ serves the file itself.
      if (u.hostname === location.hostname) u.pathname = u.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, '$1/raw/');
      full = u.href;
    }
    return {
      el: img,
      src,
      view: isLargerOriginal(full, src) ? full : src,
      full,
      caption: captionFor(img),
      author: authorFor(img),
      name: nameFor(img, full),
      bg: backgroundFor(img),
    };
  }

  function collect(clicked) {
    const imgs = Array.from(document.querySelectorAll(IMG_SELECTOR)).filter(
      (img) => img === clicked || isEligible(img, false)
    );
    return { items: imgs.map(toItem), index: Math.max(0, imgs.indexOf(clicked)) };
  }

  // ---------------------------------------------------------------------------
  // Talking to the service worker
  // ---------------------------------------------------------------------------

  function hasRuntime() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function send(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function base64ToBlob(data, type) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // ---------------------------------------------------------------------------
  // Viewer UI
  // ---------------------------------------------------------------------------

  const IS_MAC = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const SHIFT = IS_MAC ? '⇧' : 'Shift+';
  const CMD = IS_MAC ? '⌘' : 'Ctrl';
  const SHIFT_KEY = IS_MAC ? '⇧' : 'Shift';
  // Each shortcut lists alternatives ("/" between them); each alternative is a
  // combo of keys drawn as separate caps. Modifiers follow Apple's order (⇧ before ⌘).
  const combo = (keys) => `<span class="combo">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>`;
  const keys = (...alts) => alts.map((alt) => combo([].concat(alt))).join('<span class="or">/</span>');
  const gesture = (text) => `<span class="gesture">${text}</span>`;
  const SHORTCUTS = [
    [keys('←', '→'), 'Previous / next image'],
    [IS_MAC ? keys([CMD, '←'], [CMD, '→']) : keys('Home', 'End'), 'First / last image'],
    [keys('+', '−'), 'Zoom in / out'],
    [keys('0', '1'), 'Fit to screen / actual size'],
    [gesture('Scroll, pinch'), 'Zoom at the cursor'],
    [gesture('Click'), 'Zoom in at that point / back to fit'],
    [gesture('Drag'), 'Pan when zoomed, otherwise swipe to the next image'],
    [keys('R', [SHIFT_KEY, 'R']), 'Rotate clockwise / counter-clockwise'],
    [keys('C'), 'Copy image'],
    [keys('L'), 'Copy image link'],
    [keys('D'), 'Download image'],
    [keys([SHIFT_KEY, 'D']), 'Download all images'],
    [keys('O'), 'Open original in new tab'],
    [keys('F'), 'Fullscreen'],
    [keys('Esc'), 'Close'],
  ];
  const SHORTCUT_NOTE = IS_MAC
    ? '⌘C, ⌘S, ⌘+ / ⌘− and ⌘0 work too. ⌘-click an image on GitHub to open it in a new tab.'
    : 'Ctrl+C, Ctrl+S, Ctrl+plus / minus and Ctrl+0 work too. Ctrl-click an image on GitHub to open it in a new tab.';

  const svg = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    prev: svg('<path d="m15 18-6-6 6-6"/>'),
    next: svg('<path d="m9 18 6-6-6-6"/>'),
    zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>'),
    zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>'),
    fit: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),
    rotate: svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    external: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>'),
    downloadAll: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6m3-3-3 3-3-3"/>'),
    fullscreen: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
    help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>'),
  };

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .root {
      position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr auto;
      color: #e6edf3; outline: none;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    }
    .backdrop {
      position: absolute; inset: 0; background: rgba(1, 4, 9, 0.92);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    }
    .backdrop, .bar, .strip, .nav { opacity: 0; transition: opacity 0.2s ease; }
    .root.open .backdrop, .root.open .bar, .root.open .strip, .root.open .nav { opacity: 1; }

    .bar {
      position: relative; z-index: 2; display: flex; align-items: center; gap: 12px;
      padding: 8px 10px 8px 18px; min-height: 52px;
      background: linear-gradient(rgba(1, 4, 9, 0.8), rgba(1, 4, 9, 0));
    }
    .meta { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
    .counter { flex: none; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
    .caption { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .sub { flex: none; color: #8d96a0; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .actions { display: flex; align-items: center; gap: 2px; flex: none; }
    .sep { width: 1px; height: 20px; background: rgba(240, 246, 252, 0.14); margin: 0 6px; }
    button { font: inherit; color: inherit; }
    .icon {
      width: 34px; height: 34px; display: grid; place-items: center; padding: 0;
      border: 0; border-radius: 8px; background: transparent; color: #c9d1d9; cursor: pointer;
    }
    .icon:hover { background: rgba(240, 246, 252, 0.1); color: #fff; }
    .icon:focus-visible, .zoom:focus-visible, .thumb:focus-visible, .nav:focus-visible {
      outline: 2px solid #4493f8; outline-offset: -2px;
    }
    .icon svg { width: 18px; height: 18px; }
    .zoom {
      min-width: 54px; height: 34px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent;
      color: #c9d1d9; cursor: pointer; font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .zoom:hover { background: rgba(240, 246, 252, 0.1); color: #fff; }

    .main { position: relative; overflow: hidden; }
    .stage { position: absolute; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; }
    .stage.can-pan { cursor: grab; }
    .stage.panning { cursor: grabbing; }
    .img {
      position: absolute; left: 50%; top: 50%; max-width: none; max-height: none;
      transform-origin: center; user-select: none; -webkit-user-drag: none; cursor: zoom-in;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.55); image-orientation: from-image;
    }
    .stage.can-pan .img { cursor: inherit; }
    .img.animate {
      transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
        height 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease;
    }
    .img.enter { animation: fade-in 0.18s ease; }
    .img.fade-out { opacity: 0; transition: opacity 0.18s ease; }
    @keyframes fade-in { from { opacity: 0; } }
    .img[hidden] { display: none; }

    .nav {
      position: absolute; top: 50%; z-index: 2; width: 48px; height: 48px; margin-top: -24px; padding: 0;
      display: grid; place-items: center; border-radius: 50%; cursor: pointer; color: #e6edf3;
      background: rgba(22, 27, 34, 0.72); border: 1px solid rgba(240, 246, 252, 0.12);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    .nav:hover:not(:disabled) { background: rgba(48, 54, 61, 0.9); color: #fff; }
    .nav:disabled { opacity: 0 !important; pointer-events: none; }
    .nav svg { width: 24px; height: 24px; }
    .nav.prev { left: 16px; }
    .nav.next { right: 16px; }

    .strip {
      position: relative; z-index: 2; display: flex; gap: 8px; padding: 10px 16px 14px;
      overflow-x: auto; justify-content: safe center; scrollbar-width: thin;
      scrollbar-color: rgba(240, 246, 252, 0.2) transparent;
      background: linear-gradient(rgba(1, 4, 9, 0), rgba(1, 4, 9, 0.8));
    }
    .thumb {
      flex: none; width: 68px; height: 48px; padding: 0; border: 0; border-radius: 6px; overflow: hidden;
      background: #161b22; cursor: pointer; opacity: 0.45;
      outline: 2px solid transparent; outline-offset: 2px; transition: opacity 0.15s, outline-color 0.15s;
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
    .thumb:hover { opacity: 0.85; }
    .thumb.active { opacity: 1; outline-color: #4493f8; }
    .root.single .strip, .root.single .nav, .root.single .counter, .root.single [data-action="downloadAll"] { display: none; }

    .spinner {
      position: absolute; left: 50%; top: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px;
      border-radius: 50%; border: 3px solid rgba(240, 246, 252, 0.15); border-top-color: #e6edf3;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center;
      color: #8d96a0; display: grid; gap: 12px; justify-items: center;
    }
    .error button {
      border: 1px solid rgba(240, 246, 252, 0.2); background: rgba(240, 246, 252, 0.06); color: #e6edf3;
      border-radius: 6px; padding: 6px 12px; cursor: pointer;
    }
    [hidden] { display: none !important; }

    .toast {
      position: absolute; left: 50%; bottom: 92px; z-index: 4; pointer-events: none;
      transform: translate(-50%, 8px); opacity: 0; transition: opacity 0.18s, transform 0.18s;
      background: rgba(22, 27, 34, 0.95); border: 1px solid rgba(240, 246, 252, 0.15);
      padding: 8px 14px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); white-space: nowrap;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .root.single .toast { bottom: 28px; }

    .root.asking .bar, .root.asking .main, .root.asking .strip { visibility: hidden; }
    .consent { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; }
    .consent-card {
      width: min(440px, calc(100vw - 32px)); background: #161b22; border: 1px solid #30363d; border-radius: 12px;
      padding: 22px 24px 20px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    }
    .consent-card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #fff; }
    .consent-card p { margin: 0 0 10px; color: #c9d1d9; }
    .consent-card a { color: #4493f8; }
    .consent-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .consent-actions button {
      border: 1px solid rgba(240, 246, 252, 0.2); background: rgba(240, 246, 252, 0.06); color: #e6edf3;
      border-radius: 6px; padding: 6px 14px; cursor: pointer; font-weight: 500;
    }
    .consent-actions button:hover { background: rgba(240, 246, 252, 0.12); }
    .consent-actions .primary { background: #238636; border-color: rgba(240, 246, 252, 0.1); color: #fff; }
    .consent-actions .primary:hover { background: #2ea043; }
    .consent-actions button:focus-visible { outline: 2px solid #4493f8; outline-offset: 2px; }

    .help { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; background: rgba(1, 4, 9, 0.6); }
    .help-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px 24px 22px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
      overflow: auto; overscroll-behavior: contain;
    }
    .help-card h2 { margin: 0 0 14px; font-size: 14px; font-weight: 600; color: #fff; }
    .help-card dl { display: grid; grid-template-columns: auto 1fr; gap: 10px 20px; margin: 0; align-items: center; }
    .help-card dt { display: flex; justify-content: flex-end; align-items: center; white-space: nowrap; }
    .help-card dd { margin: 0; color: #c9d1d9; }
    .help-card p { width: 0; min-width: 100%; margin: 18px 0 0; padding-top: 14px; border-top: 1px solid #30363d; color: #8d96a0; font-size: 12px; }
    .combo { display: inline-flex; gap: 3px; }
    .or { margin: 0 6px; color: #6e7681; }
    .gesture { color: #8d96a0; font-size: 12px; }
    kbd {
      display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
      min-width: 24px; height: 24px; padding: 0 7px;
      font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      color: #e6edf3; background: linear-gradient(#2d333b, #22272e);
      border: 1px solid #444c56; border-radius: 6px; box-shadow: inset 0 -1px 0 rgba(1, 4, 9, 0.6), 0 1px 0 rgba(1, 4, 9, 0.4);
    }

    @media (max-width: 760px) {
      .bar { padding-left: 12px; gap: 6px; }
      .sub, .sep, [data-action="rotate"], [data-action="copyLink"], [data-action="open"],
      [data-action="downloadAll"], [data-action="help"], [data-action="zoomIn"], [data-action="zoomOut"] { display: none; }
      .nav { width: 40px; height: 40px; margin-top: -20px; }
      .nav.prev { left: 8px; } .nav.next { right: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
    }
  `;

  const TEMPLATE = `
    <div class="root" role="dialog" aria-modal="true" aria-label="Image viewer" tabindex="-1">
      <div class="backdrop"></div>
      <header class="bar">
        <div class="meta">
          <span class="counter"></span>
          <span class="caption"></span>
          <span class="sub"></span>
        </div>
        <div class="actions">
          <button class="icon" data-action="zoomOut" title="Zoom out (−, ${MOD}−)" aria-label="Zoom out">${ICONS.zoomOut}</button>
          <button class="zoom" data-action="toggleZoom" title="Toggle fit / actual size (0 / 1)" aria-label="Zoom level">100%</button>
          <button class="icon" data-action="zoomIn" title="Zoom in (+, ${MOD}+)" aria-label="Zoom in">${ICONS.zoomIn}</button>
          <button class="icon" data-action="fit" title="Fit to screen (0)" aria-label="Fit to screen">${ICONS.fit}</button>
          <button class="icon" data-action="rotate" title="Rotate (R, ${SHIFT}R)" aria-label="Rotate">${ICONS.rotate}</button>
          <span class="sep"></span>
          <button class="icon" data-action="copy" title="Copy image (C, ${MOD}C)" aria-label="Copy image">${ICONS.copy}</button>
          <button class="icon" data-action="copyLink" title="Copy image link (L)" aria-label="Copy image link">${ICONS.link}</button>
          <button class="icon" data-action="open" title="Open original in new tab (O)" aria-label="Open original">${ICONS.external}</button>
          <button class="icon" data-action="download" title="Download (D, ${MOD}S)" aria-label="Download">${ICONS.download}</button>
          <button class="icon" data-action="downloadAll" title="Download all images (${SHIFT}D)" aria-label="Download all images">${ICONS.downloadAll}</button>
          <span class="sep"></span>
          <button class="icon" data-action="fullscreen" title="Fullscreen (F)" aria-label="Fullscreen">${ICONS.fullscreen}</button>
          <button class="icon" data-action="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${ICONS.help}</button>
          <button class="icon" data-action="close" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
        </div>
      </header>
      <div class="main">
        <div class="stage">
          <img class="img" alt="" draggable="false" hidden>
          <div class="spinner" hidden></div>
          <div class="error" hidden>
            <span>Couldn't load this image.</span>
            <button data-action="open">Open original</button>
          </div>
        </div>
        <button class="nav prev" data-action="prev" title="Previous (←)" aria-label="Previous image">${ICONS.prev}</button>
        <button class="nav next" data-action="next" title="Next (→)" aria-label="Next image">${ICONS.next}</button>
      </div>
      <nav class="strip" aria-label="All images"></nav>
      <div class="toast" role="status" aria-live="polite"></div>
      <div class="consent" role="alertdialog" aria-labelledby="giv-consent-title" aria-describedby="giv-consent-text" hidden>
        <div class="consent-card">
          <h2 id="giv-consent-title">Open GitHub images right here</h2>
          <div id="giv-consent-text">
            <p>To show them in this viewer, Image Viewer for GitHub reads the images in a page's comments and READMEs, their captions, and the usernames of the people who posted them.</p>
            <p>This stays in your browser and is never sent to the developer. The only requests made are for the images themselves, from where they're hosted (normally GitHub), just as the page does.
              <a href="https://github.com/AyushKaithwas/github-image-viewer/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">Privacy policy</a></p>
          </div>
          <div class="consent-actions">
            <button data-action="consentNo">Not now</button>
            <button class="primary" data-action="consentYes">Continue</button>
          </div>
        </div>
      </div>
      <div class="help" hidden>
        <div class="help-card">
          <h2>Keyboard shortcuts</h2>
          <dl>
            ${SHORTCUTS.map(([keys, label]) => `<dt>${keys}</dt><dd>${label}</dd>`).join('')}
          </dl>
          <p>${SHORTCUT_NOTE}</p>
        </div>
      </div>
    </div>
  `;

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  let ui = null; // DOM references, built on first open
  let isOpen = false;
  let helpOpen = false;
  let helpReturn = null; // focused button before the help overlay opened
  let closeTimer = 0;
  let toastTimer = 0;
  let savedScroll = null;
  let opener = null; // focused element before opening, refocused on close
  // The user agrees once, in the viewer, before it reads anything from a page.
  let consented = false;
  let asking = null; // the clicked image while the consent card is up
  const S = { items: [], index: 0, nat: { w: 0, h: 0 }, scale: 1, x: 0, y: 0, rot: 0, fitted: true, loaded: false, token: 0 };

  function build() {
    if (ui) {
      // GitHub may have replaced <html> children during navigation.
      if (!ui.host.isConnected) document.documentElement.append(ui.host);
      return;
    }
    const host = document.createElement('div');
    host.id = 'github-image-viewer';
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; display: none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${TEMPLATE}`;
    // Attach to <html>, not <body>: GitHub's Turbo navigation swaps <body>.
    document.documentElement.append(host);

    const $ = (sel) => shadow.querySelector(sel);
    ui = {
      host,
      shadow,
      root: $('.root'),
      stage: $('.stage'),
      img: $('.img'),
      spinner: $('.spinner'),
      error: $('.error'),
      counter: $('.counter'),
      caption: $('.caption'),
      sub: $('.sub'),
      zoom: $('.zoom'),
      prev: $('.nav.prev'),
      next: $('.nav.next'),
      strip: $('.strip'),
      toast: $('.toast'),
      help: $('.help'),
      consent: $('.consent'),
    };

    ui.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn && ACTIONS[btn.dataset.action]) {
        e.stopPropagation();
        ACTIONS[btn.dataset.action]();
      }
    });
    ui.help.addEventListener('click', (e) => {
      if (e.target === ui.help) toggleHelp(false);
    });
    ui.root.addEventListener('wheel', (e) => {
      if (!e.target.closest('.strip, .help-card')) e.preventDefault();
    }, { passive: false });
    ui.strip.addEventListener('wheel', (e) => {
      // Let a vertical mouse wheel scroll the thumbnail strip sideways.
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        ui.strip.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    bindStage();
    new ResizeObserver(() => {
      if (!isOpen || !S.loaded) return;
      if (S.fitted) setFit();
      else clampPan();
      apply(false);
    }).observe(ui.stage);
    document.addEventListener('fullscreenchange', () => {
      ui.root.querySelector('[data-action="fullscreen"]').title =
        document.fullscreenElement === host ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
    });
  }

  // ---------------------------------------------------------------------------
  // Geometry: the image is centred in the stage, offset by (x, y) and drawn at
  // `scale` × its natural size. Sizing via width/height keeps it sharp.
  // ---------------------------------------------------------------------------

  function rotatedSize() {
    const sideways = S.rot % 180 !== 0;
    return sideways ? { w: S.nat.h, h: S.nat.w } : { w: S.nat.w, h: S.nat.h };
  }

  function fitScale() {
    const { w, h } = rotatedSize();
    if (!w || !h) return 1;
    const pad = ui.stage.clientWidth < 600 ? 8 : 32;
    const aw = Math.max(1, ui.stage.clientWidth - pad * 2);
    const ah = Math.max(1, ui.stage.clientHeight - pad * 2);
    return Math.min(1, aw / w, ah / h);
  }

  const isZoomed = () => S.loaded && S.scale > fitScale() + 0.001;

  function clampPan() {
    const { w, h } = rotatedSize();
    const mx = Math.max(0, (w * S.scale - ui.stage.clientWidth) / 2);
    const my = Math.max(0, (h * S.scale - ui.stage.clientHeight) / 2);
    S.x = clamp(S.x, -mx, mx);
    S.y = clamp(S.y, -my, my);
  }

  function apply(animate) {
    const { img } = ui;
    img.classList.toggle('animate', !!animate);
    img.style.width = `${S.nat.w * S.scale}px`;
    img.style.height = `${S.nat.h * S.scale}px`;
    img.style.transform = `translate(-50%, -50%) translate(${S.x}px, ${S.y}px) rotate(${S.rot}deg)`;
    ui.zoom.textContent = `${Math.round(S.scale * 100)}%`;
    ui.stage.classList.toggle('can-pan', isZoomed());
  }

  function setFit() {
    S.scale = fitScale();
    S.x = 0;
    S.y = 0;
    S.fitted = true;
  }

  function fit(animate = true) {
    if (!S.loaded) return;
    setFit();
    apply(animate);
  }

  const clampScale = (s, f = fitScale()) => clamp(s, Math.min(f, 1) * 0.5, Math.max(10, f * 10));

  // (px, py) is the point to keep still, relative to the stage centre.
  function zoomTo(next, px = 0, py = 0, animate = false) {
    if (!S.loaded) return;
    const f = fitScale();
    next = clampScale(next, f);
    const k = next / S.scale;
    S.x = px - (px - S.x) * k;
    S.y = py - (py - S.y) * k;
    S.scale = next;
    S.fitted = Math.abs(next - f) < 0.001;
    clampPan();
    apply(animate);
  }

  function stagePoint(clientX, clientY) {
    const r = ui.stage.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2];
  }

  function toggleZoomAt(px = 0, py = 0) {
    if (isZoomed()) fit(true);
    else zoomTo(Math.max(1, fitScale() * 2), px, py, true);
  }

  // ---------------------------------------------------------------------------
  // Pointer, wheel and touch
  // ---------------------------------------------------------------------------

  function bindStage() {
    const { stage, img } = ui;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let swipeAccum = 0;
    let swipeLock = 0;
    let lastTap = { t: 0, x: 0, y: 0 };

    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Leave buttons on the stage (the error state's "Open original") alone:
      // capturing the pointer would retarget their click to the stage.
      if (e.target.closest('button')) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const [mx, my] = stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: S.scale, x: S.x, y: S.y, mx, my };
        drag = null;
        stage.classList.remove('panning');
        return;
      }
      if (pointers.size > 2) return;
      drag = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        x0: S.x,
        y0: S.y,
        t: performance.now(),
        moved: false,
        pan: isZoomed(),
        onImage: e.target === img,
      };
      if (drag.pan) stage.classList.add('panning');
    });

    stage.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        if (!S.loaded) return;
        // Keep the image point that started under the fingers' midpoint under it,
        // so the image follows the fingers as they spread and move.
        const [a, b] = [...pointers.values()];
        const [mx, my] = stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const f = fitScale();
        const next = clampScale((pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist, f);
        const k = next / pinch.scale;
        S.x = mx - (pinch.mx - pinch.x) * k;
        S.y = my - (pinch.my - pinch.y) * k;
        S.scale = next;
        S.fitted = Math.abs(next - f) < 0.001;
        clampPan();
        apply(false);
        return;
      }
      if (!drag || drag.id !== e.pointerId || !S.loaded) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      if (drag.pan) {
        S.x = drag.x0 + dx;
        S.y = drag.y0 + dy;
        clampPan();
        apply(false);
      } else if (S.items.length > 1) {
        const atEdge = (dx > 0 && S.index === 0) || (dx < 0 && S.index === S.items.length - 1);
        S.x = drag.x0 + (atEdge ? dx * 0.25 : dx);
        apply(false);
      }
    });

    const end = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      stage.classList.remove('panning');
      if (!d.moved) {
        if (e.type !== 'pointerup') return;
        if (!d.onImage) {
          close();
          return;
        }
        // Click (or tap) on the image toggles zoom. Handled here rather than via
        // click/dblclick events: pointer capture retargets those to the stage.
        // The second click of a double-click is swallowed so it doesn't undo the first.
        const now = performance.now();
        const repeat = now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
        lastTap = repeat ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
        if (!repeat) toggleZoomAt(...stagePoint(e.clientX, e.clientY));
        return;
      }
      if (d.pan || !S.loaded) return;
      const dx = e.clientX - d.sx;
      const fast = Math.abs(dx) / (performance.now() - d.t) > 0.5;
      if (e.type === 'pointerup' && (Math.abs(dx) > 80 || (fast && Math.abs(dx) > 30)) && go(dx < 0 ? 1 : -1)) return;
      S.x = d.x0;
      S.y = d.y0;
      apply(true);
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!S.loaded) return;
      const horizontal = !e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        if (isZoomed()) {
          S.x -= e.deltaX;
          clampPan();
          apply(false);
          return;
        }
        // Two-finger horizontal swipe on a trackpad moves between images.
        const now = performance.now();
        if (now < swipeLock) return;
        swipeAccum += e.deltaX;
        if (Math.abs(swipeAccum) > 120) {
          go(swipeAccum > 0 ? 1 : -1);
          swipeAccum = 0;
          swipeLock = now + 450;
        }
        return;
      }
      if (!e.ctrlKey && e.shiftKey && isZoomed()) {
        S.x -= e.deltaY;
        clampPan();
        apply(false);
        return;
      }
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002));
      zoomTo(S.scale * factor, ...stagePoint(e.clientX, e.clientY));
    }, { passive: false });
  }

  // ---------------------------------------------------------------------------
  // Showing images
  // ---------------------------------------------------------------------------

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = () => resolve({ w: probe.naturalWidth || 1024, h: probe.naturalHeight || 768 });
      probe.onerror = () => reject(new Error('load failed'));
      probe.src = src;
    });
  }

  function inViewport(r) {
    return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  // Put the image exactly over its thumbnail in the page.
  function placeOver(el) {
    const r = el.getBoundingClientRect();
    if (!inViewport(r) || !S.nat.w) return false;
    const sr = ui.stage.getBoundingClientRect();
    S.scale = r.width / S.nat.w;
    S.x = r.left + r.width / 2 - (sr.left + sr.width / 2);
    S.y = r.top + r.height / 2 - (sr.top + sr.height / 2);
    return true;
  }

  async function show(index, { fromPage = false } = {}) {
    const item = S.items[index];
    if (!item) return;
    const token = ++S.token;
    S.index = index;
    S.rot = 0;
    updateChrome();

    const { img, spinner, error } = ui;
    error.hidden = true;
    spinner.hidden = true;
    let dims = null;
    let src = item.view;
    const el = item.el;
    if (el.isConnected && el.complete && el.naturalWidth && (el.currentSrc || el.src) === src) {
      dims = { w: el.naturalWidth, h: el.naturalHeight };
    } else {
      S.loaded = false;
      img.hidden = true;
      ui.zoom.textContent = '—';
      const spin = setTimeout(() => {
        if (token === S.token) spinner.hidden = false;
      }, 120);
      try {
        dims = await loadImage(src).catch((err) => {
          if (src === item.src || token !== S.token) throw err;
          // The linked original failed: show (and copy) what the page showed.
          src = item.view = item.src;
          return loadImage(src);
        });
      } catch {
        if (token !== S.token) return;
        clearTimeout(spin);
        spinner.hidden = true;
        error.hidden = false;
        return;
      } finally {
        clearTimeout(spin);
      }
      if (token !== S.token) return;
      spinner.hidden = true;
    }

    S.nat = dims;
    S.loaded = true;
    img.src = src;
    img.alt = item.caption;
    img.style.backgroundColor = item.bg;
    img.classList.remove('fade-out', 'enter');
    img.hidden = false;
    ui.sub.textContent = [item.author && `@${item.author}`, `${dims.w} × ${dims.h}`].filter(Boolean).join(' · ');

    if (fromPage && !reducedMotion() && placeOver(el)) {
      apply(false);
      void img.offsetWidth; // commit the start position before animating
      setFit();
      apply(true);
    } else {
      setFit();
      apply(false);
      void img.offsetWidth;
      img.classList.add('enter');
    }

    for (const n of [index + 1, index - 1]) {
      if (S.items[n]) new Image().src = S.items[n].view;
    }
  }

  function updateChrome() {
    const n = S.items.length;
    const item = S.items[S.index];
    ui.counter.textContent = `${S.index + 1} / ${n}`;
    ui.caption.textContent = item.caption;
    ui.caption.title = item.caption;
    ui.sub.textContent = item.author ? `@${item.author}` : '';
    ui.prev.disabled = S.index === 0;
    ui.next.disabled = S.index === n - 1;
    const thumbs = ui.strip.children;
    for (let i = 0; i < thumbs.length; i++) {
      thumbs[i].classList.toggle('active', i === S.index);
      if (i === S.index) thumbs[i].setAttribute('aria-current', 'true');
      else thumbs[i].removeAttribute('aria-current');
    }
    const active = thumbs[S.index];
    if (active) {
      ui.strip.scrollTo({
        left: active.offsetLeft - ui.strip.clientWidth / 2 + active.offsetWidth / 2,
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
    }
  }

  function renderStrip() {
    ui.strip.textContent = '';
    ui.root.classList.toggle('single', S.items.length < 2);
    if (S.items.length < 2) return;
    S.items.forEach((item, i) => {
      const b = document.createElement('button');
      b.className = 'thumb';
      b.title = item.caption || `Image ${i + 1}`;
      b.setAttribute('aria-label', `Image ${i + 1}${item.caption ? `: ${item.caption}` : ''}`);
      const t = document.createElement('img');
      t.src = item.src;
      t.alt = '';
      t.loading = 'lazy';
      t.draggable = false;
      b.append(t);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        go(i - S.index);
      });
      ui.strip.append(b);
    });
  }

  function go(delta) {
    const next = S.index + delta;
    if (delta === 0 || next < 0 || next >= S.items.length) return false;
    show(next);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------

  function lockScroll() {
    if (savedScroll) return; // still locked from a close that hasn't finished
    const de = document.documentElement;
    savedScroll = { overflow: de.style.overflow, paddingRight: de.style.paddingRight };
    const scrollbar = innerWidth - de.clientWidth;
    de.style.overflow = 'hidden';
    if (scrollbar > 0) de.style.paddingRight = `${scrollbar}px`;
  }

  function unlockScroll() {
    if (!savedScroll) return;
    const de = document.documentElement;
    de.style.overflow = savedScroll.overflow;
    de.style.paddingRight = savedScroll.paddingRight;
    savedScroll = null;
  }

  function open(items, index) {
    build();
    clearTimeout(closeTimer);
    if (!isOpen) {
      lockScroll();
      opener ??= document.activeElement;
    }
    isOpen = true;
    S.items = items;
    ui.host.style.display = 'block';
    ui.root.classList.remove('open');
    renderStrip();
    void ui.root.offsetWidth;
    ui.root.classList.add('open');
    ui.root.focus({ preventScroll: true });
    show(index, { fromPage: true });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    toggleHelp(false);
    S.token++; // cancel any pending load
    if (document.fullscreenElement === ui.host) document.exitFullscreen().catch(() => {});

    const el = S.items[S.index]?.el;
    let flew = false;
    if (S.loaded && el?.isConnected && S.rot % 360 === 0 && !reducedMotion()) {
      if (!inViewport(el.getBoundingClientRect())) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      flew = placeOver(el);
      if (flew) apply(true);
    }
    if (!flew) ui.img.classList.add('fade-out');
    ui.root.classList.remove('open');
    if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    opener = null;
    closeTimer = setTimeout(() => {
      ui.host.style.display = 'none';
      ui.img.hidden = true;
      ui.img.removeAttribute('src');
      ui.strip.textContent = '';
      S.items = [];
      S.loaded = false;
      unlockScroll();
    }, reducedMotion() ? 0 : 280);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function toast(message, ms = 1800) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
  }

  function toggleHelp(force) {
    if (!ui) return;
    const was = helpOpen;
    helpOpen = force ?? !helpOpen;
    ui.help.hidden = !helpOpen;
    // Take focus off the button under the overlay, and give it back afterwards.
    if (helpOpen && !was) {
      helpReturn = ui.shadow.activeElement;
      ui.root.focus({ preventScroll: true });
    } else if (!helpOpen && was) {
      if (isOpen) (helpReturn?.isConnected ? helpReturn : ui.root).focus({ preventScroll: true });
      helpReturn = null;
    }
  }

  const current = () => S.items[S.index];

  function folderName() {
    // e.g. "GitHub images/octo-org octo-app pull 42"
    const parts = location.pathname.split('/').filter(Boolean).slice(0, 4);
    return `GitHub images/${sanitize(parts.join(' ') || location.hostname, 100)}`;
  }

  async function download() {
    const item = current();
    if (!item) return;
    if (!hasRuntime()) {
      window.open(item.full, '_blank', 'noopener');
      return;
    }
    try {
      const res = await send({ type: 'giv:download', url: item.full, name: sanitize(item.name) });
      toast(res?.ok ? 'Downloading…' : `Download failed${res?.error ? `: ${res.error}` : ''}`);
    } catch {
      toast('Extension was updated, reload the page to download');
    }
  }

  async function downloadAll() {
    if (S.items.length < 2) return download();
    if (!hasRuntime()) return toast('Extension was updated, reload the page to download');
    const folder = folderName();
    const pad = String(S.items.length).length;
    const items = S.items.map((item, i) => ({
      url: item.full,
      folder,
      name: `${String(i + 1).padStart(pad, '0')} ${sanitize(item.caption || item.name, 60)}`,
    }));
    toast(`Downloading ${items.length} images…`, 4000);
    try {
      const res = await send({ type: 'giv:download-many', items });
      toast(res?.ok ? `Downloading ${res.count} of ${res.total} to Downloads/${folder}` : 'Download failed', 3500);
    } catch {
      toast('Extension was updated, reload the page to download');
    }
  }

  async function fetchBlob(item) {
    if (hasRuntime()) {
      const res = await send({ type: 'giv:fetch', urls: [...new Set([item.view, item.src, item.full])] });
      if (!res?.ok) throw new Error(res?.error || 'fetch failed');
      return base64ToBlob(res.data, res.type);
    }
    const res = await fetch(item.view);
    return res.blob();
  }

  async function toPng(blob) {
    if (blob.type === 'image/png') return blob;
    let source;
    if (blob.type === 'image/svg+xml') {
      // createImageBitmap can't decode SVG, but an <img> can.
      const url = URL.createObjectURL(blob);
      try {
        source = new Image();
        source.src = url;
        await source.decode();
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      source = await createImageBitmap(blob);
    }
    const w = source.naturalWidth || source.width || S.nat.w;
    const h = source.naturalHeight || source.height || S.nat.h;
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(source, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  async function copyImage() {
    const item = current();
    if (!item) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return toast('Clipboard not available here');
    toast('Copying…', 10000);
    try {
      // Hand the clipboard a promise so the write stays tied to this key press / click.
      const png = fetchBlob(item).then(toPng);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Image copied');
    } catch (err) {
      console.warn('[Image Viewer for GitHub] copy failed', err);
      toast("Couldn't copy this image");
    }
  }

  async function copyLink() {
    const item = current();
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.full);
      toast('Link copied');
    } catch {
      toast("Couldn't copy the link");
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === ui.host) document.exitFullscreen().catch(() => {});
    else ui.host.requestFullscreen?.().catch(() => toast('Fullscreen not available'));
  }

  function rotate(dir) {
    if (!S.loaded) return;
    S.rot += 90 * dir;
    if (S.fitted) setFit();
    else clampPan();
    apply(true);
  }

  const ACTIONS = {
    close,
    prev: () => go(-1),
    next: () => go(1),
    zoomIn: () => zoomTo(S.scale * 1.25, 0, 0, true),
    zoomOut: () => zoomTo(S.scale / 1.25, 0, 0, true),
    toggleZoom: () => toggleZoomAt(),
    fit: () => fit(true),
    rotate: () => rotate(1),
    copy: copyImage,
    copyLink,
    open: () => {
      const item = current();
      if (item) window.open(item.full, '_blank', 'noopener');
    },
    download,
    downloadAll,
    fullscreen: toggleFullscreen,
    help: () => toggleHelp(),
    consentYes: acceptConsent,
    consentNo: declineConsent,
  };

  // Keep Tab inside the viewer: the page behind it is covered, and typing into a
  // GitHub field there would trigger the viewer's shortcuts.
  function moveFocus(dir) {
    const buttons = helpOpen
      ? []
      : [...ui.shadow.querySelectorAll('button, a[href]')].filter((b) => !b.disabled && b.checkVisibility({ visibilityProperty: true }));
    if (!buttons.length) return ui.root.focus();
    const i = buttons.indexOf(ui.shadow.activeElement);
    const next = i < 0 ? (dir > 0 ? 0 : buttons.length - 1) : (i + dir + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  function onKeyDown(e) {
    if (asking) {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') declineConsent();
      else if (e.key === 'Tab') moveFocus(e.shiftKey ? -1 : 1);
      // Enter and Space press the focused button; browser shortcuts still work.
      else if (e.key === 'Enter' || e.key === ' ' || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      return;
    }
    if (!isOpen) return;
    // Keep GitHub's own hotkeys (t, s, /, g i …) from firing behind the viewer.
    e.stopImmediatePropagation();
    if (e.altKey) return;
    // ⌘ on macOS, Ctrl elsewhere. Anything we don't handle (⌘W, ⌘T, ⌘L …) reaches the browser.
    if (IS_MAC ? e.metaKey : e.ctrlKey) {
      let used = true;
      switch (e.key) {
        case 'c': case 'C': used = !getSelection()?.toString(); if (used) copyImage(); break;
        case 's': case 'S': if (e.shiftKey) downloadAll(); else download(); break;
        case '=': case '+': ACTIONS.zoomIn(); break;
        case '-': case '_': ACTIONS.zoomOut(); break;
        case '0': fit(true); break;
        case 'ArrowLeft': case 'ArrowUp': go(-S.index); break;
        case 'ArrowRight': case 'ArrowDown': go(S.items.length - 1 - S.index); break;
        default: used = false;
      }
      if (used) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      moveFocus(e.shiftKey ? -1 : 1);
      return;
    }
    if (helpOpen) {
      // The overlay is modal too: only its own keys work while it's up.
      if (e.key === 'Escape' || e.key === '?') toggleHelp(false);
      e.preventDefault();
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'Escape': close(); break;
      case 'ArrowLeft': case 'PageUp': go(-1); break;
      case 'ArrowRight': case 'PageDown': go(1); break;
      case ' ':
        // Space on a focused button presses it; elsewhere it advances.
        if (e.composedPath()[0]?.tagName === 'BUTTON') handled = false;
        else go(e.shiftKey ? -1 : 1);
        break;
      case 'Home': go(-S.index); break;
      case 'End': go(S.items.length - 1 - S.index); break;
      case '+': case '=': ACTIONS.zoomIn(); break;
      case '-': case '_': ACTIONS.zoomOut(); break;
      case '0': fit(true); break;
      case '1': zoomTo(1, 0, 0, true); break;
      case 'r': rotate(1); break;
      case 'R': rotate(-1); break;
      case 'c': case 'C': copyImage(); break;
      case 'l': case 'L': copyLink(); break;
      case 'd': download(); break;
      case 'D': downloadAll(); break;
      case 'o': case 'O': ACTIONS.open(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case '?': toggleHelp(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Wiring into the page
  // ---------------------------------------------------------------------------

  function onClick(e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    // A click on the image itself, or Enter on the link around it (keyboard users;
    // detail is 0 for clicks that come from the keyboard rather than a pointer).
    const link = e.detail === 0 ? target?.closest('a[href]') : null;
    const img = target?.closest('img') || (link?.querySelectorAll('img').length === 1 ? link.querySelector('img') : null);
    if (!img || !isEligible(img, true)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (consented) openFrom(img);
    else askConsent(img);
  }

  function openFrom(img) {
    const { items, index } = collect(img);
    open(items, index);
  }

  async function askConsent(img) {
    const at = navigations;
    try {
      consented = !!(await chrome.storage.local.get('consented')).consented;
    } catch {}
    // The page may have changed while storage was read.
    if (at !== navigations || !img.isConnected || asking || isOpen) return;
    if (consented) return openFrom(img);
    build();
    clearTimeout(closeTimer);
    lockScroll();
    opener = document.activeElement;
    asking = img;
    ui.host.style.display = 'block';
    ui.root.classList.add('asking');
    ui.consent.hidden = false;
    void ui.root.offsetWidth;
    ui.root.classList.add('open');
    ui.consent.querySelector('.primary').focus();
  }

  function endAsking() {
    asking = null;
    ui.consent.hidden = true;
    ui.root.classList.remove('asking');
  }

  function acceptConsent() {
    const img = asking;
    consented = true;
    try {
      chrome.storage.local.set({ consented: true }).catch(() => {});
    } catch {}
    if (img?.isConnected) {
      endAsking();
      openFrom(img);
    } else {
      declineConsent();
    }
  }

  function declineConsent() {
    endAsking();
    ui.root.classList.remove('open');
    ui.host.style.display = 'none';
    unlockScroll();
    if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    opener = null;
  }

  try {
    chrome.storage.local.get('consented').then((r) => (consented ||= !!r.consented), () => {});
  } catch {}

  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  // Navigating away (back button, Turbo/PJAX links) closes the viewer.
  let navigations = 0;
  const leave = () => {
    navigations++;
    if (asking) declineConsent();
    else if (isOpen) close();
  };
  for (const evt of ['popstate', 'turbo:visit', 'pjax:start']) {
    window.addEventListener(evt, leave);
    document.addEventListener(evt, leave);
  }
})();
