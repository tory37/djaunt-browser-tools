# Publishing to the Chrome Web Store

Each extension in this repo is its own Chrome Web Store listing — the store has no concept
of a multi-extension repo. This doc covers the parts the tooling here automates, and the
parts that are unavoidably manual (the dashboard is a web UI with no public API for this).

## One-time account setup

1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign
   in with the Google account you want to publish under.
2. Pay the one-time $5 registration fee. This is per developer account, not per extension.

## The pipeline in this repo

- `./scripts/build-store-zips.sh` — builds `store-zips/<ext>-<version>.zip` for every
  extension, with `manifest.json` at the zip root (the dashboard rejects a zip with the
  extension folder nested inside, which is what `downloads/<ext>.zip` deliberately has for
  the "unzip and Load unpacked" flow — the two zip layouts serve different audiences and are
  not interchangeable).
- `npm run store:screenshots` (or `node scripts/capture-store-screenshots.mjs`) — loads each
  extension into a real Chromium via Playwright and captures its popup at 1280x800 into
  `store-assets/<ext>/popup.png`. Needs a display; if there isn't one, run it under
  `xvfb-run -a npm run store:screenshots`. First run: `npm install`.
- `node scripts/bump-store-version.mjs <ext> [patch|minor|major]` — bumps that extension's
  `manifest.json` version and rebuilds both zip flavors in one step. Use this for every
  future update, not just the first submission (the store rejects a re-upload with an
  unchanged version number).
- `store-listing/<ext>.md` — the actual copy for the dashboard forms (title, description,
  category, permission justifications, data-usage answers, privacy policy URL). Kept in
  sync with each extension's own README and its `index.html` card.
- `privacy.html` — one privacy policy covering every extension, served at
  `https://tory37.github.io/djaunt-browser-tools/privacy.html` once GitHub Pages is on.
  Required by the dashboard for any listing requesting broad host permissions.

`store-zips/`, `store-assets/`, and `.tmp-profile/` are gitignored — they're regenerable
publishing artifacts, not source, the same way `node_modules/` is.

## Submitting one extension

Recommended order: **`color-picker` first** — it's the only one with no host permissions,
so it clears review fastest and validates the whole pipeline before the `<all_urls>`
extensions, which get closer scrutiny.

1. `npm install` (first time only), then `xvfb-run -a npm run store:screenshots` and
   `./scripts/build-store-zips.sh` if you haven't already.
2. Dashboard → **New Item** → upload `store-zips/<ext>-<version>.zip`.
3. **Store listing** tab → fill in from `store-listing/<ext>.md`: title, summary,
   description, category, language, icon (already in the zip, but the dashboard also wants
   it uploaded separately), screenshot(s) from `store-assets/<ext>/`.
4. **Privacy practices** tab → fill in from the same file: single purpose, a justification
   per permission and per host permission, the remote-code question (no), data usage
   (does not collect user data), and the privacy policy URL.
5. Submit for review.
6. Tell me once it's live (or if it comes back with a reviewer question) — I'll help with
   whatever the dashboard is asking for.

## Updating a published extension

Do this for every change after the first release, however small (a UI tweak counts):

1. Make and test the change locally as usual.
2. `node scripts/bump-store-version.mjs <ext>` (defaults to a patch bump; pass `minor` or
   `major` if it's a bigger change). This bumps the version and rebuilds both zips.
3. Dashboard → that listing → **Package** tab → upload the new `store-zips/<ext>-<version>.zip`.
4. Only touch the Store listing / Privacy practices tabs if what changed actually affects
   them (new permission, different behavior) — otherwise leave them as-is.
5. Submit for review. It goes through review again, but a no-new-permissions update
   typically clears faster than the first submission. Existing installs update
   automatically once it's approved — no action from users, no re-download.
