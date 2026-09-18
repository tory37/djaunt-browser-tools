import { getAccessToken } from './auth.js';

/** All reads/writes stay inside Drive's hidden per-app folder — nothing appears in the
 * user's visible Drive, and it's deleted automatically if they revoke access. */
const FILE_NAME = 'todos.json';
const FILE_FIELDS = 'id, modifiedTime';

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive request failed: ${res.status} ${await res.text()}`);
  return res;
}

async function findFile() {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('spaces', 'appDataFolder');
  url.searchParams.set('q', `name = '${FILE_NAME}' and trashed = false`);
  url.searchParams.set('fields', `files(${FILE_FIELDS})`);
  const res = await authedFetch(url);
  const { files } = await res.json();
  return files[0] ?? null;
}

/** Fetches the current todo list and the file's id/modifiedTime, or nulls if none exists yet. */
export async function loadRemote() {
  const file = await findFile();
  if (!file) return { fileId: null, modifiedTime: null, todos: [] };
  const res = await authedFetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
  );
  return { fileId: file.id, modifiedTime: file.modifiedTime, todos: await res.json() };
}

/** Reads just the file's current modifiedTime, to detect a change from another device. */
export async function remoteModifiedTime(fileId) {
  const res = await authedFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`,
  );
  return (await res.json()).modifiedTime;
}

function buildMultipartBody(boundary, metadata, todos) {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(todos),
    `--${boundary}--`,
  ].join('\r\n');
}

/** Creates or overwrites the todo file. Returns the new fileId and modifiedTime. */
export async function saveRemote({ fileId, todos }) {
  const boundary = 'djaunt-todo-drive';
  const metadata = fileId ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=${FILE_FIELDS}`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`;

  const res = await authedFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: buildMultipartBody(boundary, metadata, todos),
  });
  return res.json();
}
