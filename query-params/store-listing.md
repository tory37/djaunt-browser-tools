# Chrome Web Store listing — Djaunt Query Params

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Query Params
- **Summary** (132 char max): Remove and add query string parameters on a domain you choose, before the request resolves.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Removes and adds query string parameters on a domain you choose, before the request
  resolves — the scheme, host, path and fragment are left untouched. Keep as many tweaks
  as you like and turn them on one at a time.

  Built for testing flags and locales: the app hands you a launch URL, and this strips the
  params that get in the way and pins the ones you want — without you hand-editing a URL
  that carries live auth tokens.

  - Every tweak stays on for its domain until you switch it off or delete it — nothing
    expires, nothing is tied to a tab or session.
  - Remove params by name, add or replace params with `key=value` pairs.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/query-params

- **Icon**: `icons/icon128.png`
- **Screenshot(s)**: `store-assets/popup.png` (run `npm run store:screenshots`
  to generate). Consider a second, hand-taken screenshot showing an expanded row with real
  remove/add params filled in.

## Privacy practices tab

- **Single purpose**: Adds and removes query string parameters on a domain the user
  configures, before the request is sent.
- **Permission justifications**:
  - `declarativeNetRequest` — required to rewrite the request's query string before it
    resolves.
  - `storage` — saves the user's configured tweaks locally so they persist across browser
    restarts.
  - Host permission `<all_urls>` — the domain to tweak is chosen by the user at any domain,
    not fixed in advance.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
