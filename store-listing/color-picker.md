# Chrome Web Store listing — Djaunt Color Picker

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`color-picker/README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Color Picker
- **Summary** (132 char max): Pick any on-screen color, convert formats, check contrast, build gradients. No host permissions.
- **Category**: Design
- **Language**: English (United States)
- **Description**:

  Picks any on-screen color, converts it between hex/RGB/HSL/OKLCH, checks WCAG contrast,
  and builds CSS gradients — with no host permissions at all.

  Built as a ColorZilla alternative that fixes its biggest complaints: ColorZilla asks for
  access to every page you visit — this asks for none. ColorZilla's picker can sample the
  wrong pixel on a HiDPI display — this one samples real captured pixel data, not a
  CSS-pixel guess. ColorZilla nags about a paid tier — this has no tiers, accounts, or
  network calls at all.

  - Pick any pixel on screen (not just inside the tab) via the native EyeDropper API where
    supported, or a zoomed full-page picker elsewhere.
  - Convert instantly between hex, RGB, HSL, and OKLCH.
  - Check WCAG contrast between two colors.
  - Build and copy CSS gradients.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/color-picker

- **Icon**: `color-picker/icons/icon128.png`
- **Screenshot(s)**: `store-assets/color-picker/popup.png` (run `npm run store:screenshots`
  to generate). Consider additional screenshots of the History, Gradient, and Contrast tabs
  with real content in them.

## Privacy practices tab

- **Single purpose**: Picks a color from the screen and converts/inspects it.
- **Permission justifications**:
  - `activeTab` — used only when the user clicks "Pick color from page" in a browser
    without the native EyeDropper API, to open an in-page picker on the current tab; not
    used otherwise.
  - `storage` — saves picked-color history and preferences locally so they persist across
    browser restarts.
  - No host permissions are requested.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
