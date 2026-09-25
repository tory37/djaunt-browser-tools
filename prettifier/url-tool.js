/**
 * Parses a URL into its query-string parameters for viewing and editing, and
 * rebuilds the URL from an edited parameter list. The origin, path and hash
 * are never touched — only the query string is reconstructed.
 */
export function parseUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { url: null, error: null };
  try {
    return { url: new URL(trimmed), error: null };
  } catch {
    return { url: null, error: 'Not a valid URL — make sure to include the scheme, e.g. https://' };
  }
}

/** Query params in appearance order, duplicates kept as separate rows. */
export function paramsFromUrl(url) {
  if (!url) return [];
  return Array.from(url.searchParams.entries()).map(([key, value]) => ({ key, value }));
}

/** Rebuilds the URL's query string from a (possibly edited) param list. A blank key drops that row. */
export function buildUrl(url, params) {
  if (!url) return '';
  const next = new URL(url.toString());
  const usp = new URLSearchParams();
  for (const { key, value } of params) {
    if (!key) continue;
    usp.append(key, value ?? '');
  }
  const search = usp.toString();
  next.search = search ? `?${search}` : '';
  return next.toString();
}
