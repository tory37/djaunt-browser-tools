# Chrome Web Store listing — Djaunt Dark Mode

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`dark-mode/README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Dark Mode
- **Summary** (132 char max): Force a dark color scheme on any site, skipping pages that already look dark.
- **Category**: Tools
- **Language**: English (United States)
- **Description**:

  Forces a dark color scheme on any site, skipping pages that already look dark. Turn it
  on globally, or override it per domain for the rest of the browsing session.

  - "Enable everywhere" applies dark mode to every site, except ones the built-in detector
    finds are already dark.
  - Override per domain with Auto / Always on / Always off.
  - The popup shows what the detector found and whether dark mode is actually applied to
    the current tab right now.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/dark-mode

- **Icon**: `dark-mode/icons/icon128.png`
- **Screenshot(s)**: `store-assets/dark-mode/popup.png` (run `npm run store:screenshots` to
  generate). Strongly consider a second, hand-taken before/after screenshot of a real page
  with dark mode applied — that's the actual selling point, not the popup.

## Privacy practices tab

- **Single purpose**: Applies a dark color filter to web pages the user chooses.
- **Permission justifications**:
  - `tabs` — needed to identify the active tab's domain, so a per-domain override can be
    applied and remembered correctly.
  - `scripting` — injects the CSS/JS that applies the dark filter and detects whether a
    page is already dark; there is no declarative API for this.
  - `storage` — saves the global toggle and per-domain overrides locally so they persist
    across browser restarts.
  - Host permission `<all_urls>` — dark mode can be applied to any site the user visits,
    not a fixed list.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
