# Chrome Web Store listing — Djaunt Net Mock

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`net-mock/README.md`, `net-mock/API.md`, and its `index.html` card when any of them change.

## Store listing tab

- **Title**: Djaunt Net Mock
- **Summary** (132 char max): Intercept fetch/XHR calls and answer the ones you choose with a response you wrote.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Intercepts the page's own `fetch` and `XMLHttpRequest` calls and answers the ones you
  choose with a response you wrote — a mock body, a forced 500, a delay, or a hard
  failure — without touching the app or standing up a server.

  Also exposes a page-level `window.djauntMock` API, so an agent or automated test can
  install a rule in one line without opening the popup.

  - Match requests by URL pattern (with wildcards or regex) and method.
  - Rules persist across page loads and browser restarts; each has its own on/off switch.
  - A match log shows which requests hit a rule and which passed through untouched.
  - No account, no network calls of its own, no data collection. Source, full docs, and the
    scripting API: https://github.com/tory37/djaunt-browser-tools/tree/main/net-mock

- **Icon**: `net-mock/icons/icon128.png`
- **Screenshot(s)**: `store-assets/net-mock/popup.png` (run `npm run store:screenshots` to
  generate). Consider a second, hand-taken screenshot showing a configured rule and a match
  in the log — the empty-state popup alone doesn't show what it does.

## Privacy practices tab

- **Single purpose**: Intercepts the current page's own network requests and answers
  selected ones with a response the user configured.
- **Permission justifications**:
  - `storage` — saves the user's configured mock rules locally so they persist across
    browser restarts.
  - Host permission `<all_urls>` — the page to mock is whatever site the user is currently
    testing, not fixed in advance.
  - Content scripts (`world: "MAIN"`) — required to intercept `fetch`/`XMLHttpRequest` at
    the page's own JavaScript context; a content script running in the isolated world
    cannot see or replace those calls.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data. It reads request/response data only
  to compare against rules the user configured, entirely within the browser; nothing is
  transmitted anywhere.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
