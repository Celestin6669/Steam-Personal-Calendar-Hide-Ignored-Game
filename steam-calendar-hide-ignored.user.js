// ==UserScript==
// @name         Steam Personal Calendar — Hide Ignored Game
// @namespace    steam-calendar-hide-ignored
// @version      3.3
// @description  Hides ignored games across Personal Calendar lists and marks developer-disclosed AI content.
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

  if (SHOW_AI_BADGE) {
    const style = document.createElement('style');
    style.textContent = `
      [data-tm-ai="1"]::after {
        content: "AI"; position: absolute; top: 4px; right: 4px; z-index: 5;
        padding: 1px 5px; border-radius: 3px; background: rgba(0,0,0,.7);
        color: #ff3b3b; font: 700 12px/1.3 Arial,sans-serif;
        letter-spacing: .5px; pointer-events: none;
      }`;
    document.head.appendChild(style);
    window.addEventListener('pagehide', function () { if (saveTimer !== null) saveCache(); });
  }

  scanTiles();
  new MutationObserver(collectChanges).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href']
  });
})();
