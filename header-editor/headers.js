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
  set: '',
  scope: 'all',
};

export const DEFAULT_CONFIG = { tweaks: [] };

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;
// RFC 7230 token characters, which is what a header name is allowed to use.
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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

/** Accepts one header name per line, or several separated by commas. */
export function parseRemoveList(raw) {
  const names = stripWrapping(raw).split(/[,\n]+/).map((line) => line.trim()).filter(Boolean);
  const seen = [];
  for (const name of names) {
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new Error(`"${name}" is not a valid header name.`);
    }
    if (!seen.some((existing) => existing.toLowerCase() === name.toLowerCase())) seen.push(name);
  }
  return seen;
}

/** Accepts one `Name: value` per line, or several separated by commas. */
export function parseSetList(raw) {
  const entries = stripWrapping(raw).split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
  const headers = [];
  for (const entry of entries) {
    const splitAt = entry.indexOf(':');
    if (splitAt < 0) throw new Error(`"${entry}" needs a value, e.g. ${entry}: 1.`);
    const name = entry.slice(0, splitAt).trim();
    const value = entry.slice(splitAt + 1).trim();
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new Error(`"${name}" is not a valid header name.`);
    }
    const existing = headers.findIndex((header) => header.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) headers[existing] = { name, value };
    else headers.push({ name, value });
  }
  return headers;
}

export function resolveTweak(raw) {
  const tweak = { ...DEFAULT_TWEAK, ...(raw || {}) };
  const host = normalizeHost(tweak.host);
  const removeHeaders = parseRemoveList(tweak.remove);
  const setHeaders = parseSetList(tweak.set);
  if (!removeHeaders.length && !setHeaders.length) {
    throw new Error('Nothing to change; add a header to remove or set.');
  }
  const clash = setHeaders.find((header) =>
    removeHeaders.some((name) => name.toLowerCase() === header.name.toLowerCase()));
  if (clash) throw new Error(`"${clash.name}" is both removed and set; pick one.`);
  return {
    id: tweak.id || '',
    enabled: Boolean(tweak.enabled),
    host,
    removeHeaders,
    setHeaders,
    scope: tweak.scope === 'navigation' ? 'navigation' : 'all',
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

function escapeForRe2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hostMatcher(host) {
  const escaped = escapeForRe2(host);
  return host.includes(':') ? escaped : `${escaped}(?::\\d{1,5})?`;
}

function ruleFor(resolved, ruleId, priority) {
  const requestHeaders = [
    ...resolved.setHeaders.map((header) => ({ header: header.name, operation: 'set', value: header.value })),
    ...resolved.removeHeaders.map((name) => ({ header: name, operation: 'remove' })),
  ];
  return {
    id: ruleId,
    priority,
    action: { type: 'modifyHeaders', requestHeaders },
    condition: {
      regexFilter: `^https?://${hostMatcher(resolved.host)}(?:[/?#]|$)`,
      resourceTypes: resolved.scope === 'navigation' ? NAVIGATION_RESOURCE_TYPES : ALL_RESOURCE_TYPES,
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

/** Applies a resolved tweak's header changes to a plain header map, for the preview panel. */
export function applyHeaderTransform(headers, resolved) {
  const result = new Map(Object.entries(headers ?? {}));
  for (const name of resolved.removeHeaders) {
    for (const key of [...result.keys()]) {
      if (key.toLowerCase() === name.toLowerCase()) result.delete(key);
    }
  }
  for (const header of resolved.setHeaders) {
    for (const key of [...result.keys()]) {
      if (key.toLowerCase() === header.name.toLowerCase()) result.delete(key);
    }
    result.set(header.name, header.value);
  }
  return Object.fromEntries(result);
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
