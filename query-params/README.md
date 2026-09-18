# Djaunt Query Params

A Chrome & Firefox extension (Manifest V3) that **removes and adds query string parameters**
on a domain you choose, before the request resolves. Keep as many tweaks as you like and turn
them on one at a time.

Built for testing flags and locales. The app hands you a launch URL, and this strips the
params that get in the way and pins the ones you want — without you hand-editing a URL that
carries live auth tokens.

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
3. **Domain** — the host to intercept, e.g. `app.example.com`. Nothing is pre-filled.
4. **Remove params** — names to strip, one per line.
5. **Add or replace params** — `key=value` per line.
6. Flip that row's switch on. The badge shows how many tweaks are live.
7. Open your URL as normal. Reload any tab that was already open.

`+ Add tweak` appends another row; `x` deletes one. Up to 32 tweaks are kept, and they stay
put until you change them, across browser restarts.

### Rows are independent

Every row carries its own domain, param lists, scope and switch. Enable one, several, or all
of them. A row with an incomplete or invalid entry is skipped rather than blocking the
others — the row shows the reason in red and the footer says how many were skipped.

If two enabled rows claim the same domain, the row nearer the top wins.

### What it does to a URL

```
Domain:  app.example.com
Remove:  token
Add:     debug=1

https://app.example.com/read?token=abc123&id=42
https://app.example.com/read?id=42&debug=1
```

The scheme, host, path and fragment are untouched. Params you did not name keep their
position and their percent-encoding.

## Fields in detail

**Domain.** Scheme and path are ignored, so pasting a full URL works. Omit the port to match
any port; include one (`localhost:8080`) to match only that port. Matching is exact on the
host — neither `app.example.com.evil.test` nor the subdomain `staging.app.example.com`
matches.

**Remove params.** One name per line, or separated by commas or spaces. Every copy of a name
goes, including a valueless one (`?flag`). Removing a name that is not there does nothing.

**Add or replace params.** One `key=value` per line. An `=` inside the value is kept, so
`q=a=b` sets `q` to `a=b`. An empty value (`flag=`) is allowed.

- The key already in the URL — its value is overwritten in place, and any duplicate copies
  of that key are dropped.
- The key absent — the pair is appended to the end.

A name listed in both boxes is a conflict, and the row is skipped with an error.

**Apply to.**

| Setting | Covers | Use when |
|---|---|---|
| `Navigation` (default) | Page and iframe loads | You want the page to load with different params and everything else untouched. This is almost always what you want. |
| `All requests` | Scripts, styles, images, XHR, fetch, websockets | Every call to that domain should carry the change. Note this also rewrites API calls, which can break auth if you strip a token. |

## How it works

One `declarativeNetRequest` dynamic rule per enabled tweak, using a `redirect` action with a
`queryTransform`. The rewrite happens in the network stack before the request goes out, so
no page script runs first and the original query string never reaches the server.

The transform is idempotent — removing a param that is already gone and setting one that is
already set both produce the same URL, and Chrome does not redirect when the result matches
the request. So there is no redirect loop.

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
- **Only the query string changes.** Path segments, fragments and POST bodies are out of
  scope.
- **Param names are compared decoded.** The preview decodes a percent-encoded key
  (`to%6Ben`) before matching it against a removal name; confirm in DevTools if a target app
  encodes its keys.
- **Refuses a no-op**: a row with neither a removal nor an addition is not installed. The
  badge shows `ERR` when no row at all could be installed.

## Verifying it is live

The popup footer reports how many rules are installed — one per enabled tweak. If that count
does not match the enabled rows, the footer turns red and tells you to reload the extension.
To confirm a real navigation was rewritten, open DevTools, go to the Network tab, and check
the request for the document — it shows a `307 Internal Redirect` to the new query string.

## Tests

`test.mjs` covers the rewrite semantics: removal of every copy of a name, in-place
replacement, append-when-absent, encoding and fragment preservation, idempotence, port
handling, and rejection of host-prefix, host-suffix and subdomain lookalikes. It also covers
multi-row behaviour: independent routing, unique rule ids, per-row scope, priority when two
rows share a domain, and skipping broken rows.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
