// Uploads a new package to an existing Chrome Web Store item and publishes it, via
// Google's Chrome Web Store API. Only works for an item that already exists — the first
// submission for any extension still has to be done by hand in the Developer Dashboard
// (permissions justifications, screenshots, category — none of that has an API). See
// PUBLISHING.md for the one-time OAuth setup this needs.
//
// Usage: node scripts/publish-to-store.mjs <extension>
// Requires env vars: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
// Requires scripts/item-ids.json to have a non-empty id for <extension>.
// Requires <extension>/store-zips/<extension>-<version>.zip to already be built
// (build-store-zips.sh).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const [, , ext] = process.argv;
if (!ext) {
  console.error('Usage: node scripts/publish-to-store.mjs <extension>');
  process.exit(1);
}

const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN } = process.env;
for (const [name, value] of Object.entries({ CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN })) {
  if (!value) {
    console.error(`Missing env var ${name} — see PUBLISHING.md's one-time OAuth setup.`);
    process.exit(1);
  }
}

const itemIds = JSON.parse(await readFile(path.join(root, 'scripts', 'item-ids.json'), 'utf8'));
const itemId = itemIds[ext];
if (!itemId) {
  console.error(
    `No item id for "${ext}" in scripts/item-ids.json. That means it hasn't been `
    + 'submitted to the Web Store yet — do the first submission by hand (see PUBLISHING.md), '
    + 'then add its item id there before this can publish updates to it.',
  );
  process.exit(1);
}

const manifest = JSON.parse(await readFile(path.join(root, ext, 'manifest.json'), 'utf8'));
const zipPath = path.join(root, ext, 'store-zips', `${ext}-${manifest.version}.zip`);
let zipBuffer;
try {
  zipBuffer = await readFile(zipPath);
} catch {
  console.error(`${zipPath} doesn't exist — run ./scripts/build-store-zips.sh first.`);
  process.exit(1);
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CWS_CLIENT_ID,
      client_secret: CWS_CLIENT_SECRET,
      refresh_token: CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to refresh access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function upload(accessToken) {
  const res = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${itemId}?uploadType=media`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-api-version': '2',
      },
      body: zipBuffer,
    },
  );
  const data = await res.json();
  if (data.uploadState !== 'SUCCESS') {
    throw new Error(`Upload failed: ${JSON.stringify(data, null, 2)}`);
  }
  console.log(`Uploaded ${ext} v${manifest.version} — uploadState: SUCCESS`);
}

async function publish(accessToken) {
  const res = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-api-version': '2',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: 'default' }),
    },
  );
  const data = await res.json();
  const ok = (data.status || []).some((s) => s === 'OK');
  if (!ok) {
    throw new Error(`Publish failed: ${JSON.stringify(data, null, 2)}`);
  }
  console.log(`Submitted ${ext} v${manifest.version} for review — status: ${data.status.join(', ')}`);
}

const accessToken = await getAccessToken();
await upload(accessToken);
await publish(accessToken);
