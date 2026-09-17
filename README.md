# djaunt-browser-tools

Chrome extensions (Manifest V3) I use day to day for testing web apps. No build step, no
dependencies — load each folder unpacked.

| Extension | What it does |
|---|---|
| [`host-swap/`](host-swap) | Rewrites hosts to other hosts before the request resolves, keeping the path, query string and fragment byte-identical. Built for pointing a fixed launch URL at a branch deploy without hand-editing a URL that carries live auth tokens. Holds as many swaps as you like, enabled one at a time. |
| [`query-params/`](query-params) | Removes and adds query string parameters on a chosen domain before the request resolves, leaving the scheme, host, path and fragment untouched. Built for flipping flags and locales on a launch URL you cannot hand-edit. Holds as many tweaks as you like, each toggled on its own. |
| [`tab-volume/`](tab-volume) | Sets the volume of each tab from 0 to 100 percent, optionally saved for every tab on the same domain. |

## Install one

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the extension's folder — not this repo root.
4. Pin it so the toolbar button is visible.

Chrome reads the folder from disk, so a `git pull` plus **Reload** on the extension card is
the whole update process.

Each folder has its own README with the details.

## Tests

`host-swap` and `query-params` each have a dependency-free test file covering their rewrite
semantics:

```
node host-swap/test.mjs
node query-params/test.mjs
```

Both exit non-zero on failure. `tab-volume` has no automated tests.
