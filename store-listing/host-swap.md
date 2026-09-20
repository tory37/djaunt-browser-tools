# Chrome Web Store listing — Djaunt Host Swap

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`host-swap/README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Host Swap
- **Summary** (132 char max): Rewrite one host to another before the request resolves — path, query, and fragment stay untouched.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Rewrites hosts to other hosts before the request resolves, keeping the path, query
  string and fragment byte-identical. Keep as many swaps as you like and turn them on
  one at a time.

  Built for testing branch deploys: an app sends you to a fixed host, and this points
  that navigation at your own branch build instead — without you hand-editing a URL
  that carries live auth tokens.

  - Add as many host-to-host swaps as you want; each has its own on/off switch.
  - Nothing is pre-filled — you type both the "from" and "to" host yourself.
  - The toolbar badge shows how many swaps are currently live.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/host-swap

- **Icon**: `host-swap/icons/icon128.png`
- **Screenshot(s)**: `store-assets/host-swap/popup.png` (run `npm run store:screenshots` to
  generate). Consider a second, hand-taken screenshot showing an expanded swap row with a
  real from/to host filled in — the empty-state popup alone doesn't show what the tool does.

## Privacy practices tab

- **Single purpose**: Redirects requests from one host to another host that the user
  configures, before the request is sent.
- **Permission justifications**:
  - `declarativeNetRequest` — required to rewrite the request's host before it resolves;
    this is the only API that can redirect a request at that stage.
  - `storage` — saves the user's configured host swaps locally so they persist across
    browser restarts.
  - Host permission `<all_urls>` — the host to rewrite is chosen by the user at any domain,
    not fixed in advance, so the extension needs to be able to match a request on any host.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data. (Leave every category checkbox
  unchecked — nothing here reads page content, browsing history, or personal info; it only
  rewrites the host of a URL the user typed in.)
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
