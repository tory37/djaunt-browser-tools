/**
 * Google sign-in via `identity.launchWebAuthFlow`, which Chrome and Firefox both
 * implement the same way — unlike `chrome.identity.getAuthToken`, which is Chrome-only
 * and needs an extension ID pre-registered with Google. One code path, one OAuth
 * client, both browsers. See README.md for the one-time client setup this needs.
 */
const api = globalThis.browser ?? globalThis.chrome;

// Replace with the "Desktop app" OAuth client id from your own Google Cloud project —
// see README.md. Google issues a secret for this client type too, but treats it as
// non-confidential for installed apps (their own guidance says it's safe to embed);
// PKCE (code_verifier/code_challenge below) is what actually secures this flow.
export const CLIENT_ID = 'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com';
export const CLIENT_SECRET = 'REPLACE_WITH_YOUR_CLIENT_SECRET';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const STORAGE_KEY = 'todoDriveAuth';
const EXPIRY_SKEW_MS = 30_000;

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

function randomVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function readStoredAuth() {
  const stored = await api.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? null;
}

async function writeStoredAuth(auth) {
  await api.storage.local.set({ [STORAGE_KEY]: auth });
}

async function exchangeForTokens(body) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const tokens = await res.json();
  const auth = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? (await readStoredAuth())?.refreshToken ?? null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await writeStoredAuth(auth);
  return auth;
}

async function signIn() {
  const redirectUri = api.identity.getRedirectURL();
  const verifier = randomVerifier();
  const challenge = await sha256(verifier);

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const responseUrl = await api.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });
  const code = new URL(responseUrl).searchParams.get('code');
  if (!code) throw new Error('Google sign-in did not return a code');

  return exchangeForTokens(new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }));
}

async function refresh(refreshToken) {
  return exchangeForTokens(new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }));
}

/** Returns a live access token, refreshing or prompting to sign in as needed. */
export async function getAccessToken({ interactive = true } = {}) {
  const stored = await readStoredAuth();
  if (stored && stored.expiresAt > Date.now() + EXPIRY_SKEW_MS) return stored.accessToken;

  if (stored?.refreshToken) {
    try {
      const auth = await refresh(stored.refreshToken);
      return auth.accessToken;
    } catch {
      // Refresh token revoked or expired — fall through to a full sign-in.
    }
  }

  if (!interactive) return null;
  const auth = await signIn();
  return auth.accessToken;
}

export async function isSignedIn() {
  return (await readStoredAuth()) !== null;
}

export async function signOut() {
  await api.storage.local.remove(STORAGE_KEY);
}
