# Chrome Web Store listing — Djaunt URL Rewrite

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt URL Rewrite
- **Summary** (132 char max): Reroute a host and remove or set query string parameters in one rule, before the request resolves.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Reroutes a host to another host and removes or sets query string parameters before the
  request resolves. One row does both, in a fixed order: host first, then params. Keep as
  many rewrites as you like and turn them on one at a time.

  Built for testing branch deploys: the app hands you a launch URL with live auth tokens,
  and this points it at your branch build and flips the flags you want — without you
  hand-editing the URL.

  - A path on the target is prepended, so a deploy served from a subdirectory works.
  - Remove params by name, add or replace params as name/value pairs.
  - Every rewrite stays on until you switch it off or delete it — nothing expires, nothing
    is tied to a tab or session.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/url-rewrite

- **Icon**: `icons/icon128.png`
- **Screenshot(s)**: `store-assets/popup.png` (run `npm run store:screenshots`
  to generate). Consider a second, hand-taken screenshot showing an expanded row with a
  target host and remove/add params filled in, and the preview.

## Privacy practices tab

- **Single purpose**: Rewrites the host and query string of requests to a host the user
  configures, before the request is sent.
- **Permission justifications**:
  - `declarativeNetRequest` — required to redirect the request to the target host and
    rewrite its query string before it resolves.
  - `storage` — saves the user's configured rewrites locally so they persist across browser
    restarts.
  - Host permission `<all_urls>` — the host to rewrite, and the target it is sent to, are
    chosen by the user at any domain, not fixed in advance. Redirect rules need host access
    to both.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
