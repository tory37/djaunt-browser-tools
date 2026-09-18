# Djaunt Net Mock

A Chrome & Firefox extension (Manifest V3) that **intercepts the page's own network calls
and answers the ones you choose with a response you wrote**. Mock an API that does not exist
yet, force a 500, add a two-second delay, or cut a request off entirely — without touching
the app or standing up a server.

It also exposes a page-level API (`window.djauntMock`), so an agent or a test can install a
rule in one line and never open the popup. See **[API.md](API.md)**.

Rules persist across page loads and browser restarts, and each one has its own switch.

## Install

**Chrome** (111+ for the `MAIN`-world content script):

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin the extension so the toolbar button is visible.

**Firefox 128+** — higher than the other extensions in this repo, because a content script
declared with `"world": "MAIN"` needs it:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select this folder's `manifest.json`.

This load is temporary and drops on restart; for a persistent install, package the folder
with [`web-ext`](https://github.com/mozilla/web-ext) and sign it, or run it in a channel that
allows unsigned extensions.

There is nothing to build and no dependencies to install.

## Use

1. Click the toolbar button, then **Add**. Each rule is one collapsed row.
2. **URL pattern** — `*/api/students/*`. `*` matches any run of characters, including `/`.
   The pattern is anchored at both ends and compared against the full absolute URL, so a
   relative `fetch('/api/x')` is resolved first. Start with `re:` for a regular expression.
3. **Method** — one method, or `*` for any.
4. **What to do** — `Mock` answers with the response below, `Fail` rejects the way a dropped
   connection does, `Pass` lets the request through.
5. **Status**, **Delay ms**, **Times** — `Times` is how many matches before the rule stops
   firing, counted per page load; `0` means unlimited.
6. **Response headers** and **Response body** — a JSON body gets a JSON content type on its
   own.
7. Flip the row's switch on. The badge shows how many rules are live.
8. Reload the tab to catch requests it has already made.

Up to 64 rules are kept.

### Rows are independent

Every row carries its own pattern, response and switch. A row with an invalid entry is
skipped rather than blocking the others — the row shows the reason in red and the footer says
how many were skipped.

**First match wins**, so list order is priority. Put a `Pass` rule above a broad mock rule to
carve an exception out of it.

### Match log

The collapsed **Match log** panel shows what the interceptor decided for each request —
`mocked`, `failed`, `passed` or `skipped`. It is the fastest way to find out why a rule is
not firing. It holds the last 500 entries and empties when the browser closes.

### Import and export

**Export** writes every rule to `net-mock-rules.json`. **Import** replaces the current set
from a file. An import is all-or-nothing: if any rule is invalid the whole import is refused,
naming the rule and the problem. Same format the API's `import()`/`export()` use.

## How it works, and what it cannot do

Chrome's MV3 removed blocking `webRequest`, and `declarativeNetRequest` — what `host-swap`
and `query-params` use — can block or redirect but cannot supply a response body. Firefox's
`filterResponseData` can, but only in Firefox. So Net Mock takes the one route that works
identically in both browsers: a content script in the page's **own** JavaScript world,
running at `document_start`, that replaces `window.fetch` and `XMLHttpRequest`.

That is what makes it portable, and it is also the limit:

- **Subresource loads are not intercepted** — `<img>`, `<script>`, stylesheets, fonts. Only
  `fetch` and `XMLHttpRequest` are patched.
- **A site's own service worker is not intercepted.** It runs in a separate context this
  extension does not enter, so an app that fetches through one will bypass every rule.
- **Synchronous `XMLHttpRequest` is not intercepted.** It cannot wait for the rule snapshot.
  These are logged as `skipped` and go to the network.
- **WebSockets are not intercepted.** Planned, not in this version.
- **The page can un-patch it.** The interceptor shares the page's world by necessity. This is
  a development tool, not a security boundary.

A request fired before the rule snapshot arrives is still caught: the interceptor patches
`fetch` synchronously and each call waits on the snapshot before deciding, so nothing escapes
through the startup gap.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Keeps the rules, and the session-scoped match log. |
| `<all_urls>` | The interceptor has to load on whatever page you are mocking. |

No `declarativeNetRequest`, no `tabs`, no `webRequest`. Nothing leaves the browser.

## Tests

```
node test.mjs
```

Dependency-free. Covers the rule model, the URL matcher, the wire format, and the
interceptor itself — the real `interceptor.js` is loaded against a stub page and driven with
live `fetch` and `XMLHttpRequest` calls. Exits non-zero on failure.

`rules.js` holds the schema, validation and matching; `wire.js` holds the matching the page's
world runs (it declares no imports or exports on purpose, so it loads both as a classic
content script and as an ES module); `interceptor.js` is the MAIN-world half; `bridge.js`
relays between it and `background.js`.
