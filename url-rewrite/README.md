# Djaunt URL Rewrite

A Chrome & Firefox extension (Manifest V3) that **reroutes a host to another host and
removes or sets query string parameters** before the request resolves. One row does both,
in a fixed order: host first, then params. Keep as many rewrites as you like and turn them
on one at a time.

Replaces running [`host-swap/`](../host-swap) and [`query-params/`](../query-params) side
by side. Those two each register their own redirect, and Chrome applies only one
extension's redirect per request, picked by install order. So one of the two edits silently
never happened. Here both edits live in one extension, so the order is fixed.

Built for testing branch deploys. The app hands you a launch URL with live auth tokens. This
points it at your branch build and flips the flags you want, without you hand-editing the
URL.

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

1. Click the toolbar button. Each saved rewrite is one collapsed row.
2. Click a row to expand it.
3. **From host** — the host to intercept, e.g. `app.example.com`. Nothing is pre-filled.
4. **To host** — optional. Your branch deploy, e.g. `new-host.example.com/my-branch`.
5. **Remove params** — one box per name to strip. `+ Param` adds another box.
6. **Add or replace params** — one row per pair, Name and Value in separate columns.
7. Flip that row's switch on. The badge shows how many rewrites are live.
8. Open your URL as normal. Reload any tab that was already open.

`Add rewrite` appends another row; `x` deletes one. Up to 32 rewrites are kept, and they stay
put until you change them, across browser restarts.

A row needs at least one change: a target host, a param to remove, or a param to set. Leave
**To host** empty to edit params only. Leave both param lists empty to swap the host only.

### Rows are independent

Every row carries its own hosts, param lists, scope and switch. Enable one, several, or all
of them. A row with an incomplete or invalid entry is skipped rather than blocking the
others — the row shows the reason in red.

If two enabled rows claim the same from-host, the row nearer the top wins.

### What it does to a URL

```
From host:  app.example.com
To host:    new-host.example.com
Remove:     token
Add:        debug=1

https://app.example.com/read?token=abc123&id=42#top
https://new-host.example.com/read?id=42&debug=1#top
```

The path and fragment are untouched. Params you did not name keep their position and their
percent-encoding. The preview in each row shows the result for a sample URL.

## Fields in detail

**From host.** Scheme and path are ignored, so pasting a full URL works. Omit the port to
match any port; include one (`localhost:8080`) to match only that port. Matching is exact on
the host — neither `app.example.com.evil.test` nor `staging.app.example.com` matches.

**To host.** Defaults to `https://` if you leave the scheme off. An explicit `http://` and a
port are kept. With a portless from-host, the source port is dropped unless the target names
one. A path here is a prefix, prepended to the request path:

```
To host:  new-host.example.com/my-branch
Result:   https://new-host.example.com/my-branch/read?id=42&debug=1
```

A target on the same host as the from-host is refused. The redirect would match its own
output and loop.

**Remove params.** One name per box. Every copy of a name goes, including a valueless one
(`?flag`). Removing a name that is not there does nothing.

**Add or replace params.** One name/value pair per row. An empty value is allowed. If the key
is already in the URL, its value is overwritten in place and any duplicate copies go. If the
key is absent, the pair is appended. A name listed in both lists is a conflict, and the row
is skipped with an error.

**Apply to.**

| Setting | Covers | Use when |
|---|---|---|
| `Navigation` (default) | Page and iframe loads | You want the page from your branch with different params, and everything else untouched. This is almost always what you want. |
| `All requests` | Scripts, styles, images, XHR, fetch, websockets | Every call to that host should be rerouted and edited. This also hits API calls, which can break auth. |

## How it works

`declarativeNetRequest` dynamic rules, up to three per enabled row. The redirect happens in
the network stack before DNS resolution, so the original host is never contacted and no page
script runs first.

**One hop** — no target, or a target with no path:

- Params only: one rule with a `queryTransform` on the from-host.
- Bare-host target: one `transform` rule that swaps scheme, host and port and edits the query
  in the same redirect.

**Two hops** — a target with a path prefix. `transform` cannot add a path, so:

1. Two `regexSubstitution` rules swap the host and prepend the path. Two rather than one
   because RE2 has no lookahead: one rule takes a bare origin, the other a
   path/query/fragment tail.
2. A third `queryTransform` rule matches the target host plus prefix and edits the query on
   the redirected request.

The final URL is the same either way. The two-hop case shows two `307 Internal Redirect`
entries in DevTools.

**Direct-visit caveat.** In the two-hop case the params rule matches the target, not the
from-host. So it also edits a URL you open on the target directly, under that prefix. The row
says so under the preview when this applies. A target with no path does not have this
problem; its single rule matches only the from-host.

The query transform is idempotent, and Chrome does not redirect when the result matches the
request. So there is no redirect loop.

Rules survive a browser restart. Both the service worker and the popup reconcile them against
saved settings — the worker on install, on startup and on any settings change, the popup
whenever it opens or you edit a row. Each reconcile clears the extension's whole rule id
range before adding, so two overlapping reconciles cannot collide on a duplicate id.

## Scope and limits

- **Host permission is `<all_urls>`** because the hosts are user-configurable and not known
  at package time. The extension has no content script, reads no page content, and sends
  nothing anywhere.
- **Toggles are global**, not per-tab. `declarativeNetRequest` has no per-tab dynamic rule.
- **A tab already open when you flip it on is not affected** until you reload it.
- **HSTS and certificates apply to the target**, so an https target needs a valid cert.
- **Do not run this next to `host-swap` or `query-params`** on the same host. You are back
  to one redirect winning by install order.
- **Param names are compared decoded.** `to%6Ben` matches a removal name of `token`.
- **Refuses a no-op**: a row with no target and no params is not installed. The badge shows
  `ERR` when no row at all could be installed.

## Verifying it is live

The popup footer reports how many redirect rules are installed. To confirm a real navigation
was rewritten, open DevTools, go to the Network tab, and check the request for the document —
it shows a `307 Internal Redirect` to the new URL (two for a path-prefix target).

## Tests

`test.mjs` simulates Chrome's rule matching and follows the redirect chain to its end. It
covers parsing and validation, swap only, params only, bare-host one-hop, path-prefix
two-hop, the direct-visit caveat, port handling, host lookalikes, loop refusal, and priority
between rows.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
