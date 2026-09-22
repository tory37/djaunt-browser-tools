# Djaunt Storage Inspector

A Chrome & Firefox extension (Manifest V3) that views, edits and deletes `localStorage` and
`sessionStorage` entries for the active tab's page — access is granted only to the tab you
click on, nothing broader.

It's built for the moment you need to check or tweak what a web app has stashed in browser
storage without opening DevTools: flip a feature flag stored as a string, clear a stale auth
token, or just see what's actually in there.

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

Click the toolbar icon on the page you want to inspect. The popup reads that tab's storage
immediately — no separate "connect" step.

- **Local Storage / Session Storage** tabs switch which store you're looking at. Each shows
  every key, its value, a size badge, and a `JSON` badge when the value parses as one.
- **JSON values are pretty-printed** in the value box (2-space indent) instead of showing the
  raw stored string — most app storage is JSON under the hood, so this is usually the readable
  form. Non-JSON strings show as-is.
- **Filter** narrows the list by key or value substring as you type.
- **Edit** a value by typing directly in its box; **Save** and **Revert** appear once it
  differs from what's displayed. Saving re-formats valid JSON back to the standard
  pretty-printed form. **Delete** removes that key immediately.
- **Add** a new key/value pair from the fields above the list.
- **Export JSON** downloads the current store (after any filter) as a `{key: value}` JSON
  file. **Clear all** removes every entry in the current store.
- **Refresh** re-reads storage from the page, in case something else changed it since the
  popup opened.

Pages the browser doesn't allow extension scripts on — `chrome://` pages, the Web Store, the
Firefox/Chrome add-on galleries — show a message instead of an empty list.

## How it works

- **No content script, no host permissions.** The manifest asks for `activeTab` and
  `scripting` only. Opening the popup counts as invoking the extension, which grants
  `activeTab` for that one tab; the popup then calls `chrome.scripting.executeScript` to run a
  small, self-contained function inside that tab's page to read or write storage. No
  `<all_urls>`, no permanent content script, no access to any tab until you click the icon.
- **Reads and writes go straight through the real `Storage` API** (`localStorage`/
  `sessionStorage`'s own `key()`/`getItem()`/`setItem()`/`removeItem()`/`clear()`) executed in
  the page's own context — the same values the page itself would see, not a copy or a
  snapshot taken some other way.
- **`storage.js`** holds the DOM-free logic — JSON detection, byte-size formatting, filtering,
  sorting, and building the export file — and is covered by `test.mjs`. `popup.js` wires that
  logic to the executed-in-page functions and the DOM.

## Limits

- **Session Storage is per-tab.** The popup shows the storage of the specific tab it was
  opened from — that's a real property of `sessionStorage`, not a limitation of this
  extension.
- **Iframes aren't inspected separately.** `executeScript` targets the tab's top frame, so
  storage set by a cross-origin iframe on the page isn't shown.
- **No IndexedDB or Cookies yet.** Only the two synchronous key-value stores are covered in
  this version.
- Browser-internal pages (`chrome://`, `about:`, extension galleries) can't run extension
  scripts at all — that's a platform restriction, not something this extension can work around.

## Permissions

`activeTab` and `scripting` — nothing else. No `host_permissions`, no `<all_urls>`, no
persistent content script, no background script. The extension only ever touches the one tab
you have open when you click the icon.

## Tests

`test.mjs` covers `storage.js`: restricted-URL detection, JSON-likeness detection, JSON
pretty-printing, byte-size formatting, sorting, filtering, and building the export file.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
