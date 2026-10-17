// ==UserScript==
// @name         Steam Personal Calendar — Hide Ignored Game
// @namespace    steam-calendar-hide-ignored
// @version      3.2
// @description  Hides a game from every list of Personal Calendar as soon as you click "Ignore Game", in any interface language. Stores nothing — Steam itself keeps track of your ignore list.
// @author       you
// @match        *://store.steampowered.com/personalcalendar*
// @run-at       document-idle
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/596046/Steam%20Personal%20Calendar%20%E2%80%94%20Hide%20Ignored%20Game.user.js
// @updateURL https://update.greasyfork.org/scripts/596046/Steam%20Personal%20Calendar%20%E2%80%94%20Hide%20Ignored%20Game.meta.js
// ==/UserScript==

(function () {
  'use strict';

  // Known label text variants (fast path, not required for the script to work).
  const IGNORE_LABELS = new Set(['Ignore Game', 'Игнорировать игру']);

  const MAX_CLIMB = 6; // how many levels up from the click target we check

  // ---------- Finding the game tile's root element ----------

  // Walk up from an element while its parent has exactly one child.
  // This finds the "outer card" of the game in the calendar grid, regardless
  // of how many intermediate wrapper divs Steam's frontend uses.
  function climbSingleChildWrappers(el) {
    let node = el;
    while (
      node.parentElement &&
      node.parentElement.children.length === 1 &&
      node.parentElement !== document.body
    ) {
      node = node.parentElement;
    }
    return node;
  }

  function findTileRoot(el) {
    const marker = el.closest('[data-key="hover div"]');
    const startPoint = marker || el;
    return climbSingleChildWrappers(startPoint);
  }

  // ---------- Finding the same game in every list ----------

  // Extract appid from a URL like .../app/1234567/Game_Name?...
  function extractAppId(href) {
    if (!href) return null;
    const m = href.match(/\/app\/(\d+)(?:\/|$|\?)/);
    return m ? m[1] : null;
  }

  // Appid of the game a given element belongs to. The "Ignore Game" button
  // lives inside an <a> pointing to the game's page; as a fallback we look
  // for any game link inside the tile.
  function getAppIdFor(el) {
    const ancestorLink = el.closest('a[href*="/app/"]');
    if (ancestorLink) return extractAppId(ancestorLink.href);
    const innerLink = el.querySelector('a[href*="/app/"]');
    return innerLink ? extractAppId(innerLink.href) : null;
  }

  // The same game appears in several lists (e.g. "Released in the last
  // 7 days" and "Upcoming"), so hide every tile linking to this appid.
  function hideAllTilesForApp(appId) {
    document.querySelectorAll('a[href*="/app/"]').forEach(function (link) {
      if (extractAppId(link.href) === appId) {
        findTileRoot(link).style.display = 'none';
      }
    });
  }

  // ---------- Method 1: match by button text (fast, but language-dependent) ----------

  function matchesKnownLabel(el) {
    const text = (el.textContent || '').trim();
    return IGNORE_LABELS.has(text);
  }

  // ---------- Method 2: match by structure and icon (works in any language) ----------
  //
  // On a game tile, the "Ignore Game" button always consists of an icon
  // (an svg with a <path>, a "crossed-out circle") plus a label, and it always
  // appears right AFTER the "Add to wishlist" button (which has a star icon —
  // an svg with a <polygon>). This structure is identical across every Steam
  // interface language; only the label text changes.

  function looksLikeIconLabelButton(el) {
    if (!el || el.nodeType !== 1 || el.children.length !== 2) return false;
    const [first, second] = el.children;
    return (
      first.tagName === 'svg' || first.tagName === 'SVG'
    ) && second.tagName === 'DIV' && second.children.length === 0;
  }

  function hasWishlistStarIcon(el) {
    if (!el) return false;
    const svg = el.querySelector && el.querySelector('svg');
    return !!(svg && svg.querySelector('polygon'));
  }

  function matchesIgnoreButtonShape(el) {
    return looksLikeIconLabelButton(el) && hasWishlistStarIcon(el.previousElementSibling);
  }

  // ---------- Combined check ----------

  function findIgnoreButton(target) {
    let node = target;
    for (let i = 0; i < MAX_CLIMB && node; i++) {
      if (node.nodeType === 1 && (matchesKnownLabel(node) || matchesIgnoreButtonShape(node))) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // ---------- Click handling ----------

  document.addEventListener(
    'click',
    function (e) {
      const btn = findIgnoreButton(e.target);
      if (!btn) return;

      const tile = findTileRoot(btn);
      const appId = getAppIdFor(btn) || (tile && getAppIdFor(tile));

      if (appId) {
        hideAllTilesForApp(appId); // every list at once
      }
      if (tile) {
        tile.style.display = 'none'; // fallback if no appid was found
      }
    },
    true // capture phase — react even if the popover closes right after the click
  );
})();
