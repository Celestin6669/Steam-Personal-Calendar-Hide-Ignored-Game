# Steam-Personal-Calendar-Hide-Ignored-Game
Steam Personal Calendar — Hide Ignored Game
What it does:
On the Steam Personal Calendar page, hovering over a game lets you click "Ignore Game." Normally the game still stays visible in the list until you refresh (and sometimes even after). This script makes the game disappear from the calendar immediately when you click "Ignore Game" — no page reload needed, and it works regardless of what language your Steam interface is set to.

How it recognizes the button:
It doesn't rely on Steam's internal CSS class names (those are auto-generated and change with every site update). Instead it detects the button two ways:

By its label text, for a couple of known languages (English, Russian).
By its structure and icon — the "Ignore Game" button is always an icon + label pair positioned right after the "Add to wishlist" button (star icon). This pattern is identical across every Steam language, so the script works even in languages it doesn't explicitly know.
What it does NOT do:

It doesn't store, sync, or remember anything — it only hides the tile on the page you're currently viewing.
It doesn't talk to any server other than what Steam's own site already does.
Steam still keeps track of your ignored games as usual — if you ever want to un-ignore something, do it manually from the store page, same as before.
Requirements:

A userscript manager extension, e.g. Tampermonkey (works in Chrome, Firefox, Edge, Opera, etc.)
Installation:

Install Tampermonkey if you don't already have it.
Open the Tampermonkey dashboard → "Create a new script." (or just import it as file).
Delete the template content and paste in the script's code
Save (Ctrl+S) or install the file.
Visit or refresh store.steampowered.com/personalcalendar/ — it works automatically from then on.
Known limitations

An ignored game may reappear if the page reloads before Steam's own ignore state has fully taken effect.
If Steam changes the icon or button layout in a future redesign, the structural detection may need a small update.
Just post an issue on github, i will update it.


MIT License
