# Djaunt Header Editor

A Chrome & Firefox extension (Manifest V3) that **sets and removes HTTP request headers**
on a domain you choose, before the request resolves. Keep as many tweaks as you like and
turn them on one at a time.

Built for testing auth and feature-flag headers, and for CORS debugging. The app expects a
header a server sets for it, or checks one that gets in the way — this adds or strips it
without a proxy, without touching the app, and without an account.

Every tweak stays on for its domain until you switch it off or delete it. Nothing expires,
and nothing is tied to a tab or a session.

## Install

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin the extension so the toolbar button is visible.

**Firefox** (115+ for `declarativeNetRequest`, 121+ for this manifest's dual background key):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select this folder's `manifest.json`.

This load is temporary and drops on restart; for a persistent install, package the folder
with [`web-ext`](https://github.com/mozilla/web-ext) and sign it, or run it in a channel that
allows unsigned extensions.

There is nothing to build and no dependencies to install.

## Use

1. Click the toolbar button. Each saved tweak is one collapsed row.
2. Click a row to expand it.
3. **Domain** — the host to intercept, e.g. `api.example.com`. Nothing is pre-filled.
4. **Remove request headers** — names to strip, one per line.
5. **Set request headers** — `Name: value` per line.
6. Flip that row's switch on. The badge shows how many tweaks are live.
7. Open your URL as normal. Reload any tab that was already open.

`+ Add tweak` appends another row; `x` deletes one. Up to 32 tweaks are kept, and they stay
put until you change them, across browser restarts.

### Rows are independent

Every row carries its own domain, header lists, scope and switch. Enable one, several, or
all of them. A row with an incomplete or invalid entry is skipped rather than blocking the
others — the row shows the reason in red and the footer says how many were skipped.

If two enabled rows claim the same domain, the row nearer the top wins.

### What it does to a request

```
Domain:  api.example.com
Remove:  Referer
Set:     Authorization: Bearer test-token

Referer: https://app.example.com          Authorization: Bearer test-token
Origin: https://app.example.com     -->    Origin: https://app.example.com
```

Only the listed headers change. Every other header, the method, the body and the URL are
untouched.

## Fields in detail

**Domain.** Scheme and path are ignored, so pasting a full URL works. Omit the port to match
any port; include one (`localhost:8080`) to match only that port. Matching is exact on the
host — neither `api.example.com.evil.test` nor the subdomain `staging.api.example.com`
matches.

**Remove request headers.** One name per line, or separated by commas. Matching is
case-insensitive, the way header names actually work. Removing a header that is not there
does nothing.

**Set request headers.** One `Name: value` per line. A colon inside the value is kept, so
`Authorization: Bearer a:b` sets the value to `Bearer a:b`. An empty value (`X-Flag:`) is
allowed.

- The header already on the request — its value is overwritten in place.
- The header absent — it is added.

A name listed in both boxes is a conflict, and the row is skipped with an error.

**Apply to.**

| Setting | Covers | Use when |
|---|---|---|
| `Navigation` | Page and iframe loads | The header only needs to be there for the document request itself. |
| `All requests` (default) | Scripts, styles, images, XHR, fetch, websockets | Every call to that domain should carry the change. This is the usual case for an auth or feature-flag header, since those almost always ride on `fetch`/XHR calls, not the page navigation. |

## How it works

One `declarativeNetRequest` dynamic rule per enabled tweak, using a `modifyHeaders` action
with a `requestHeaders` list of `set` and `remove` operations. The rewrite happens in the
network stack before the request goes out, so no page script runs first and the original
header value never reaches the server.

Rules are stored as dynamic rules, so they survive a browser restart. Both the service
worker and the popup reconcile them against saved settings — the worker on install, on
startup and on any settings change, the popup whenever it opens or you edit a row. The popup
applying them itself means a service worker running stale code cannot strand you with no
rules installed.

Each reconcile clears the extension's whole rule id range before adding, rather than only
the ids it saw a moment earlier. Two overlapping reconciles would otherwise each miss the
rules the other just added, and Chrome rejects the whole update on a duplicate id — which
installs nothing at all.

## Scope and limits

- **Host permission is `<all_urls>`** because the domains are user-configurable and not known
  at package time. The extension has no content script, reads no page content, and sends
  nothing anywhere.
- **Toggles are global**, not per-tab. `declarativeNetRequest` has no per-tab dynamic rule.
- **A tab already open when you flip it on is not affected** until you reload it.
- **Request headers only.** This does not touch response headers (so it cannot strip
  `X-Frame-Options` or a CSP to allow embedding) or the request body.
- **A handful of headers can't be touched at all**, regardless of what you enter — the
  browser reserves some request headers (like `Host` and `Content-Length`) that
  `declarativeNetRequest` is not allowed to set or remove. If a set or remove has no visible
  effect, check DevTools' Network tab for the actual header sent.
- **Refuses a no-op**: a row with neither a removal nor a set is not installed. The badge
  shows `ERR` when no row at all could be installed.

## Verifying it is live

The popup footer reports how many rules are installed — one per enabled tweak. If that count
does not match the enabled rows, the footer turns red and tells you to reload the extension.
To confirm a real request was rewritten, open DevTools, go to the Network tab, select the
request, and check its **Request Headers** under **Headers**.

## Tests

`test.mjs` covers the header-transform semantics: setting a new header, removing one,
case-insensitive overwrite and removal, and rejecting a no-op. It also covers multi-row
behaviour: independent routing, unique rule ids, per-row scope, priority when two rows share
a domain, and skipping broken rows.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
