## Steam Personal Calendar — Hide Ignored Game

### What it does
On the Steam [Personal Calendar](https://store.steampowered.com/personalcalendar/) page, hovering over a game lets you click "Ignore Game." Normally the game stays visible in the list until you refresh (and sometimes even after). Worse, the same game usually appears in several lists at once (for example "Released in the last 7 days" and "Upcoming"), so you would have to ignore it in each of them.

This script makes the game disappear from **every list of the calendar at once** the moment you click "Ignore Game". No page reload is needed, and it works regardless of the language your Steam interface is set to.

### How it works
**Finding the button.** The script doesn't rely on Steam's internal CSS class names (they are auto-generated and change with every site update). Instead it detects the button in two ways:

1. By its label text, for a couple of known languages (English, Russian).
2. By its structure and icon: the "Ignore Game" button is always an icon + label pair positioned right after the "Add to wishlist" button (star icon). This pattern is identical in every Steam language, so the script works even in languages it doesn't explicitly know.

**Hiding the game everywhere.** The script reads the game's appid from its store link (`/app/<appid>/...`) and hides every tile that points to the same game, in all lists on the page. If the appid can't be determined, it falls back to hiding only the tile you clicked.

### What it does NOT do
- It doesn't store, sync, or remember anything. It only hides tiles on the page you're currently viewing.
- It doesn't talk to any server other than what Steam's own site already does.
- Steam still keeps track of your ignored games as usual. If you ever want to un-ignore something, do it manually from the store page, same as before.

### Requirements
A userscript manager extension, e.g. [Tampermonkey](https://www.tampermonkey.net/) (works in Chrome, Firefox, Edge, Opera, etc.)

### Installation
1. Install Tampermonkey if you don't already have it.
2. Click "Install this script" on this page. Alternatively, open the Tampermonkey dashboard → "Create a new script", delete the template content, paste in the script's code and save (Ctrl+S).
3. Visit or refresh `store.steampowered.com/personalcalendar` (with or without a trailing slash or query parameters). It works automatically from then on.

### Known limitations
- An ignored game may reappear if the page reloads before Steam's own ignore state has fully taken effect.
- If Steam changes the icon or button layout in a future redesign, the structural detection may need a small update.

If something stops working, please post an issue on GitHub and I will update the script.
