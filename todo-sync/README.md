# Todo Sync

> **Status: paused, non-operational.** The code here works — sign in, add/toggle/delete
> todos, sync to a private GitHub repo — but it isn't finished as a *product* decision.
> GitHub accounts are close to universal among developers and close to nonexistent among
> everyone else, so requiring one locks this out for a general audience the way the
> earlier Google Drive-backed version didn't. It's off the root README's index page and
> `index.html`'s card until that's resolved — either back to Drive, or both backends
> offered and picked at sign-in. Coming back to this later; nothing below is stale, it's
> just paused mid-decision.

Chrome & Firefox extension (Manifest V3) that is a todo list — nothing more — that saves
to a private repo in **your own** GitHub account. There's no account with us, no server
we run, no database to manage, and nothing to self-host.

## Under the hood

Being upfront about the mechanism, since it's unusual for a todo app:

- Signing in uses GitHub's **OAuth Device Flow**: the extension asks GitHub for a short
  code, opens `github.com/login/device` in a new tab, and you type the code there.
  Behind the scenes the extension polls GitHub every few seconds until you finish. This
  flow needs no redirect URL and no client secret — GitHub's own docs say not to send
  one — which is why it was picked over a normal OAuth redirect.
- The first time you sign in, the extension creates a **private repository** named
  `todo-sync-data-<your account's numeric GitHub id>` under your account and stores
  everything in one `todos.json` file in it, using GitHub's Contents API. You'll see that
  repo if you browse your own GitHub repos — it's not hidden from *you*, just private to
  everyone else. The numeric id (permanent, unlike a username you can rename) is there so
  an unrelated repo you already have can never be mistaken for this one — see below.
- Every edit re-renders instantly from an in-memory copy, then a debounced save pushes
  the whole file to GitHub. GitHub rejects the write (409) if the file changed since you
  last read it — e.g. you edited on another device in the meantime — and the extension
  responds by pulling the latest copy, merging it with your local changes (a todo edited
  on either side wins over one left untouched), and retrying.

## Is the data actually private?

Yes, but it's worth explaining *why*, because an earlier design for this used a GitHub
**Gist** instead of a repo, and Gists don't give you this:

- A "secret" Gist is **not access-controlled** — it's just an unlisted URL. GitHub's own
  docs say plainly that anyone who gets the link can view a secret Gist's contents, no
  GitHub account required. The privacy is security-through-obscurity: guess or leak the
  URL, and the data is readable by anyone.
- A **private repository** is genuinely access-controlled. The name being predictable —
  or not — buys an attacker nothing either way: GitHub returns `404 Not Found` — not even
  a `403`, specifically so it doesn't confirm the repo exists — to anyone querying it
  without a valid token for your account. Knowing the name isn't knowing a secret; you
  still need to actually be signed in as you (or be a collaborator you added). The
  account-numbered name (above) is about avoiding an accidental collision with some other
  repo of yours, not about hiding anything — a private repo is exactly as private whether
  it's named `todos` or something unguessable.
- As a second, independent guard against that same collision: before writing to a repo
  that already exists under that name, the extension checks its description for a fixed
  marker string it always sets when it creates one. A repo with the right name but no
  marker fails loudly with an error instead of being silently read from or written to.

The tradeoff that comes with this: to create and write to "a repo" via the API, the
OAuth scope requested is `repo` — full read/write access to *all* of your private repos,
not narrowly scoped to just this one. A more surgical setup is possible (a GitHub App
installed on only this one repo, permissioned to just "Contents"), but it trades away the
one-click "sign in and go" flow for an extra manual "create and install on this repo"
step the first time. This build takes the broader scope to keep sign-in to one step; if
that tradeoff doesn't sit right with you, that's the alternative to switch to.

## One-time setup (for whoever builds/runs this — not per end user)

GitHub requires every app to be registered before anyone can sign in. This is a one-time
step for you, the person building/running this — not something each person who uses the
extension repeats.

1. Go to [github.com/settings/developers](https://github.com/settings/developers) →
   **OAuth Apps** → **New OAuth App**.
2. Fill in an application name and a homepage URL (this repo's URL is fine). The
   **Authorization callback URL** field is required by the form but unused by device
   flow — the homepage URL again works.
3. After creating it, open the app's settings and check **Enable Device Flow**, then
   save. It's easy to miss since it's a separate step from creating the app — if you skip
   it, sign-in fails with a "Not Found" error that looks identical to having pasted the
   wrong Client ID, since GitHub returns the same error for both.
4. Copy the **Client ID** — that's the only credential this needs. Open `github-auth.js`
   in this folder and replace `CLIENT_ID` with it.

There's no client secret to configure — device flow doesn't use one.

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

- Click the toolbar icon, then **Sign in with GitHub**. A GitHub tab opens with a code;
  type it there to finish.
- If you close the popup before finishing, just reopen it — the code stays valid for
  about 15 minutes, and the popup picks up right where it left off.
- Type in the box and hit **Add** (or Enter) to add a todo.
- Click the checkbox to mark it done — done items sort to the bottom.
- Click the **✕** that appears on hover to delete one, or **Clear completed** to drop all
  done items at once.
- **Sign out** forgets the saved token and clears the local cache; your data stays in the
  `todo-sync-data-<your account id>` repo and picks back up next time you sign in.

## How it works

- `github-auth.js` runs the OAuth Device Flow described above. It only polls while the
  popup is open — there's no background service worker keeping a poll loop alive, since
  Manifest V3 can kill a service worker after ~30 seconds idle and nothing guarantees a
  polling loop survives that. Closing and reopening the popup resumes it instead.
- `github-store.js` reads and writes `todos.json` in that per-account repo via GitHub's
  REST Contents API — no other host permissions, no third-party server. It checks the
  repo's description against a fixed marker before touching one that already exists, so
  an unrelated repo you happen to already have never gets silently treated as this one.
- `todos.js` is the list logic (add/toggle/remove/sort/merge) with no browser API at all,
  so it's covered by `test.mjs` without needing a browser or a mock of one.

## Limits

- Single flat list — no projects, due dates, or subtasks in this version.
- Conflict handling is last-writer-wins per todo, not a full CRDT — two devices editing
  the *same* todo's text at the same moment will pick one side, not merge the edit itself.
- The `repo` OAuth scope is broader than this app strictly needs (see "Is the data
  actually private?" above) — it can read and write all of your private repos, not just
  the one it creates.
- Polling for device-flow sign-in only happens while the popup stays open; it resumes,
  rather than continues, if you close the popup before authorizing.
