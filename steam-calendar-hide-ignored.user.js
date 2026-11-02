// ==UserScript==
// @name         Steam Personal Calendar — Hide Ignored Game AI mark
// @namespace    steam-calendar-hide-ignored
// @version      3.5
// @description  Hides ignored games across Personal Calendar lists and marks developer-disclosed AI content. Steam manages your account ignore list.
// @author       Celestin6669
// @match        *://store.steampowered.com/personalcalendar*
// @run-at       document-idle
// @license      MIT
// @grant        GM_xmlhttpRequest
// @connect      store.steampowered.com
// @downloadURL https://update.greasyfork.org/scripts/596046/Steam%20Personal%20Calendar%20%E2%80%94%20Hide%20Ignored%20Game.user.js
// @updateURL https://update.greasyfork.org/scripts/596046/Steam%20Personal%20Calendar%20%E2%80%94%20Hide%20Ignored%20Game.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const SHOW_AI_BADGE = true;
  const DEBUG = false; // Enable console timings and failure reasons when diagnosing delays.
  const BADGE_SETTINGS_KEY = 'tmSteamCalendarAiSettingsV1';
  const DEFAULT_BADGE_COLOR = '#0ee827';
  const IGNORE_LABELS = new Set(['Ignore Game', 'Игнорировать игру']);
  const MAX_CLIMB = 6;
  const CARD_SELECTOR = '[data-key="hover div"]';
  const APP_LINK_SELECTOR = 'a[href*="/app/"]';
  // V2 discards negatives previously obtained from unverified responses.
  const CACHE_KEY = 'tmSteamCalendarAiCacheV2';
  const POSITIVE_TTL_MS = 14 * 86400000;
  const NEGATIVE_TTL_MS = 86400000;
  const MAX_CONCURRENT = 4;
  const GAP_MS = 150; // Minimum interval between starts; 429 pauses still take priority.
  const MAX_RETRIES = 2;
  const RETRY_BASE_MS = 2000;
  const REQUEST_TIMEOUT_MS = 12000;
  const LOCALIZED_AI_HEADING =
    /(?:^|[^\p{L}\p{N}_])(?:AI|IA|KI|ИИ)(?=$|[^\p{L}\p{N}_])|artificial|künstlich|искусственн|人工智能|人工知能|인공지능/iu;
  const REQUEST_COOKIE =
    'Steam_Language=english; birthtime=631152001; lastagecheckage=1-0-1990; ' +
    'mature_content=1; wants_mature_content=1';

  function trace(appId, event, details) {
    if (DEBUG) console.debug('[Steam Calendar AI]', appId, event, details);
  }

  // A tile is one marked hover card (or, conservatively, its app anchor).
  // Never infer a card boundary from the number of children in a section.
  function extractAppId(href) {
    try {
      const url = new URL(href, location.href);
      if (url.hostname !== 'store.steampowered.com') return null;
      const match = url.pathname.match(/^\/app\/(\d+)(?:\/|$)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function getAppIdFor(el) {
    const link = el.closest(APP_LINK_SELECTOR) || el.querySelector(APP_LINK_SELECTOR);
    return link ? extractAppId(link.href) : null;
  }

  function findTileRoot(el) {
    return el.closest(CARD_SELECTOR) || el.closest(APP_LINK_SELECTOR) || null;
  }

  function looksLikeIconLabelButton(el) {
    if (el.children.length !== 2) return false;
    const [icon, label] = el.children;
    return icon.localName === 'svg' && label.tagName === 'DIV' && label.children.length === 0;
  }

  function matchesIgnoreButtonShape(el) {
    const previous = el.previousElementSibling;
    return looksLikeIconLabelButton(el) && !!previous && !!previous.querySelector('svg polygon');
  }

  function findIgnoreButton(target) {
    let node = target;
    for (let i = 0; i < MAX_CLIMB && node; i++, node = node.parentElement) {
      if (node.nodeType !== 1) continue;
      if (IGNORE_LABELS.has((node.textContent || '').trim()) || matchesIgnoreButtonShape(node)) return node;
    }
    return null;
  }

  // Cache entries are verified disclosure results, never "unknown" responses.
  function validCacheEntry(entry, now) {
    if (!entry || typeof entry.ai !== 'boolean' || !Number.isFinite(entry.t)) return false;
    const ttl = entry.ai ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    return entry.t >= 0 && entry.t <= now && now - entry.t < ttl;
  }

  function loadCache() {
    const result = Object.create(null);
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
      for (const [id, entry] of Object.entries(raw)) {
        if (/^\d+$/.test(id) && validCacheEntry(entry, Date.now())) result[id] = entry;
      }
    } catch { /* Storage may be unavailable or contain malformed JSON. */ }
    return result;
  }

  const cache = SHOW_AI_BADGE ? loadCache() : Object.create(null);
  let saveTimer = null;

  function getCached(appId) {
    const entry = cache[appId];
    if (validCacheEntry(entry, Date.now())) return entry;
    delete cache[appId];
    return undefined;
  }

  function saveCache() {
    clearTimeout(saveTimer);
    saveTimer = null;
    for (const id of Object.keys(cache)) getCached(id);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch { /* A full cache must not break calendar interaction. */ }
  }

  function saveCacheSoon() {
    if (saveTimer === null) saveTimer = setTimeout(saveCache, 1000);
  }

  function retryAfterMs(headers) {
    const match = (headers || '').match(/^retry-after:\s*([^\r\n]+)/im);
    if (!match) return undefined;
    const text = match[1].trim();
    if (/^\d+$/.test(text)) return Number(text) * 1000;
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
  }

  function httpError(status, headers) {
    const error = new Error('HTTP ' + status);
    error.status = status;
    error.retryAfterMs = retryAfterMs(headers);
    error.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    return error;
  }

  function requestGM(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET', url, anonymous: true, cookie: REQUEST_COOKIE,
        timeout: REQUEST_TIMEOUT_MS,
        onload: function (response) {
          if (response.status !== 200) return reject(httpError(response.status, response.responseHeaders));
          resolve({html: response.responseText, finalUrl: response.finalUrl || url});
        },
        onerror: function () { reject(new Error('network error')); },
        ontimeout: function () { reject(new Error('timeout')); },
        onabort: function () { reject(new Error('aborted')); }
      });
    });
  }

  async function requestFetch(url, useSession = false) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {credentials: useSession ? 'include' : 'omit', signal: controller.signal});
      if (response.status !== 200) throw httpError(response.status, 'Retry-After: ' + (response.headers.get('Retry-After') || ''));
      return {html: await response.text(), finalUrl: response.url || url};
    } finally {
      clearTimeout(timer);
    }
  }

  function fetchStorePage(appId, useSession) {
    const base = 'https://store.steampowered.com/app/' + appId + '/';
    // Restricted games may require the existing Steam login and age consent.
    // No language query here: avoid changing the account's language cookie.
    if (useSession) return requestFetch(base, true);
    const url = base + '?l=english';
    return typeof GM_xmlhttpRequest === 'function' ? requestGM(url) : requestFetch(url);
  }

  function isGateUrl(href) {
    try {
      const url = new URL(href, location.href);
      return url.hostname === 'store.steampowered.com' && /^\/(?:login|agecheck)(?:\/|$)/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function gateError() {
    const error = new Error('Steam sign-in or age check required');
    error.needsSession = true;
    return error;
  }

  function requiresSession(doc, finalUrl, hasContent) {
    return isGateUrl(finalUrl) || (!hasContent && !!doc.querySelector('#app_agegate, #agegate_birthday_selector, [name="ageDay"]'));
  }

  function validateStorePage(doc, appId, finalUrl) {
    const hasContent = doc.querySelector('.apphub_AppName') && doc.querySelector('#game_area_description');
    if (requiresSession(doc, finalUrl, hasContent)) throw gateError();
    if (finalUrl && extractAppId(finalUrl) !== appId) throw new Error('unexpected redirect');
    const identity = doc.querySelector('link[rel="canonical"], meta[property="og:url"]');
    const href = identity && (identity.getAttribute('href') || identity.getAttribute('content'));
    if (extractAppId(href) !== appId) throw new Error('unverified app identity');
    if (!hasContent) throw new Error('incomplete store page');
  }

  function isAiHeading(heading) {
    return LOCALIZED_AI_HEADING.test(heading.normalize('NFKC'));
  }

  function hasAiDisclosure(html, appId, finalUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    validateStorePage(doc, appId, finalUrl);
    for (const block of doc.querySelectorAll('[id="game_area_content_descriptors"]')) {
      const heading = block.querySelector('h2');
      if (heading && isAiHeading(heading.textContent || '')) return true;
    }
    // Only complete English responses support a reliable negative result.
    if (!/^en(?:[-_]|$)/i.test(doc.documentElement.lang)) throw new Error('unknown disclosure language');
    // DOMParser repairs truncated markup, so check the raw response too.
    if (!/<\/body>\s*<\/html>\s*$/i.test(html)) throw new Error('truncated store page');
    if (!doc.querySelector('.game_area_sys_req, #game_area_purchase')) throw new Error('incomplete store page');
    return false;
  }

  // One job per app owns retry state. Exhausted jobs remain terminal this session.
  const queue = [];
  const jobs = new Map();
  let active = 0;
  let pausedUntil = 0;
  let nextStartAt = 0;
  let wakeTimer = null;

  function enqueue(appId) {
    if (!SHOW_AI_BADGE || !/^\d+$/.test(appId) || ignoredApps.has(appId)) return;
    if (getCached(appId) || jobs.has(appId)) return;
    const job = {appId, attempts: 0, readyAt: Date.now(), session: false};
    jobs.set(appId, job);
    queue.push(job);
    pump();
  }

  function schedulePump(at) {
    const delay = Math.min(2147483647, Math.max(0, at - Date.now()));
    wakeTimer = setTimeout(pump, delay);
  }

  function isAppVisible(appId) {
    const tiles = tilesByApp.get(appId);
    if (!tiles) return false;
    for (const tile of tiles) {
      if (!tile.isConnected) continue;
      const rect = tile.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) return true;
    }
    return false;
  }

  function nextReadyJobIndex(now) {
    let firstReady = -1;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].readyAt > now) continue;
      if (firstReady === -1) firstReady = i;
      if (isAppVisible(queue[i].appId)) return i;
    }
    return firstReady;
  }

  function pump() {
    clearTimeout(wakeTimer);
    wakeTimer = null;
    if (active >= MAX_CONCURRENT || !queue.length) return;
    const earliestReady = Math.min(...queue.map(function (job) { return job.readyAt; }));
    const allowedAt = Math.max(pausedUntil, nextStartAt, earliestReady);
    if (allowedAt > Date.now()) return schedulePump(allowedAt);
    const index = nextReadyJobIndex(Date.now());
    const job = queue.splice(index, 1)[0];
    if (ignoredApps.has(job.appId)) {
      jobs.delete(job.appId);
      return pump();
    }
    active++;
    job.attempts++;
    nextStartAt = Date.now() + GAP_MS;
    checkApp(job).finally(function () { active--; pump(); });
    if (active < MAX_CONCURRENT && queue.length) schedulePump(nextStartAt);
  }

  function queueSessionFallback(job) {
    if (job.session || job.attempts > MAX_RETRIES) return;
    job.session = true;
    job.readyAt = Date.now();
    queue.push(job);
  }

  function retryJob(job, error) {
    if (error.needsSession) return queueSessionFallback(job);
    let delay = RETRY_BASE_MS * Math.pow(2, job.attempts - 1);
    if (error.status === 429) delay = error.retryAfterMs ?? 60000 * Math.pow(2, job.attempts - 1);
    if (error.status === 429) pausedUntil = Math.max(pausedUntil, Date.now() + delay);
    if (error.retryable === false || job.attempts > MAX_RETRIES) return;
    job.readyAt = Date.now() + delay;
    queue.push(job);
  }

  async function checkApp(job) {
    const startedAt = Date.now();
    trace(job.appId, 'start', {attempt: job.attempts, session: job.session});
    try {
      const response = await fetchStorePage(job.appId, job.session);
      const ai = hasAiDisclosure(response.html, job.appId, response.finalUrl);
      cache[job.appId] = {ai, t: Date.now()};
      jobs.delete(job.appId);
      saveCacheSoon();
      markApp(job.appId);
      trace(job.appId, 'checked', {ai, elapsedMs: Date.now() - startedAt});
    } catch (error) {
      trace(job.appId, 'failed', {reason: error.message, status: error.status, elapsedMs: Date.now() - startedAt});
      retryJob(job, error);
    }
  }

  // Both features share this registry, including when AI badges are disabled.
  const ignoredApps = new Set();
  const tilesByApp = new Map();
  const tileRecords = new WeakMap();
  const visibilityObserver = SHOW_AI_BADGE ? new IntersectionObserver(function (entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting || !entry.target.isConnected) continue;
      visibilityObserver.unobserve(entry.target);
      const record = tileRecords.get(entry.target);
      if (record) enqueue(record.appId);
    }
  }, {rootMargin: '150px'}) : null;

  function clearBadge(tile, record) {
    delete tile.dataset.tmAi;
    if (record.positioned && tile.style.position === 'relative') tile.style.position = record.position;
    record.positioned = false;
  }

  function markTile(tile, record) {
    if (tile.dataset.tmAi === '1') return;
    if (getComputedStyle(tile).position === 'static') {
      record.position = tile.style.position;
      record.positioned = true;
      tile.style.position = 'relative';
    }
    tile.dataset.tmAi = '1';
  }

  function applyTileState(tile, record) {
    if (ignoredApps.has(record.appId)) {
      if (!record.hidden) record.display = tile.style.display;
      record.hidden = true;
      tile.style.display = 'none';
      if (visibilityObserver) visibilityObserver.unobserve(tile);
      return;
    }
    if (!SHOW_AI_BADGE) return;
    const cached = getCached(record.appId);
    if (cached && cached.ai) markTile(tile, record);
    else clearBadge(tile, record);
    if (!cached) visibilityObserver.observe(tile);
  }

  function markApp(appId) {
    const tiles = tilesByApp.get(appId);
    if (tiles) for (const tile of tiles) {
      if (tile.isConnected) applyTileState(tile, tileRecords.get(tile));
    }
  }

  function unregisterTile(tile) {
    const record = tileRecords.get(tile);
    if (!record) return;
    if (visibilityObserver) visibilityObserver.unobserve(tile);
    const tiles = tilesByApp.get(record.appId);
    tiles.delete(tile);
    if (!tiles.size) tilesByApp.delete(record.appId);
    clearBadge(tile, record);
    if (record.hidden && tile.style.display === 'none') tile.style.display = record.display;
    delete tile.dataset.tmAppid;
    tileRecords.delete(tile);
  }

  function registerTile(tile, appId) {
    const previous = tileRecords.get(tile);
    if (previous && previous.appId !== appId) unregisterTile(tile);
    if (!tileRecords.has(tile)) {
      tileRecords.set(tile, {appId, hidden: false, positioned: false});
      tile.dataset.tmAppid = appId;
      if (!tilesByApp.has(appId)) tilesByApp.set(appId, new Set());
      tilesByApp.get(appId).add(tile);
    }
    applyTileState(tile, tileRecords.get(tile));
  }

  function registerLink(link) {
    const tile = findTileRoot(link);
    const appId = extractAppId(link.href);
    if (tile && appId) registerTile(tile, appId);
  }

  function scanTiles(root = document) {
    if (root.nodeType === 1 && root.matches(APP_LINK_SELECTOR)) registerLink(root);
    for (const link of root.querySelectorAll(APP_LINK_SELECTOR)) registerLink(link);
  }

  function removeDetachedTiles(root) {
    if (root.nodeType !== 1 || root.isConnected) return;
    unregisterTile(root);
    for (const tile of root.querySelectorAll('[data-tm-appid]')) unregisterTile(tile);
  }

  const changedRoots = new Set();
  const removedRoots = new Set();
  let mutationTimer = null;

  function refreshRoot(root) {
    if (!root.isConnected) return;
    const tile = root.closest(CARD_SELECTOR) || root.closest('[data-tm-appid]');
    if (tile) {
      const appId = getAppIdFor(tile);
      if (appId) registerTile(tile, appId);
      else unregisterTile(tile);
    }
    scanTiles(root);
  }

  function processChanges() {
    mutationTimer = null;
    for (const root of removedRoots) removeDetachedTiles(root);
    for (const root of changedRoots) refreshRoot(root);
    removedRoots.clear();
    changedRoots.clear();
  }

  function collectChanges(records) {
    for (const record of records) {
      if (record.type === 'attributes') changedRoots.add(record.target);
      else {
        for (const node of record.removedNodes) removedRoots.add(node);
        for (const node of record.addedNodes) if (node.nodeType === 1) changedRoots.add(node);
        const tile = record.target.closest(CARD_SELECTOR) || record.target.closest('[data-tm-appid]');
        if (tile) changedRoots.add(tile);
      }
    }
    if (mutationTimer === null) mutationTimer = setTimeout(processChanges, 16);
  }

  document.addEventListener('click', function (event) {
    const button = findIgnoreButton(event.target);
    if (!button) return;
    const tile = findTileRoot(button);
    if (!tile) return;
    const appId = getAppIdFor(button) || getAppIdFor(tile);
    if (!appId) return;
    ignoredApps.add(appId);
    registerTile(tile, appId);
    markApp(appId);
  }, true);

  function normalizeBadgeColor(value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.trim())) return null;
    return value.trim().toLowerCase();
  }

  function parseBadgePreference(raw) {
    try {
      const value = JSON.parse(raw);
      return value ? normalizeBadgeColor(value.color) : null;
    } catch { return null; }
  }

  function loadBadgeColor() {
    try { return parseBadgePreference(localStorage.getItem(BADGE_SETTINGS_KEY)) || DEFAULT_BADGE_COLOR; }
    catch { return DEFAULT_BADGE_COLOR; }
  }

  function badgeTextColor(color) {
    const channels = [1, 3, 5].map(function (offset) {
      const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
  }

  function applyBadgeColor(color) {
    document.documentElement.style.setProperty('--tm-ai-badge-bg', color);
    document.documentElement.style.setProperty('--tm-ai-badge-fg', badgeTextColor(color));
  }

  function settingsText() {
    if (document.documentElement.lang.toLowerCase().startsWith('ru')) return {
      title: 'Настройки значка AI', panelTitle: 'Значок AI', close: 'Закрыть', color: 'Цвет фона значка',
      green: 'Зелёный', red: 'Красный', custom: 'Свой цвет', preview: 'Предпросмотр',
      reset: 'Сбросить на зелёный', resetShort: 'Сбросить', local: 'Автосохранение',
      storageHint: 'Настройки сохраняются только в этом браузере.',
      saved: 'Сохранено', invalid: 'Введите цвет в формате #0ee827.',
      failed: 'Не удалось сохранить. Цвет действует до перезагрузки.'
    };
    return {
      title: 'AI badge settings', panelTitle: 'AI badge', close: 'Close', color: 'Badge background',
      green: 'Green', red: 'Red', custom: 'Custom color', preview: 'Preview',
      reset: 'Reset to green', resetShort: 'Reset', local: 'Auto-save',
      storageHint: 'Settings are saved only in this browser.',
      saved: 'Saved', invalid: 'Enter a color such as #0ee827.',
      failed: 'Could not save. This color applies until the page reloads.'
    };
  }

  function settingsMarkup(text) {
    // Only authored translation strings enter this template; saved values are
    // validated separately and assigned through DOM properties, never HTML.
    return `
      <style>
        :host { all: initial; position: fixed; top: var(--tm-ai-top,92px);
          right: max(12px,env(safe-area-inset-right)); z-index: 1000;
          font: 13px/1.4 Arial,sans-serif; color: #eef5fc; color-scheme: dark; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        button,input { font: inherit; }
        button { cursor: pointer; color: inherit; }
        svg { display: block; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        ::selection { color: #0d1924; background: #a4d5ff; }
        input { caret-color: #a4d5ff; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        button:focus-visible,input:focus-visible { outline: 2px solid #88caff; outline-offset: 3px; }
        #tm-ai-settings-toggle { display: grid; place-items: center; width: 32px;
          height: 32px; padding: 0; border: 1px solid #7890a7; border-radius: 6px;
          background: #172b3e; color: #eef5fc; position: relative; }
        #tm-ai-settings-toggle::after { content: ''; position: absolute; top: 3px;
          right: 3px; width: 5px; height: 5px; border: 1px solid #fff8;
          border-radius: 50%; background: var(--tm-ai-badge-bg); }
        #tm-ai-settings-toggle:hover { background: #2b4862; }
        #tm-ai-settings-panel { position: fixed; right: max(12px,env(safe-area-inset-right));
          top: var(--tm-ai-panel-top,132px); width: 248px;
          max-width: calc(100vw - 24px); max-height: calc(100dvh - var(--tm-ai-panel-top,142px) - 12px);
          overflow: auto; padding: 12px; border: 1px solid #617b93;
          border-radius: 12px; background: #172636; }
        .heading { display: flex; align-items: center; gap: 8px; }
        h2 { flex: 1; margin: 0; font-size: 14px; line-height: 1.3; color: #fff; }
        #tm-ai-settings-close { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0;
          border-radius: 4px; background: transparent; color: #d4e2ef; }
        #tm-ai-settings-close:hover { background: #334e65; }
        .presets { display: flex; gap: 8px; margin-top: 12px; }
        .presets button { display: inline-flex; align-items: center; gap: 8px;
          flex: 1; justify-content: center; min-height: 32px; padding: 5px 8px; border: 1px solid #59738b;
          border-radius: 6px; background: #22394e; }
        .presets button:hover { background: #2b4862; }
        .presets button[aria-pressed="true"] { border-color: #fff; background: #36536c; }
        .swatch { width: 10px; height: 10px; border: 1px solid #fff9; border-radius: 2px; }
        .green { background: #0ee827; } .red { background: #c62828; }
        .custom { display: grid; grid-template-columns: 36px minmax(0,1fr); gap: 8px; margin-top: 10px; }
        .custom label { min-width: 0; }
        .custom input { height: 32px; border: 1px solid #617c94; border-radius: 6px; background: #0e1c29; color: #fff; }
        #tm-ai-custom-color { display: block; width: 100%; padding: 3px; cursor: pointer; }
        #tm-ai-custom-color::-webkit-color-swatch-wrapper { padding: 0; }
        #tm-ai-custom-color::-webkit-color-swatch { border: 0; border-radius: 3px; }
        #tm-ai-custom-color::-moz-color-swatch { border: 0; border-radius: 3px; }
        #tm-ai-color-hex { width: 100%; padding: 5px 9px; font-family: Consolas,monospace; }
        #tm-ai-color-hex[aria-invalid="true"] { border-color: #ff9c9c; }
        #tm-ai-color-preview { display: inline-flex; align-items: center; justify-content: center;
          min-width: 34px; height: 26px; padding: 0 6px; border: 1px solid #fff;
          border-radius: 5px; background: var(--tm-ai-badge-bg); color: var(--tm-ai-badge-fg);
          font: 800 16px/1 Arial,sans-serif; letter-spacing: .5px; box-shadow: 0 1px 5px #000b; }
        .footer { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 10px; }
        #tm-ai-color-reset { min-height: 24px; padding: 2px 0; border: 0; background: none;
          color: #a4d5ff; text-decoration: underline; text-underline-offset: 3px; font-size: 12px; }
        #tm-ai-color-reset:hover { color: #fff; }
        #tm-ai-settings-status { flex: 1; margin: 0; text-align: right; font-size: 12px; line-height: 1.5; color: #c1d2e1; }
        #tm-ai-settings-status[data-error="true"] { flex-basis: 100%; text-align: left; color: #ffc1c1; }
        @media (pointer: coarse) {
          #tm-ai-settings-toggle { width: 44px; height: 44px; }
          #tm-ai-settings-close,.presets button,#tm-ai-color-reset { min-height: 44px; }
          #tm-ai-settings-close { min-width: 44px; }
          .custom input { height: 44px; }
        }
      </style>
      <button id="tm-ai-settings-toggle" type="button" aria-label="${text.title}"
        title="${text.title}" aria-controls="tm-ai-settings-panel" aria-expanded="false">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.69 4.55L10.41 2.13L13.59 2.13L14.31 4.55L15.64 5.10L17.85 3.89L20.11 6.15L18.90 8.36L19.45 9.69L21.87 10.41L21.87 13.59L19.45 14.31L18.90 15.64L20.11 17.85L17.85 20.11L15.64 18.90L14.31 19.45L13.59 21.87L10.41 21.87L9.69 19.45L8.36 18.90L6.15 20.11L3.89 17.85L5.10 15.64L4.55 14.31L2.13 13.59L2.13 10.41L4.55 9.69L5.10 8.36L3.89 6.15L6.15 3.89L8.36 5.10Z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <section id="tm-ai-settings-panel" role="dialog" aria-labelledby="tm-ai-settings-title" hidden>
        <div class="heading"><h2 id="tm-ai-settings-title">${text.panelTitle}</h2>
          <span id="tm-ai-color-preview" title="${text.preview}">AI</span>
          <button id="tm-ai-settings-close" type="button" aria-label="${text.close}" title="${text.close}">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
        <div class="presets" role="group" aria-label="${text.color}">
          <button type="button" data-color="#0ee827" aria-pressed="false"><span class="swatch green" aria-hidden="true"></span>${text.green}</button>
          <button type="button" data-color="#c62828" aria-pressed="false"><span class="swatch red" aria-hidden="true"></span>${text.red}</button>
        </div>
        <div class="custom">
          <label><span class="sr-only">${text.custom}</span><input id="tm-ai-custom-color" type="color" title="${text.custom}"></label>
          <label><span class="sr-only">HEX</span><input id="tm-ai-color-hex" type="text" maxlength="7" title="HEX"
            spellcheck="false" autocomplete="off" aria-invalid="false" aria-describedby="tm-ai-settings-status"></label>
        </div>
        <div class="footer"><button id="tm-ai-color-reset" type="button" title="${text.reset}" aria-label="${text.reset}">${text.resetShort}</button>
          <p id="tm-ai-settings-status" role="status" aria-live="polite" title="${text.storageHint}">${text.local}</p></div>
      </section>`;
  }

  function syncBadgeControls(ui) {
    const hex = ui.root.getElementById('tm-ai-color-hex');
    if (hex.value !== ui.color) hex.value = ui.color;
    hex.setAttribute('aria-invalid', 'false');
    hex.setCustomValidity('');
    ui.root.getElementById('tm-ai-custom-color').value = ui.color;
    for (const button of ui.root.querySelectorAll('[data-color]')) {
      button.setAttribute('aria-pressed', String(button.dataset.color === ui.color));
    }
  }

  function saveBadgePreference(ui) {
    const status = ui.root.getElementById('tm-ai-settings-status');
    try {
      localStorage.setItem(BADGE_SETTINGS_KEY, JSON.stringify({color: ui.color}));
      status.textContent = ui.text.saved;
      status.dataset.error = 'false';
    } catch {
      status.textContent = ui.text.failed;
      status.dataset.error = 'true';
    }
  }

  function chooseBadgeColor(ui, value, persist = true) {
    const color = normalizeBadgeColor(value);
    if (!color) {
      const hex = ui.root.getElementById('tm-ai-color-hex');
      hex.setAttribute('aria-invalid', 'true');
      hex.setCustomValidity(ui.text.invalid);
      const status = ui.root.getElementById('tm-ai-settings-status');
      status.textContent = ui.text.invalid;
      status.dataset.error = 'true';
      return;
    }
    ui.color = color;
    applyBadgeColor(color);
    syncBadgeControls(ui);
    if (persist) saveBadgePreference(ui);
    else {
      const status = ui.root.getElementById('tm-ai-settings-status');
      status.textContent = ui.text.local;
      status.dataset.error = 'false';
    }
  }

  function setSettingsOpen(ui, open, restoreFocus = false) {
    ui.root.getElementById('tm-ai-settings-panel').hidden = !open;
    const button = ui.root.getElementById('tm-ai-settings-toggle');
    button.setAttribute('aria-expanded', String(open));
    if (open) ui.root.getElementById('tm-ai-color-hex').focus();
    else if (restoreFocus) button.focus();
  }

  function positionBadgeSettings(ui) {
    const header = document.getElementById('global_header') || document.querySelector('header,[role="banner"]');
    const bottom = header ? header.getBoundingClientRect().bottom : 80;
    const top = Math.max(12, Math.min(Math.max(0, bottom) + 12, innerHeight - 56));
    ui.host.style.setProperty('--tm-ai-top', top + 'px');
    const buttonHeight = ui.root.getElementById('tm-ai-settings-toggle').getBoundingClientRect().height || 32;
    const offset = buttonHeight + 8;
    const desiredRoom = buttonHeight > 32 ? 260 : 200;
    const panelTop = innerHeight - top - offset - 12 < desiredRoom ? 12 : top + offset;
    ui.host.style.setProperty('--tm-ai-panel-top', panelTop + 'px');
  }

  function bindSettingsPosition(ui) {
    let timer = null;
    function schedulePosition() {
      if (timer !== null) return;
      timer = setTimeout(function () { timer = null; positionBadgeSettings(ui); }, 50);
    }
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, {passive: true});
  }

  function receiveBadgePreference(ui, event) {
    if (event.key !== BADGE_SETTINGS_KEY) return;
    const color = event.newValue === null ? DEFAULT_BADGE_COLOR : parseBadgePreference(event.newValue);
    if (color) chooseBadgeColor(ui, color, false);
  }

  function bindBadgeInputs(ui) {
    for (const button of ui.root.querySelectorAll('[data-color]')) {
      button.addEventListener('click', function () { chooseBadgeColor(ui, button.dataset.color); });
    }
    for (const id of ['tm-ai-custom-color', 'tm-ai-color-hex']) {
      const input = ui.root.getElementById(id);
      const choose = function () { chooseBadgeColor(ui, input.value); };
      input.addEventListener('input', choose);
      input.addEventListener('change', choose);
    }
    ui.root.getElementById('tm-ai-color-reset').addEventListener('click', function () { chooseBadgeColor(ui, DEFAULT_BADGE_COLOR); });
  }

  function bindBadgePanel(ui) {
    const panel = ui.root.getElementById('tm-ai-settings-panel');
    ui.root.getElementById('tm-ai-settings-toggle').addEventListener('click', function () { setSettingsOpen(ui, panel.hidden); });
    ui.root.getElementById('tm-ai-settings-close').addEventListener('click', function () { setSettingsOpen(ui, false, true); });
    document.addEventListener('keydown', function (event) {
      if (!panel.hidden && event.key === 'Escape') {
        event.preventDefault();
        setSettingsOpen(ui, false, true);
      }
    });
    document.addEventListener('pointerdown', function (event) {
      if (!panel.hidden && !event.composedPath().includes(ui.host)) setSettingsOpen(ui, false);
    });
    window.addEventListener('storage', function (event) { receiveBadgePreference(ui, event); });
  }

  function initBadgeSettings() {
    if (document.getElementById('tm-steam-ai-controls')) return;
    const host = document.createElement('div');
    host.id = 'tm-steam-ai-controls';
    const root = host.attachShadow({mode: 'open'});
    const ui = {host, root, text: settingsText(), color: loadBadgeColor()};
    root.innerHTML = settingsMarkup(ui.text);
    applyBadgeColor(ui.color);
    syncBadgeControls(ui);
    document.body.appendChild(host);
    positionBadgeSettings(ui);
    bindBadgeInputs(ui);
    bindBadgePanel(ui);
    bindSettingsPosition(ui);
  }

  if (SHOW_AI_BADGE) {
    initBadgeSettings();
    const style = document.createElement('style');
    style.textContent = `
      [data-tm-ai="1"]::after {
        content: "AI"; position: absolute; top: 5px; right: 5px; z-index: 5;
        display: inline-flex; align-items: center; justify-content: center;
        box-sizing: border-box; min-width: 34px; height: 26px; padding: 0 6px;
        border: 1px solid #fff; border-radius: 5px; background: var(--tm-ai-badge-bg,#0ee827);
        color: var(--tm-ai-badge-fg,#000); font: 800 16px/1 Arial,sans-serif; letter-spacing: .5px;
        box-shadow: 0 1px 5px rgba(0,0,0,.85);
        text-shadow: 0 1px 1px rgba(0,0,0,.35); pointer-events: none;
      }`;
    document.head.appendChild(style);
    window.addEventListener('pagehide', function () { if (saveTimer !== null) saveCache(); });
  }

  scanTiles();
  new MutationObserver(collectChanges).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href']
  });
})();
