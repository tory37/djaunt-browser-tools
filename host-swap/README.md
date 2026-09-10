# Host Swap

A Chrome extension that rewrites hosts to other hosts **before the request resolves**, keeping
the path, query string and fragment byte-identical. Keep as many swaps as you like and turn
them on one at a time.

Built for testing branch deploys. An app sends you to a fixed host, and this points that
navigation at your per-branch build instead — without you hand-editing a URL that carries
live auth tokens.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin the extension so the toolbar button is visible.

There is nothing to build and no dependencies to install.

## Use

1. Click the toolbar button. Each saved swap is one collapsed row.
2. Click a row to expand it.
3. **From host** — the host to intercept, e.g. `old-host.example.com`. Nothing is
   pre-filled; the extension ships with no hosts of its own.
4. **To host** — your branch deploy, e.g. `new-host.example.com`.
5. Flip that row's switch on. The badge shows how many swaps are live.
6. Open your launch URL as normal. Reload any tab that was already open.

`+ Add swap` appends another row; `x` deletes one. Up to 32 swaps are kept, and they stay
put until you change them, across browser restarts.

### Rows are independent

Every row carries its own from-host, to-host, scope and switch. Enable one, several, or all
of them. A row with an incomplete or invalid host is skipped rather than blocking the
others — the row shows the reason in red and the footer says how many were skipped.

If two enabled rows claim the same from-host, the row nearer the top wins.

### What gets preserved

Everything after the host:

```
https://old-host.example.com/?token=abc123&id=42
https://new-host.example.com/?token=abc123&id=42
```

Query order, percent-encoding and fragments are untouched — the URL is not re-serialised,
so a token cannot be mangled in transit.

## Fields in detail

**From host.** Scheme and path are ignored, so pasting a full URL works. Omit the port to
match any port; include one (`localhost:8080`) to match only that port. Matching is exact on
the host — `old-host.example.com.evil.test` does **not** match.

**To host.** Defaults to `https://` if you leave the scheme off. A path here is treated as a
prefix and prepended, which covers deploys served from a subdirectory:

```
To host:  new-host.example.com/my-branch
Result:   https://new-host.example.com/my-branch/?token=abc123
```

**Apply to.**

| Setting | Covers | Use when |
|---|---|---|
| `Navigation` (default) | Page and iframe loads | You want the app shell from your branch and everything else untouched. This is almost always what you want. |
| `All requests` | Scripts, styles, images, XHR, fetch, websockets | The whole origin should come from the branch build. Note this also redirects API calls made to that host, which can break auth. |

## How it works

A pair of `declarativeNetRequest` dynamic rules per enabled swap. The redirect happens in the network stack
before DNS resolution, so no request ever reaches the original host and no page script runs
first. Two rules rather than one because Chrome's regex engine (RE2) has no lookahead, and a
single pattern with an optional capture group cannot both anchor the host boundary and keep
the tail — one rule handles a bare origin, the other a path/query/fragment tail.

Rules are stored as dynamic rules, so they survive a browser restart. Both the service
worker and the popup reconcile them against saved settings — the worker on install, on
startup and on any settings change, the popup whenever it opens or you edit a row. The
popup applying them itself means a service worker running stale code cannot strand you
with no rules installed.

Each reconcile clears the extension's whole rule id range before adding, rather than only
the ids it saw a moment earlier. Two overlapping reconciles would otherwise each miss the
rules the other just added, and Chrome rejects the whole update on a duplicate id — which
installs nothing at all.

## Scope and limits

- **Host permission is `<all_urls>`** because the hosts are user-configurable and not known
  at package time. The extension has no content script, reads no page content, and sends
  nothing anywhere.
- **Toggles are global**, not per-tab. `declarativeNetRequest` has no per-tab dynamic rule.
- **A tab already open when you flip it on is not affected** until you reload it.
- **HSTS and certificates apply to the target**, so an https target needs a valid cert.
- **Refuses a no-op**: if a row's target host equals its source host with no path prefix,
  that row is not installed. The badge shows `ERR` when no row at all could be installed.

## Verifying it is live

The popup footer reports how many rules are installed — two per enabled swap. If that count
does not match the enabled rows, the footer turns red and tells you to reload the extension. To confirm a real navigation was
redirected, open DevTools, go to the Network tab, and check the request for the document —
it shows a `307 Internal Redirect` to the target host.

## Tests

`test.mjs` covers the rewrite semantics: query/fragment preservation, percent-encoding,
path-prefix targets, port handling, and rejection of host-prefix and host-suffix lookalikes.
It also covers multi-swap behaviour: independent routing, unique rule ids, per-row scope,
priority when two rows share a host, skipping broken rows, and migrating version 1 settings.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
