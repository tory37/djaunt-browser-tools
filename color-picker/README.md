# Color Picker

A Chrome & Firefox extension (Manifest V3) that picks any on-screen color, converts it
between formats, checks WCAG contrast, and builds CSS gradients.

It exists as a ColorZilla alternative that fixes the complaints that tool draws the most:
ColorZilla asks for access to every page you visit; this asks for none. ColorZilla's picker
can sample the wrong pixel on a HiDPI display; this one samples real captured pixel data, not
a CSS-pixel guess. ColorZilla nags about a paid tier; this has no tiers, accounts or network
calls at all.

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

Click the toolbar icon to open the popup, then pick a tab:

- **Pick.** Click **Pick color from page**. In a browser that supports the native
  [EyeDropper API](https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper) (Chrome,
  Edge, and recent Firefox), it opens the system-level eyedropper, which can sample any pixel
  on screen, not just inside the current tab. Elsewhere, it opens a full-page picker with a
  zoomed loupe; click a pixel there to pick it. Either way, the color's hex, RGB, HSL and
  OKLCH values appear with one-click copy buttons, and it's saved to History.
- **History.** Every color you've picked, newest first. Click a swatch to bring it back to
  the Pick tab; hover for a delete button, or clear the whole list.
- **Gradient.** Build a linear or radial CSS gradient from 2 to 5 color stops, each with a
  position slider. The preview updates live; copy the finished `background:` declaration.
- **Contrast.** Enter a foreground and background color (typed hex or the native color
  picker) to see the WCAG contrast ratio and whether it passes AA/AAA at normal and large
  text sizes, with a live text preview.

## How it works

- **The eyedropper never touches the page.** `new EyeDropper().open()` is a browser-level API
  called straight from the popup; the extension never injects a content script or reads page
  content to use it, which is why the manifest asks for no host permissions.
- **The fallback picker samples real pixels.** On a browser without `EyeDropper`, clicking
  Pick calls `tabs.captureVisibleTab` (covered by the `activeTab` permission, granted by the
  same click) to grab a screenshot at the display's actual pixel resolution, stashes it in
  `storage.session`, and opens `picker.html` in a full-screen window. That page reads color
  values straight out of the captured image's pixel data — not off the live DOM — so a
  HiDPI display, a `<canvas>`, or a WebGL scene all sample correctly.
- **Format conversion and contrast math live in `color.js`**, a DOM-free module covering hex
  parsing, RGB/HSL/OKLCH conversion, and WCAG relative luminance and contrast ratio. It's
  imported by both `popup.js` and `picker.js`, and covered by `test.mjs`.
- **History is the only thing that persists** (`storage.local`, capped at 60 colors,
  deduplicated on add). The toolbar badge always shows the most recently picked color as a
  quick reminder of what's in the popup.

## Permissions

`storage` and `activeTab` — nothing else. No `host_permissions`, no `<all_urls>`, no content
scripts. The extension only ever sees the one tab's screenshot at the moment you click Pick,
and only when the native eyedropper isn't available to skip that step entirely.

## Limits

- The native `EyeDropper` path only works where the browser implements it; the fallback
  picker only covers the active tab's visible viewport, not the full page or other windows.
- `tabs.captureVisibleTab` can't capture browser-internal pages (`chrome://`, the Web Store,
  the built-in PDF viewer) or DRM video, matching what a screenshot can see there anyway.
- OKLCH values are computed directly from sRGB with no gamut mapping — they're accurate for
  colors already representable in sRGB, which covers every color this extension can pick.

## Tests

`test.mjs` covers `color.js`: hex/rgb/hsl parsing and formatting, HSL round-tripping, OKLCH
conversion sanity checks, WCAG contrast ratio and rating thresholds, and gradient CSS output.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
