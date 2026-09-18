# djaunt-browser-tools

Browser-based tools I use day to day — mostly Manifest V3 extensions, occasionally a plain
web page. No build step, no dependencies — load each folder unpacked.

**[tory37.github.io/djaunt-browser-tools](https://tory37.github.io/djaunt-browser-tools/)** —
an index page showing off each extension. It's `index.html` at the repo root; enable it under
**Settings → Pages → Deploy from a branch → `main` / `/ (root)`** to serve it.

| Extension | Browser | What it does |
|---|---|---|
| [`host-swap/`](host-swap) | Chrome & Firefox | Rewrites hosts to other hosts before the request resolves, keeping the path, query string and fragment byte-identical. Built for pointing a fixed launch URL at a branch deploy without hand-editing a URL that carries live auth tokens. Holds as many swaps as you like, enabled one at a time. |
| [`query-params/`](query-params) | Chrome & Firefox | Removes and adds query string parameters on a chosen domain before the request resolves, leaving the scheme, host, path and fragment untouched. Built for flipping flags and locales on a launch URL you cannot hand-edit. Holds as many tweaks as you like, each toggled on its own. |
| [`tab-volume/`](tab-volume) | Chrome & Firefox | Sets the volume of each tab from 0 to 100 percent, optionally saved for every tab on the same domain. |
| [`dark-mode/`](dark-mode) | Chrome & Firefox | Forces a dark color scheme on any site, skipping ones that already look dark. Toggle it globally or override it per domain for the browsing session. |
| [`color-picker/`](color-picker) | Chrome & Firefox | Picks any on-screen color, converts it between hex/RGB/HSL/OKLCH, checks WCAG contrast, and builds CSS gradients — with no host permissions at all. |
| [`net-mock/`](net-mock) | Chrome & Firefox 128+ | Intercepts the page's `fetch` and `XMLHttpRequest` calls and answers the ones you choose with a response you wrote — a mock body, a forced 500, a delay, or a hard failure. Also exposes a `window.djauntMock` API so an agent can install a rule in one line without opening the popup. |
| [`todo-sync/`](todo-sync) | ⏸ Paused | A todo list synced to a per-account backend. Not on the index page for now — its current GitHub-account backend doesn't suit a general audience; see its README's Status note before picking this back up. |

Every extension runs on both browsers from the same folder — a tiny `globalThis.browser ??
globalThis.chrome` shim is the only cross-browser code, and each `manifest.json` declares
both a `service_worker` and a Firefox-compatible `scripts` background entry.

## Install one

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the extension's folder — not this repo root.
4. Pin it so the toolbar button is visible.

Chrome reads the folder from disk, so a `git pull` plus **Reload** on the extension card is
the whole update process.

**Firefox:**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select the extension folder's `manifest.json`.

This load is temporary and drops on restart — see the extension's own README for a
persistent-install option.

Each folder has its own README with the details.

## Tests

`host-swap`, `query-params`, `color-picker`, `net-mock` and `todo-sync` each have a
dependency-free test file covering their core logic:

```
node host-swap/test.mjs
node query-params/test.mjs
node color-picker/test.mjs
node net-mock/test.mjs
node todo-sync/test.mjs
```

All five exit non-zero on failure. `tab-volume` and `dark-mode` have no automated tests.
