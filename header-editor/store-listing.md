# Chrome Web Store listing — Djaunt Header Editor

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Header Editor
- **Summary** (132 char max): Set and remove HTTP request headers on a domain you choose, before the request resolves.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Sets and removes HTTP request headers on a domain you choose, before the request resolves
  — the method, body and URL are left untouched. Keep as many tweaks as you like and turn
  them on one at a time.

  Built for testing auth and feature-flag headers, and for CORS debugging: add a header a
  server expects, or strip one that gets in the way — without a proxy, without touching the
  app, and without an account.

  - Every tweak stays on for its domain until you switch it off or delete it — nothing
    expires, nothing is tied to a tab or session.
  - Remove headers by name, set headers with `Name: value` pairs.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/header-editor

- **Icon**: `icons/icon128.png`
- **Screenshot(s)**: `store-assets/popup.png` (run `npm run store:screenshots`
  to generate). Consider a second, hand-taken screenshot showing an expanded row with real
  remove/set headers filled in.

## Privacy practices tab

- **Single purpose**: Sets and removes HTTP request headers on a domain the user configures,
  before the request is sent.
- **Permission justifications**:
  - `declarativeNetRequest` — required to rewrite the request's headers before it resolves.
  - `storage` — saves the user's configured tweaks locally so they persist across browser
    restarts.
  - Host permission `<all_urls>` — the domain to tweak is chosen by the user at any domain,
    not fixed in advance.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
