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

### What CI does automatically

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

- Runs every extension's `test.mjs` suite.
- Rebuilds `downloads/*.zip` and, on a push to `main`, commits the result itself if it
  drifted from source — the "regenerate the zip or the download button goes stale" rule
  in `CLAUDE.md` becomes a safety net instead of something to remember. On a PR it fails
  the check instead of committing to someone else's branch.

This only covers `downloads/*.zip` (the plain unzip-and-load ones). `store-zips/*.zip` and
`store-assets/` aren't rebuilt in this workflow since they're not committed at all —
`.github/workflows/publish.yml` (below) builds them fresh at publish time instead.

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

Steps 2-5 above are exactly what `.github/workflows/publish.yml` automates (see below) —
use that instead once it's set up, it's the same result with no manual dashboard visit.

## Automating updates with GitHub Actions

Chrome has a real API for pushing an update to an *existing* listing and submitting it for
review — no dashboard visit needed. It cannot create the listing itself (no API for
permissions justifications, screenshots, or category), so this only ever covers step 2
onward, per extension, after that extension's first manual submission exists.

### One-time setup (per Google account, not per extension)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse
   one) and enable the **Chrome Web Store API** under APIs & Services → Library.
2. APIs & Services → Credentials → **Create Credentials** → **OAuth client ID** → application
   type **Desktop app**. Note the Client ID and Client Secret.
3. Get a refresh token for that client, scoped to the Chrome Web Store API. The easiest way
   is the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/):
   - Click the gear icon → check **Use your own OAuth credentials** → paste the Client ID
     and Client Secret from step 2.
   - In Step 1, under "Input your own scopes," enter
     `https://www.googleapis.com/auth/chromewebstore` → **Authorize APIs** → sign in with
     the same Google account that owns the Chrome Web Store listings.
   - In Step 2, click **Exchange authorization code for tokens** → copy the **Refresh
     token** shown. This doesn't expire under normal use, so this is a one-time step.
4. In the GitHub repo → **Settings → Secrets and variables → Actions**, add three repository
   secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.

### Per extension, after its first manual submission

The Developer Dashboard URL for an item looks like
`chrome.google.com/webstore/devconsole/<account-id>/<item-id>/edit` — copy the `<item-id>`
segment and set it in `store-listing/item-ids.json`:

```json
{
  "color-picker": "abcdefghijklmnopqrstuvwxyzabcdef"
}
```

Commit that. From then on, updates to that extension can go through Actions instead of the
dashboard.

### Running it

GitHub repo → **Actions** tab → **Publish to Chrome Web Store** → **Run workflow** → pick
the extension and the version bump size (patch/minor/major) → **Run workflow**. It bumps the
version, commits that, rebuilds the store zip, uploads it, and submits it for review —
equivalent to steps 2-5 in "Updating a published extension" above, with nothing to do in a
browser. Check the workflow run's logs for the outcome; a rejected upload (e.g. a policy
violation) reports Google's own error message there.
