// Pure helpers for Storage Inspector — no DOM, no extension APIs, so this file
// can be unit-tested directly under Node and reused by popup.js.

const RESTRICTED_PROTOCOLS = new Set([
  'chrome:', 'chrome-extension:', 'chrome-untrusted:', 'edge:', 'about:',
  'moz-extension:', 'view-source:', 'devtools:', 'data:',
]);

const RESTRICTED_HOSTS = new Set([
  'chromewebstore.google.com',
  'chrome.google.com',
  'addons.mozilla.org',
  'microsoftedge.microsoft.com',
]);

export function isRestrictedUrl(url) {
  if (!url) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return true;
  if (RESTRICTED_HOSTS.has(parsed.hostname)) return true;
  return false;
}

export function looksLikeJson(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const first = trimmed[0];
  const isLikelyStart = first === '{' || first === '[' || first === '"'
    || /^-?\d/.test(trimmed) || trimmed === 'true' || trimmed === 'false' || trimmed === 'null';
  if (!isLikelyStart) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

export function formatJsonPreview(value, indent = 2) {
  try {
    return JSON.stringify(JSON.parse(value), null, indent);
  } catch {
    return value;
  }
}

export function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => a.key.localeCompare(b.key));
}

export function filterEntries(entries, query) {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (entry) => entry.key.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q),
  );
}

export function totalBytes(entries) {
  return entries.reduce((sum, entry) => sum + byteLength(entry.key) + byteLength(entry.value), 0);
}

export function buildExport(entries) {
  const obj = {};
  for (const { key, value } of sortEntries(entries)) obj[key] = value;
  return JSON.stringify(obj, null, 2);
}
