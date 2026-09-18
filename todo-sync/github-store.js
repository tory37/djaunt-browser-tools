import { getStoredToken } from './github-auth.js';

/**
 * Storage backend: a private GitHub repo, auto-created under the signed-in account on
 * first use, holding one `todos.json`. See README.md for why a repo (real, enforced
 * access control) was chosen over a Gist (an unlisted-but-public URL, not actually
 * access-controlled) — and for the `repo` scope tradeoff that goes with it.
 */
const FILE_PATH = 'todos.json';
const API_ROOT = 'https://api.github.com';

// A marker checked on an existing repo before writing to it, and a name built from the
// account's numeric id (permanent, unlike a username you can rename) rather than a fixed
// string — not for secrecy (a private repo is already only visible to the account it
// belongs to), just so an unrelated repo that happens to share the name is never mistaken
// for this one.
const REPO_DESCRIPTION = 'Todo Sync data — auto-created by the extension. Safe to ignore; '
  + 'deleting it clears your todos. Marker: djaunt-todo-sync-v1';

function utf8ToBase64(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function authedFetch(path, options = {}) {
  const token = await getStoredToken();
  if (!token) throw new Error('Not signed in');
  return fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

async function getAccount() {
  const res = await authedFetch('/user');
  if (!res.ok) throw new Error(`Couldn't read GitHub account: ${res.status}`);
  const { login, id } = await res.json();
  return { login, repoName: `todo-sync-data-${id}` };
}

async function ensureRepo(owner, repoName) {
  const check = await authedFetch(`/repos/${owner}/${repoName}`);
  if (check.ok) {
    const repo = await check.json();
    if (!repo.description?.includes('djaunt-todo-sync-v1')) {
      throw new Error(
        `A repo named "${repoName}" already exists but wasn't created by Todo Sync — `
        + 'rename or delete it, then sign in again.',
      );
    }
    return;
  }
  if (check.status !== 404) throw new Error(`Couldn't check for the data repo: ${check.status}`);

  const create = await authedFetch('/user/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repoName,
      private: true,
      description: REPO_DESCRIPTION,
      auto_init: true,
    }),
  });
  if (!create.ok) throw new Error(`Couldn't create the data repo: ${create.status}`);
}

/** Fetches the current todo list and the file's sha, or nulls if it doesn't exist yet. */
export async function loadRemote() {
  const { login: owner, repoName } = await getAccount();
  await ensureRepo(owner, repoName);

  const res = await authedFetch(`/repos/${owner}/${repoName}/contents/${FILE_PATH}`);
  if (res.status === 404) return { owner, repoName, sha: null, todos: [] };
  if (!res.ok) throw new Error(`Couldn't read todos: ${res.status}`);

  const file = await res.json();
  return { owner, repoName, sha: file.sha, todos: JSON.parse(base64ToUtf8(file.content)) };
}

/**
 * Creates or overwrites todos.json. GitHub rejects the write with 409 if `sha` doesn't
 * match the file's current version — the same "someone else changed this" signal Drive's
 * modifiedTime check gave us, but enforced by GitHub itself instead of hand-checked.
 */
export async function saveRemote({ owner, repoName, sha, todos }) {
  const res = await authedFetch(`/repos/${owner}/${repoName}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update todos',
      content: utf8ToBase64(JSON.stringify(todos, null, 2)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409) return { conflict: true };
  if (!res.ok) throw new Error(`Couldn't save todos: ${res.status}`);
  const body = await res.json();
  return { conflict: false, sha: body.content.sha };
}
