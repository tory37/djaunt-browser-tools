# Chrome Web Store listing — Djaunt Tab Volume

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`tab-volume/README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Tab Volume
- **Summary** (132 char max): Set each tab's volume from 0-100%, optionally saved per domain.
- **Category**: Tools
- **Language**: English (United States)
- **Description**:

  Sets the volume of each tab from 0 to 100 percent of the system volume, with an option
  to save that level for every tab on the same domain.

  - Drag the slider or click a preset (0 / 25 / 50 / 100) for the active tab.
  - Turn on "Keep for this domain" to apply and remember a level for every tab on that
    hostname, not just the current one.
  - The toolbar badge shows the percentage whenever a tab is below 100.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/tab-volume

- **Icon**: `tab-volume/icons/icon128.png`
- **Screenshot(s)**: `store-assets/tab-volume/popup.png` (run `npm run store:screenshots`
  to generate). Consider a second, hand-taken screenshot with the slider set below 100% and
  the toolbar badge visible.

## Privacy practices tab

- **Single purpose**: Adjusts the audio volume of the browser tab the user is on.
- **Permission justifications**:
  - `tabs` — needed to identify the active tab and its domain, so a saved level can be
    applied to the right tab.
  - `scripting` — injects the small in-page script that actually changes the tab's audio
    element volume; there is no extension API that adjusts tab audio directly.
  - `storage` — saves per-domain volume levels locally so they persist across browser
    restarts.
  - Host permission `<all_urls>` — the extension needs to inject its volume-control script
    into whatever page the user is currently on, which can be any site.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
