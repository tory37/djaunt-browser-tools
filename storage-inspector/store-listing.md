# Chrome Web Store listing — Djaunt Storage Inspector

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Storage Inspector
- **Summary** (132 char max): View, edit and delete localStorage and sessionStorage on the current tab — access only to the tab you click on.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Views, edits and deletes `localStorage` and `sessionStorage` entries for the active tab's
  page, right from the toolbar — no DevTools panel required.

  Click the icon and see every key and value the page has stored, grouped into Local Storage
  and Session Storage. Edit a value in place, delete a stale key, add a new one, or export the
  whole store to a JSON file. A filter box narrows a long list by key or value in real time.

  - Access only the tab you click on — no `host_permissions`, no `<all_urls>`, no permanent
    content script watching every page you visit.
  - Reads and writes go straight through the page's real Storage API, so what you see is what
    the page sees.
  - Export any store to a `{key: value}` JSON file in one click.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/storage-inspector

- **Icon**: `icons/icon128.png`
- **Screenshot(s)**: `store-assets/popup.png` (run `npm run store:screenshots`
  to generate).

## Privacy practices tab

- **Single purpose**: Views, edits and deletes localStorage and sessionStorage entries for the
  active browser tab.
- **Permission justifications**:
  - `activeTab` — grants temporary access to the one tab the user has open when they click the
    toolbar icon, so the popup can read and write that page's storage.
  - `scripting` — runs the small read/write functions inside that tab's page; required to reach
    `localStorage`/`sessionStorage`, which live in the page's own context.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
