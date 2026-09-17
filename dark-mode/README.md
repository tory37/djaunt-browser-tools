# Dark Mode

Chrome & Firefox extension (Manifest V3) that forces a dark color scheme on any site,
skipping pages that already look dark. Turn it on globally, or override it per domain for
the rest of the browsing session.

## Install

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension so the toolbar button is visible.

**Firefox** (121+, for this manifest's dual background key):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select this folder's `manifest.json`.

This load is temporary — Firefox drops it on restart, so reload it the same way after a
`git pull`. For a load that survives restarts, package the folder with
[`web-ext`](https://github.com/mozilla/web-ext) and sign it, or run it in a channel that
allows unsigned extensions (Nightly/ESR with `xpinstall.signatures.required` off in
`about:config`).

## Use

- Click the toolbar icon to open the popup for the active tab.
- Turn on **Enable everywhere** to apply dark mode to every site, except ones the
  detector finds are already dark.
- Use the **Auto / Always on / Always off** control to override that decision for the
  current domain — "Always on" forces dark mode even on a site the detector calls dark;
  "Always off" exempts the domain from the global switch.
- The popup shows what the detector found ("This page already looks dark" / "looks
  light") and whether dark mode is actually applied to the tab right now.
- The toolbar badge reads "ON" whenever dark mode is applied to the active tab.

## Scope rules

- A domain override always wins over the global switch.
- **Enable everywhere** persists in `browser.storage.local`, so it survives restarts.
- Domain overrides live in `browser.storage.session` — they apply to every tab on that
  domain immediately, but are forgotten when the browser closes.

## How it works

- `content.js` runs at `document_start` in every frame. It injects a stylesheet that
  inverts the page (`filter: invert(1) hue-rotate(180deg)`) and inverts images, video,
  canvas and iframes a second time so they render normally instead of as photo negatives.
- Detection happens once the page has a `<body>`: it reads the computed background color
  of the page and calls it "already dark" below a relative-luminance threshold. When the
  global switch is on and there's no override, the page is inverted immediately (to avoid
  a flash of light content) and then reverted if detection says it's already dark.
- Settings are read straight out of `browser.storage`, so a change from the popup reaches
  every open tab through `storage.onChanged` — no messaging required to apply a change.
- `background.js` only handles what a content script can't: seeding tabs that were
  already open when the extension loads (manifest content scripts don't retroactively
  inject), widening `storage.session` so content scripts can read the domain map, and
  setting the toolbar badge from the status each content script reports.

## Limits

- The invert filter recolors everything uniformly; CSS background images on ordinary
  elements get inverted too since there's no per-image extraction like a proper
  color-aware dark mode (e.g. Dark Reader) would do.
- Restricted pages (`about:`, the add-ons manager, PDF viewer) block content scripts, so
  dark mode can't apply there.
- Detection runs once per page load against the initial background color; a page that
  swaps its own light/dark theme after load (e.g. a manual toggle on the site itself)
  isn't re-detected.
