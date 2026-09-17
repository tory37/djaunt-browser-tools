export const NAVIGATION_RESOURCE_TYPES = ['main_frame', 'sub_frame'];
export const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];

export const RULES_PER_TWEAK = 1;
export const MAX_TWEAKS = 32;
export const ALL_RULE_IDS = Array.from(
  { length: MAX_TWEAKS * RULES_PER_TWEAK }, (_, index) => index + 1);

export const DEFAULT_TWEAK = {
  id: '',
  enabled: false,
  host: '',
  remove: '',
  add: '',
  scope: 'navigation',
};

export const DEFAULT_CONFIG = { tweaks: [] };

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;
const PARAM_NAME_PATTERN = /^[^=&\s]+$/;

function escapeForRe2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripWrapping(raw) {
  return String(raw ?? '').trim().replace(/^<|>$/g, '').trim();
}

export function newTweakId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tweak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newTweak(overrides = {}) {
  return { ...DEFAULT_TWEAK, id: newTweakId(), ...overrides };
}

export function normalizeHost(raw) {
  let value = stripWrapping(raw).toLowerCase();
  if (!value) throw new Error('Domain is empty.');
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0];
  if (!value) throw new Error('Domain is empty.');
  if (!HOST_PATTERN.test(value)) throw new Error(`"${value}" is not a valid domain.`);
  return value;
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

export function resolveTweak(raw) {
  const tweak = { ...DEFAULT_TWEAK, ...(raw || {}) };
  const host = normalizeHost(tweak.host);
  const removeParams = parseRemoveList(tweak.remove);
  const addOrReplaceParams = parseAddList(tweak.add);
  if (!removeParams.length && !addOrReplaceParams.length) {
    throw new Error('Nothing to change; add a parameter to remove or set.');
  }
  const clash = addOrReplaceParams.find((param) => removeParams.includes(param.key));
  if (clash) throw new Error(`"${clash.key}" is both removed and set; pick one.`);
  return {
    id: tweak.id || '',
    enabled: Boolean(tweak.enabled),
    host,
    removeParams,
    addOrReplaceParams,
    scope: tweak.scope === 'all' ? 'all' : 'navigation',
  };
}

/**
 * Splits a saved list into the tweaks that can be installed and the ones that cannot,
 * so one broken row never blocks the others.
 */
export function resolveEnabledTweaks(tweaks) {
  const ready = [];
  const broken = [];
  for (const [index, tweak] of (tweaks || []).entries()) {
    if (!tweak?.enabled) continue;
    try {
      ready.push({ ...resolveTweak(tweak), index });
    } catch (error) {
      broken.push({ id: tweak.id || '', index, message: error.message });
    }
  }
  return { ready, broken };
}

function hostMatcher(host) {
  const escaped = escapeForRe2(host);
  return host.includes(':') ? escaped : `${escaped}(?::\\d{1,5})?`;
}

function ruleFor(resolved, ruleId, priority) {
  const queryTransform = {};
  if (resolved.removeParams.length) queryTransform.removeParams = resolved.removeParams;
  if (resolved.addOrReplaceParams.length) {
    queryTransform.addOrReplaceParams = resolved.addOrReplaceParams;
  }
  return {
    id: ruleId,
    priority,
    action: { type: 'redirect', redirect: { transform: { queryTransform } } },
    condition: {
      regexFilter: `^https?://${hostMatcher(resolved.host)}(?:[/?#]|$)`,
      resourceTypes: resolved.scope === 'all' ? ALL_RESOURCE_TYPES : NAVIGATION_RESOURCE_TYPES,
    },
  };
}

/**
 * Accepts one resolved tweak or a list of them. Earlier entries get the higher
 * priority, so a row nearer the top wins when two rows claim the same domain.
 */
export function buildRules(resolved) {
  const list = Array.isArray(resolved) ? resolved : [resolved];
  const capped = list.slice(0, MAX_TWEAKS);
  return capped.map((tweak, index) =>
    ruleFor(tweak, index * RULES_PER_TWEAK + 1, capped.length - index));
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

export function previewTweak(resolved, sampleUrl) {
  const sample = stripWrapping(sampleUrl);
  let url;
  try {
    url = new URL(sample);
  } catch {
    return null;
  }
  const sampleHost = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const hostMatches = resolved.host.includes(':')
    ? sampleHost === resolved.host
    : url.hostname === resolved.host;
  if (!hostMatches) return null;
  const search = applyQueryTransform(url.search, resolved);
  return `${url.origin}${url.pathname}${search}${url.hash}`;
}

/** Fills in ids and defaults for anything read out of storage. */
export function migrateConfig(stored) {
  if (Array.isArray(stored?.tweaks)) {
    return {
      tweaks: stored.tweaks.map((tweak) => ({
        ...DEFAULT_TWEAK, id: tweak.id || newTweakId(), ...tweak,
      })),
    };
  }
  return { tweaks: [newTweak()] };
}
