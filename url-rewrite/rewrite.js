export const NAVIGATION_RESOURCE_TYPES = ['main_frame', 'sub_frame'];
export const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];

// Worst case per row: two path-prefix swap rules plus one rule for the params.
export const RULES_PER_REWRITE = 3;
export const MAX_REWRITES = 32;
export const ALL_RULE_IDS = Array.from(
  { length: MAX_REWRITES * RULES_PER_REWRITE }, (_, index) => index + 1);

export const DEFAULT_REWRITE = {
  id: '',
  enabled: false,
  sourceHost: '',
  target: '',
  remove: '',
  add: '',
  scope: 'navigation',
};

export const DEFAULT_CONFIG = { rewrites: [] };

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;
const PARAM_NAME_PATTERN = /^[^=&\s]+$/;

function escapeForRe2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripWrapping(raw) {
  return String(raw ?? '').trim().replace(/^<|>$/g, '').trim();
}

export function newRewriteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rewrite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newRewrite(overrides = {}) {
  return { ...DEFAULT_REWRITE, id: newRewriteId(), ...overrides };
}

export function normalizeSourceHost(raw) {
  let value = stripWrapping(raw).toLowerCase();
  if (!value) throw new Error('Source host is empty.');
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0];
  if (!value) throw new Error('Source host is empty.');
  if (!HOST_PATTERN.test(value)) throw new Error(`"${value}" is not a valid host.`);
  return value;
}

export function parseTarget(raw) {
  const value = stripWrapping(raw);
  if (!value) throw new Error('Target is empty.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${value}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Target must be http or https.');
  }
  if (!url.hostname) throw new Error('Target has no host.');
  const pathPrefix = url.pathname.replace(/\/+$/, '');
  return {
    scheme: url.protocol.slice(0, -1),
    hostname: url.hostname,
    port: url.port,
    origin: url.origin,
    hostWithPort: url.port ? `${url.hostname}:${url.port}` : url.hostname,
    pathPrefix,
    base: `${url.origin}${pathPrefix}`,
  };
}

/** Accepts one name per line, or several separated by commas or spaces. */
export function parseRemoveList(raw) {
  const names = stripWrapping(raw).split(/[\s,\n]+/).filter(Boolean);
  const seen = [];
  for (const name of names) {
    if (!PARAM_NAME_PATTERN.test(name)) {
      throw new Error(`"${name}" is not a valid parameter name.`);
    }
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Accepts one `key=value` per line, or several separated by commas. */
export function parseAddList(raw) {
  const entries = stripWrapping(raw).split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
  const params = [];
  for (const entry of entries) {
    const splitAt = entry.indexOf('=');
    if (splitAt < 0) throw new Error(`"${entry}" needs a value, e.g. ${entry}=1.`);
    const key = entry.slice(0, splitAt).trim();
    const value = entry.slice(splitAt + 1).trim();
    if (!PARAM_NAME_PATTERN.test(key)) {
      throw new Error(`"${key}" is not a valid parameter name.`);
    }
    const existing = params.findIndex((param) => param.key === key);
    if (existing >= 0) params[existing] = { key, value };
    else params.push({ key, value });
  }
  return params;
}

/** A source host without a port matches that host on any port. */
function sourceHostMatches(sourceHost, hostname, port) {
  if (!sourceHost.includes(':')) return hostname === sourceHost;
  return (port ? `${hostname}:${port}` : hostname) === sourceHost;
}

export function resolveRewrite(raw) {
  const rewrite = { ...DEFAULT_REWRITE, ...(raw || {}) };
  const sourceHost = normalizeSourceHost(rewrite.sourceHost);
  const target = stripWrapping(rewrite.target) ? parseTarget(rewrite.target) : null;
  const removeParams = parseRemoveList(rewrite.remove);
  const addOrReplaceParams = parseAddList(rewrite.add);
  const hasParams = removeParams.length > 0 || addOrReplaceParams.length > 0;
  if (!target && !hasParams) {
    throw new Error('Nothing to change; set a target or a parameter to remove or set.');
  }
  // The swap rules would match their own output and redirect forever.
  if (target && sourceHostMatches(sourceHost, target.hostname, target.port)) {
    throw new Error('Target is on the source host; the redirect would loop.');
  }
  const clash = addOrReplaceParams.find((param) => removeParams.includes(param.key));
  if (clash) throw new Error(`"${clash.key}" is both removed and set; pick one.`);
  return {
    id: rewrite.id || '',
    enabled: Boolean(rewrite.enabled),
    sourceHost,
    target,
    removeParams,
    addOrReplaceParams,
    scope: rewrite.scope === 'all' ? 'all' : 'navigation',
    // The params rule matches the target, so it also edits direct visits there.
    paramsMatchTarget: Boolean(target?.pathPrefix) && hasParams,
  };
}

/**
 * Splits a saved list into the rewrites that can be installed and the ones that cannot,
 * so one broken row never blocks the others.
 */
export function resolveEnabledRewrites(rewrites) {
  const ready = [];
  const broken = [];
  for (const [index, rewrite] of (rewrites || []).entries()) {
    if (!rewrite?.enabled) continue;
    try {
      ready.push({ ...resolveRewrite(rewrite), index });
    } catch (error) {
      broken.push({ id: rewrite.id || '', index, message: error.message });
    }
  }
  return { ready, broken };
}

function hostMatcher(sourceHost) {
  const escaped = escapeForRe2(sourceHost);
  return sourceHost.includes(':') ? escaped : `${escaped}(?::\\d{1,5})?`;
}

function queryTransformFor(resolved) {
  const queryTransform = {};
  if (resolved.removeParams.length) queryTransform.removeParams = resolved.removeParams;
  if (resolved.addOrReplaceParams.length) {
    queryTransform.addOrReplaceParams = resolved.addOrReplaceParams;
  }
  return queryTransform;
}

function hasParamEdits(resolved) {
  return resolved.removeParams.length > 0 || resolved.addOrReplaceParams.length > 0;
}

/**
 * Up to three rules per row, ids `firstRuleId` onward:
 * - no target: one queryTransform rule on the source host.
 * - bare-host target: one transform rule that swaps scheme, host and port and edits
 *   the query in the same hop. An empty port clears the source port.
 * - path-prefix target: `transform` cannot add a path, so two regexSubstitution rules
 *   swap the host, then a queryTransform rule edits the redirected request on the target.
 */
function rulesFor(resolved, firstRuleId, priority) {
  const resourceTypes = resolved.scope === 'all' ? ALL_RESOURCE_TYPES : NAVIGATION_RESOURCE_TYPES;
  const source = hostMatcher(resolved.sourceHost);
  const { target } = resolved;

  if (!target) {
    return [{
      id: firstRuleId,
      priority,
      action: { type: 'redirect', redirect: { transform: { queryTransform: queryTransformFor(resolved) } } },
      condition: { regexFilter: `^https?://${source}(?:[/?#]|$)`, resourceTypes },
    }];
  }

  if (!target.pathPrefix) {
    const transform = { scheme: target.scheme, host: target.hostname, port: target.port };
    if (hasParamEdits(resolved)) transform.queryTransform = queryTransformFor(resolved);
    return [{
      id: firstRuleId,
      priority,
      action: { type: 'redirect', redirect: { transform } },
      condition: { regexFilter: `^https?://${source}(?:[/?#]|$)`, resourceTypes },
    }];
  }

  const rules = [
    {
      id: firstRuleId,
      priority,
      action: { type: 'redirect', redirect: { regexSubstitution: target.base } },
      condition: { regexFilter: `^https?://${source}$`, resourceTypes },
    },
    {
      id: firstRuleId + 1,
      priority,
      action: { type: 'redirect', redirect: { regexSubstitution: `${target.base}\\1` } },
      condition: { regexFilter: `^https?://${source}([/?#].*)$`, resourceTypes },
    },
  ];
  if (hasParamEdits(resolved)) {
    rules.push({
      id: firstRuleId + 2,
      priority,
      action: { type: 'redirect', redirect: { transform: { queryTransform: queryTransformFor(resolved) } } },
      condition: {
        regexFilter: `^https?://${escapeForRe2(target.hostWithPort)}${escapeForRe2(target.pathPrefix)}(?:[/?#]|$)`,
        resourceTypes,
      },
    });
  }
  return rules;
}

/**
 * Accepts one resolved rewrite or a list of them. Earlier entries get the higher
 * priority, so a row nearer the top wins when two rows claim the same host.
 */
export function buildRules(resolved) {
  const list = Array.isArray(resolved) ? resolved : [resolved];
  const capped = list.slice(0, MAX_REWRITES);
  const rules = [];
  for (const [index, rewrite] of capped.entries()) {
    rules.push(...rulesFor(rewrite, index * RULES_PER_REWRITE + 1, capped.length - index));
  }
  return rules;
}

/**
 * Mirrors Chrome's `queryTransform`: every listed key is dropped, then each
 * `key=value` replaces the first pair with that key (later duplicates go) or is
 * appended when the key is absent.
 */
export function applyQueryTransform(search, resolved) {
  const raw = String(search ?? '').replace(/^\?/, '');
  const pairs = raw ? raw.split('&').map((pair) => {
    const splitAt = pair.indexOf('=');
    return splitAt < 0
      ? { key: pair, value: null }
      : { key: pair.slice(0, splitAt), value: pair.slice(splitAt + 1) };
  }) : [];

  let kept = pairs.filter((pair) => !resolved.removeParams.includes(decodeParamKey(pair.key)));

  for (const param of resolved.addOrReplaceParams) {
    const first = kept.findIndex((pair) => decodeParamKey(pair.key) === param.key);
    const replacement = { key: param.key, value: param.value };
    if (first < 0) {
      kept.push(replacement);
      continue;
    }
    kept[first] = replacement;
    kept = kept.filter((pair, index) =>
      index === first || decodeParamKey(pair.key) !== param.key);
  }

  const serialized = kept
    .map((pair) => (pair.value === null ? pair.key : `${pair.key}=${pair.value}`))
    .join('&');
  return serialized ? `?${serialized}` : '';
}

function decodeParamKey(key) {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
}

/** The final URL after the swap and then the query edit, or null when the row skips it. */
export function previewRewrite(resolved, sampleUrl) {
  const sample = stripWrapping(sampleUrl);
  let url;
  try {
    url = new URL(sample);
  } catch {
    return null;
  }
  if (!sourceHostMatches(resolved.sourceHost, url.hostname, url.port)) return null;
  const base = resolved.target ? resolved.target.base : url.origin;
  const search = hasParamEdits(resolved) ? applyQueryTransform(url.search, resolved) : url.search;
  return `${base}${url.pathname}${search}${url.hash}`;
}
