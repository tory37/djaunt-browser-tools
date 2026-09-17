# djaunt-browser-tools

Browser extensions (Manifest V3) I use day to day for testing web apps. No build step, no
dependencies — load each folder unpacked.

**[tory37.github.io/djaunt-browser-tools](https://tory37.github.io/djaunt-browser-tools/)** —
an index page showing off each extension. It's `index.html` at the repo root; enable it under
**Settings → Pages → Deploy from a branch → `main` / `/ (root)`** to serve it.

| Extension | Browser | What it does |
|---|---|---|
| [`host-swap/`](host-swap) | Chrome | Rewrites hosts to other hosts before the request resolves, keeping the path, query string and fragment byte-identical. Built for pointing a fixed launch URL at a branch deploy without hand-editing a URL that carries live auth tokens. Holds as many swaps as you like, enabled one at a time. |
| [`tab-volume/`](tab-volume) | Chrome | Sets the volume of each tab from 0 to 100 percent, optionally saved for every tab on the same domain. |
| [`dark-mode/`](dark-mode) | Firefox | Forces a dark color scheme on any site, skipping ones that already look dark. Toggle it globally or override it per domain for the browsing session. |

## Install one

**Chrome** (`host-swap`, `tab-volume`):

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the extension's folder — not this repo root.
4. Pin it so the toolbar button is visible.

Chrome reads the folder from disk, so a `git pull` plus **Reload** on the extension card is
the whole update process.

**Firefox** (`dark-mode`):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select the extension folder's `manifest.json`.

This load is temporary and drops on restart — see the extension's own README for a
persistent-install option.

Each folder has its own README with the details.

## Tests

`host-swap` has a dependency-free test file covering its rewrite semantics:

```
node host-swap/test.mjs
```

It exits non-zero on failure. `tab-volume` and `dark-mode` have no automated tests.
