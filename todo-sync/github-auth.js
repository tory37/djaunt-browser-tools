/**
 * GitHub OAuth Device Flow. Chosen over a redirect-based flow because it needs no
 * redirect URI and no client secret at all (GitHub's docs say so explicitly) — the same
 * two requests work from an extension popup or a plain web page, so this is the one auth
 * module a future web version can reuse untouched.
 *
 * Device flow has no callback the browser can react to — the user finishes it on a
 * github.com tab, not in this popup. Rather than lean on a background service worker to
 * keep polling while the popup is closed (MV3 can kill it after ~30s idle; nothing
 * guarantees a poll loop survives that), this only polls while the popup is open, and
 * resumes on the next open if the user closes it first. The device code stays valid for
 * ~15 minutes, so reopening the popup after finishing on github.com still picks it up.
 */
const api = globalThis.browser ?? globalThis.chrome;

// Replace with your own GitHub OAuth App's client id — see README.md. Device flow needs
// no client secret; GitHub's own docs say not to send one.
export const CLIENT_ID = 'REPLACE_WITH_YOUR_GITHUB_OAUTH_CLIENT_ID';

const SCOPE = 'repo';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const TOKEN_KEY = 'todoSyncGithubAuth';
const PENDING_KEY = 'todoSyncDeviceFlow';

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });
  return res.json();
}

export async function getStoredToken() {
  const stored = await api.storage.local.get(TOKEN_KEY);
  return stored[TOKEN_KEY]?.accessToken ?? null;
}

export async function getPendingDeviceFlow() {
  const stored = await api.storage.local.get(PENDING_KEY);
  const pending = stored[PENDING_KEY];
  if (!pending || pending.expiresAt < Date.now()) return null;
  return pending;
}

/** Requests a device code, opens GitHub's entry page, and stores the pending flow. */
export async function beginSignIn() {
  const data = await postForm(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: SCOPE });
  if (data.error) throw new Error(data.error_description || data.error);

  const pending = {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await api.storage.local.set({ [PENDING_KEY]: pending });
  await api.tabs.create({ url: pending.verificationUri });
  return pending;
}

/**
 * Makes one poll attempt against a pending device flow. Returns `{ done: true }` once
 * signed in, or `{ done: false, interval }` to keep waiting (the interval GitHub asked
 * for, which can grow if it replies `slow_down`).
 */
export async function pollOnce(pending) {
  const data = await postForm(TOKEN_URL, {
    client_id: CLIENT_ID,
    device_code: pending.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  if (data.access_token) {
    await api.storage.local.set({ [TOKEN_KEY]: { accessToken: data.access_token } });
    await api.storage.local.remove(PENDING_KEY);
    return { done: true };
  }

  if (data.error === 'authorization_pending') return { done: false, interval: pending.interval };
  if (data.error === 'slow_down') {
    const interval = pending.interval + 5;
    await api.storage.local.set({ [PENDING_KEY]: { ...pending, interval } });
    return { done: false, interval };
  }

  await api.storage.local.remove(PENDING_KEY);
  throw new Error(data.error_description || data.error || 'Sign-in failed');
}

export async function signOut() {
  await api.storage.local.remove([TOKEN_KEY, PENDING_KEY]);
}
