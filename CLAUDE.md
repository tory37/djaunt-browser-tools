# djaunt-browser-tools

Guidance for working in this repo.

## New extensions must support Chrome and Firefox

Every extension in this repo should run unmodified in both Chrome and Firefox, from the
same folder — no separate per-browser variants. When adding a new extension (or touching an
existing one), follow the pattern already used by `host-swap`, `query-params`, `tab-volume`
and `dark-mode`:

- **API calls**: never call `chrome.*` or `browser.*` directly. Add one line near the top of
  each script that touches extension APIs:

  ```js
  const api = globalThis.browser ?? globalThis.chrome;
  ```

  and call `api.*` everywhere. This picks Firefox's native promise-based `browser` namespace
  when present and falls back to Chrome's `chrome` namespace otherwise.

- **`manifest.json` background**: declare both keys so each browser picks the one it
  supports:

  ```json
  "background": {
    "service_worker": "background.js",
    "scripts": ["background.js"]
  }
  ```

  Add `"type": "module"` too if the script uses `import`.

- **`browser_specific_settings`**: give every extension a Firefox id and a
  `strict_min_version` that covers whatever MV3 features it uses:

  ```json
  "browser_specific_settings": {
    "gecko": {
      "id": "<extension-name>@djaunt-browser-tools",
      "strict_min_version": "121.0"
    }
  }
  ```

  Use `121.0` as the baseline (needed for the dual `service_worker`/`scripts` background key
  to work correctly in Firefox). Bump higher if a feature needs it — e.g. `128.0` for a
  content script declared with `"world": "MAIN"`.

- **Test before shipping**: load the extension unpacked in Chrome and as a temporary add-on
  in Firefox (`about:debugging#/runtime/this-firefox`) and exercise it in both before calling
  it done.

- **Keep the docs in sync on every extension change** — adding, removing, or renaming an
  extension, or changing what one does:
  - the root `README.md` extension table
  - the extension's own `README.md`
  - `index.html`'s card for it, including its `Chrome` and `Firefox` badges

  All three must reflect the current, full set of extensions and browsers every time — not
  just the one you touched.

- **Regenerate its download zip on every file change**: `index.html`'s Download buttons
  link to pre-built `downloads/<extension>.zip` files (for people who don't use git), not
  something built live from the repo. After changing any file inside an extension's
  folder, run `./scripts/build-zips.sh` and commit the updated zip alongside the change —
  otherwise the download button silently serves stale files. This doesn't apply to
  `todo-sync/`, which is paused and has no Download button.

- **If an extension is published to the Chrome Web Store, keep `store-listing/<ext>.md` in
  sync too** — same trigger as the docs-sync rule above (adding/removing/renaming an
  extension, or changing what one does, its permissions, or its `host_permissions`). A
  permission change in particular needs its justification text updated there, since the
  dashboard requires one per permission. See `PUBLISHING.md` for the full publish/update
  pipeline (`scripts/build-store-zips.sh`, `scripts/capture-store-screenshots.mjs`,
  `scripts/bump-store-version.mjs`) — a UI change to an already-published extension still
  needs a version bump via `bump-store-version.mjs` before the store will accept the
  update, even if nothing in `store-listing/` needs editing.
