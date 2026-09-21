// ==UserScript==
// @name         Steam Personal Calendar — Hide Ignored Game
// @namespace    steam-calendar-hide-ignored
// @version      3.1
// @description  Hides a game from Personal Calendar as soon as you click "Ignore Game", in any interface language. Stores nothing — Steam itself keeps track of your ignore list.
// @author       you
// @match        *://store.steampowered.com/personalcalendar*
// @run-at       document-idle
// @license      MIT
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
      if (tile) {
        tile.style.display = 'none';
      }
    },
    true // capture phase — react even if the popover closes right after the click
  );
})();
