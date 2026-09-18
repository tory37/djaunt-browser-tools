# Todo Drive

Chrome & Firefox extension (Manifest V3) that is a todo list — nothing more — that saves
to a hidden, app-only file in **your own** Google Drive. There's no account with us, no
server we run, no database to manage, and nothing to self-host. You install it, sign in
with your own Google account, and your todos live in your Drive the same way a note in
Google Keep does.

## Why this exists

A normal "todo app that syncs" needs somewhere to put your data: either you run a
database and a backend (a real project, not a weekend one), or you sign up for someone
else's service and trust them with your list. This sidesteps both — the extension talks
directly to the Google Drive API with your own OAuth token, and stores one JSON file in
Drive's `appDataFolder`: a folder that's invisible in your regular Drive UI, scoped only
to this extension, and deleted automatically if you ever revoke its access.

## One-time setup (for whoever builds/runs this — not per end user)

Google requires every app that talks to its APIs to be registered, so before *anyone* can
sign in, you (the person installing/building this) need your own free OAuth client. This
is a one-time step — not something each person who uses the extension has to repeat.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project
   (or reuse one), and enable the **Google Drive API** under **APIs & Services → Library**.
2. Under **APIs & Services → OAuth consent screen**, configure it for **External** users,
   fill in the required fields, and add the scope
   `https://www.googleapis.com/auth/drive.appdata`. While the app is in **Testing** mode
   you can add up to 100 test users (your own Google account included) without Google
   reviewing the app — good enough for personal use or a small group.
3. Under **APIs & Services → Credentials → Create Credentials → OAuth client ID**, choose
   application type **Desktop app**. Copy the **Client ID** and **Client secret** it gives
   you.
4. Open `auth.js` in this folder and replace `CLIENT_ID` and `CLIENT_SECRET` with those
   values.

That `client_secret` looks alarming to paste into a client-side file, but for this OAuth
client type Google's own documentation treats it as non-confidential — it can't be used
to impersonate the app without also having a user's consent, and the actual security here
comes from PKCE (the `code_verifier`/`code_challenge` in `auth.js`), not the secret. It's
the same model Google's own installed-app samples use.

If Google's consent screen stays in **Testing** mode, only the test users you listed can
sign in, and each shows a "Google hasn't verified this app" warning they have to click
through (**Advanced → Go to Todo Drive (unsafe)**) — expected for an app that isn't
published, not a sign of anything actually wrong.

## Install

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension so the toolbar button is visible.

**Firefox** (121+, for this manifest's dual background key):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select this folder's `manifest.json`.

This load is temporary — Firefox drops it on restart, so reload it the same way after a
`git pull`. For a load that survives restarts, package the folder with
[`web-ext`](https://github.com/mozilla/web-ext) and sign it, or run it in a channel that
allows unsigned extensions.

## Use

- Click the toolbar icon, then **Sign in with Google**. Google's own consent screen opens
  in a tab; approve it and the popup shows your list.
- Type in the box and hit **Add** (or Enter) to add a todo.
- Click the checkbox to mark it done — done items sort to the bottom.
- Click the **✕** that appears on hover to delete one, or **Clear completed** to drop all
  done items at once.
- **Sign out** forgets the saved token and clears the local cache; your data stays in
  Drive and picks back up next time you sign in.

## How it works

- `auth.js` runs Google's OAuth PKCE flow through `identity.launchWebAuthFlow` — the one
  identity API both Chrome and Firefox implement the same way, so there's a single auth
  code path instead of a Chrome-only branch (`chrome.identity.getAuthToken`) and a
  separate Firefox one. Tokens are cached in `storage.local` and refreshed silently until
  the refresh token itself is revoked, at which point it falls back to a full sign-in.
- `drive.js` reads and writes one `todos.json` file inside Drive's `appDataFolder` via
  the Drive v3 REST API — no other host permissions, no third-party server in between.
- `todos.js` is the list logic (add/toggle/remove/sort/merge) with no browser API at all,
  so it's covered by `test.mjs` without needing a browser or a mock of one.
- Every edit re-renders immediately from the in-memory list, then a debounced save pushes
  it to Drive. Before overwriting, it checks the file's `modifiedTime` against the value
  it last saw; if another device changed it in between, it merges the two lists (a todo
  edited on either side wins over one untouched since the last sync) instead of clobbering
  the other device's changes.

## Limits

- Single flat list — no projects, due dates, or subtasks in this version.
- Conflict handling is last-writer-wins per todo, not a full CRDT — two devices editing
  the *same* todo's text at the same moment will pick one side, not merge the edit itself.
- While Google's consent screen is unverified (see setup above), only the test users you
  added can sign in, and everyone else sees an "unverified app" warning.
