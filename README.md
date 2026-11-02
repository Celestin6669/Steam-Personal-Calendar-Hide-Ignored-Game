# Steam Personal Calendar — Hide Ignored Game

Hide ignored games across the Steam Personal Calendar and mark games with a developer AI content disclosure.

**Current version: 3.5**

## What it does

On Steam's [Personal Calendar](https://store.steampowered.com/personalcalendar/), clicking **Ignore Game** can leave the game visible until the page refreshes. The same game can also appear in several calendar lists.

This userscript hides every currently registered card for that game as soon as you click **Ignore Game**. It reapplies the hidden state when Steam replaces or adds cards during the same page visit, including when AI badges are disabled.

It also adds a high-contrast **AI** badge when a game's Steam store page contains a developer **AI Generated Content Disclosure**. The default is neon green (`#0ee827`), with bold lettering, a white border, and a dark shadow. Checks happen in the background as cards approach the viewport, with priority given to games currently on screen.

**The badge indicates a Steam disclosure.** The script does not analyze artwork or decide whether a game looks AI-generated. An unmarked game may have no matching disclosure, still be waiting for a check, or have a page the script could not read.

## How it works

### Detecting Ignore Game

The script recognizes English and Russian button labels and also checks the icon-and-label layout next to the wishlist button. This structural fallback supports other interface languages without depending on Steam's generated CSS class names.

It reads the app ID from a Steam store link such as `/app/123456/` and hides registered cards with the same ID. If it cannot identify the game safely, it leaves the card unchanged.

### Checking AI disclosures

Public store-page requests are anonymous and ask for English. If Steam returns a sign-in or age-check page, the script can queue another request using your existing Steam session in the same browser. That request keeps your current Steam language, and disclosure matching includes several localized headings.

The queue allows up to **4 simultaneous requests**, spaces request starts by at least **150 ms**, and respects Steam's rate-limit responses. Transient failures use bounded retries; requests time out after **12 seconds**. Actual completion time depends on Steam and your connection.

### Remembering results

AI results are cached in the browser's `localStorage`:

| Result | Cache lifetime |
| --- | --- |
| Disclosure found | 14 days |
| Verified page with no matching disclosure | 1 day |
| Sign-in page, age gate, error, or unverified response | Not cached as a negative result |

The cache stores app IDs, disclosure flags, and timestamps. Badge color preferences are saved separately in the same browser. The script's own record of games ignored during the visit stays in memory; Steam manages your account's saved ignore list.

## Mature and restricted games

Be signed in to Steam in the same browser. If a game requires age confirmation or a content-preference change, open its store page, complete the required steps yourself, then reload the Calendar.

The session fallback can read only pages available to your Steam session. It does not log in for you, submit age-check forms, or change account preferences. A mature-content rating alone does not produce an AI badge.

## Requirements and installation

Use a current browser with [Tampermonkey](https://www.tampermonkey.net/) installed.

1. Open this repository's `.user.js` file and select **Raw**, or open the direct userscript download for the release.
2. Confirm installation in Tampermonkey. Alternatively, create a new script in its dashboard, replace the template with the userscript code, and save.
3. Visit or refresh the [Steam Personal Calendar](https://store.steampowered.com/personalcalendar/).

You can also install from the [Greasy Fork script page](https://greasyfork.org/en/scripts/596046). Check that the published version is the one you want to install.

## Optional settings

Click the **gear in the top-right corner** of the page to open the compact appearance panel. The live **AI** preview sits in its header, with **Green** and **Red** presets below it. A single row combines the custom color picker and six-digit HEX input. Changes apply to existing badges immediately, without reloading or refetching game pages. Black or white lettering is selected automatically for contrast.

The footer shows **Auto-save** or **Saved**. Your color is stored for this browser and Steam store origin and restored on later visits; it is not synced to your Steam account. Use **Reset** to restore neon green (`#0ee827`). Close the panel with its close button, Escape, or a click outside. The controls follow the page's English/Russian language, retain visible keyboard focus, and provide larger touch targets on touch devices. If browser storage is blocked or a HEX value is invalid, the panel shows an explanatory message.

Edit these constants near the top of the userscript:

| Setting | Default | Effect |
| --- | --- | --- |
| `SHOW_AI_BADGE` | `true` | Set to `false` to disable AI badges and their background requests. Ignore hiding continues to work. |
| `DEBUG` | `false` | Set to `true` to log request attempts, elapsed times, and failure reasons in the browser console. |

## Privacy and updates

The script's explicit background requests go to Steam's store. It uses no third-party AI detection service or analytics, and does not extract or store your authentication cookies. For restricted-page checks, the browser can send your existing Steam cookies to Steam.

Updates use the installed script's configured `@updateURL` and `@downloadURL`. Trust that publication source and check it matches the version you intend to use. Automatic updates can overwrite local edits; use update confirmation if you want to review changes before installation.

## Known limitations

- Steam's button, card, or disclosure markup may change and require an update.
- Localized AI heading matching does not cover every possible translation or page layout.
- Private, unavailable, region-restricted, or still age-gated pages may remain unmarked.
- Cached results can remain unchanged until their expiry.
- Hiding is immediate and does not confirm that Steam saved the ignore action. After a reload, visibility depends on Steam's saved state.
- To un-ignore a game, use Steam's controls on its store page, then reload the Calendar.

## Changelog

### 3.4 — Compact appearance settings

Update from version 3.3.

- Refined the appearance panel to a compact 248 × 172 px desktop layout, with the live badge preview in the header and the color picker and HEX input on one row.
- Replaced the larger gear and text-symbol controls with compact SVG icons, while retaining larger touch targets on touch devices.
- Combined Reset and the Auto-save/Saved status in a short footer, with explanatory messages for invalid colors or unavailable browser storage.
- Preserved green/red presets, custom colors, automatic text contrast, and existing saved preferences. Appearance changes still apply immediately without extra game-page requests.
- Kept accessible field labels, visible keyboard focus, Escape/outside-click closing, and layouts that fit narrow or short windows.

### 3.3 — AI disclosure badges and calendar improvements

Update from version 3.2.

- Added **AI** badges for games with a developer AI content disclosure on Steam.
- Made badges easier to spot with bold 16 px lettering, a solid background, a white border, and a dark shadow. The default background is neon green (`#0ee827`), with automatic black/white text contrast.
- Added a top-right settings gear with green/red presets, a custom color picker, HEX entry, a live preview, and reset. Appearance changes are saved locally and applied immediately without extra game-page requests.
- Added background checks as cards approach the viewport, with priority given to games currently on screen.
- Added browser caching: 14 days for detected disclosures and 1 day for verified negative results, with expiry checked during use.
- Added a paced queue with up to 4 simultaneous requests, at least 150 ms between starts, bounded retries, and a 12-second timeout. Transient failures retry after 2 and 4 seconds; Steam rate-limit responses are respected.
- Added a Steam-session fallback for sign-in and age-gated pages, within the same request limits and without forcing a language parameter on session requests.
- Added localized AI heading matching, including Russian. Verified pages containing incidental hidden age-form fields can still be checked.
- Added app-identity, redirect, cache-record, and page-completeness validation. Inaccessible, failed, or truncated responses are not cached as having no disclosure.
- Bounded card detection to prevent hiding entire calendar sections.
- Reapplied ignore hiding after dynamic card replacement, including with AI badges disabled.
- Cleaned up removed cards and reset badges and hidden state when cards were reused.
- Replaced repeated full-page rescans with batched updates to changed subtrees.
- Added optional `DEBUG` console logging for request timings and failure reasons.

## Reporting problems

Use this repository's **Issues** tab or the script's **Feedback** section on Greasy Fork. Include the script version, browser, userscript manager, an affected Steam game link, and any relevant `DEBUG` messages.

## License

MIT.
