export const NAVIGATION_RESOURCE_TYPES = ['main_frame', 'sub_frame'];
export const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];

export const RULES_PER_SWAP = 2;
export const MAX_SWAPS = 32;
export const ALL_RULE_IDS = Array.from(
  { length: MAX_SWAPS * RULES_PER_SWAP }, (_, index) => index + 1);

export const DEFAULT_SWAP = {
  id: '',
  enabled: false,
  sourceHost: '',
  target: '',
  scope: 'navigation',
};

export const DEFAULT_CONFIG = { swaps: [] };

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;

function escapeForRe2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripWrapping(raw) {
  return String(raw ?? '').trim().replace(/^<|>$/g, '').trim();
}

export function newSwapId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newSwap(overrides = {}) {
  return { ...DEFAULT_SWAP, id: newSwapId(), ...overrides };
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
    origin: url.origin,
    hostWithPort: url.port ? `${url.hostname}:${url.port}` : url.hostname,
    pathPrefix,
    base: `${url.origin}${pathPrefix}`,
  };
}

export function resolveSwap(raw) {
  const swap = { ...DEFAULT_SWAP, ...(raw || {}) };
  const sourceHost = normalizeSourceHost(swap.sourceHost);
  const target = parseTarget(swap.target);
  if (sourceHost === target.hostWithPort && !target.pathPrefix) {
    throw new Error('Source and target are the same host; nothing to swap.');
  }
  return {
    id: swap.id || '',
    enabled: Boolean(swap.enabled),
    sourceHost,
    target,
    scope: swap.scope === 'all' ? 'all' : 'navigation',
  };
}

// Retained name from the single-swap version; a swap resolves the same way.
export const resolveConfig = resolveSwap;

/**
 * Splits a saved list into the swaps that can be installed and the ones that cannot,
 * so one broken row never blocks the others.
 */
export function resolveEnabledSwaps(swaps) {
  const ready = [];
  const broken = [];
  for (const [index, swap] of (swaps || []).entries()) {
    if (!swap?.enabled) continue;
    try {
      ready.push({ ...resolveSwap(swap), index });
    } catch (error) {
      broken.push({ id: swap.id || '', index, message: error.message });
    }
  }
  return { ready, broken };
}

function hostMatcher(sourceHost) {
  const escaped = escapeForRe2(sourceHost);
  return sourceHost.includes(':') ? escaped : `${escaped}(?::\\d{1,5})?`;
}

function rulePairFor(resolved, firstRuleId, priority) {
  const host = hostMatcher(resolved.sourceHost);
  const resourceTypes = resolved.scope === 'all'
    ? ALL_RESOURCE_TYPES
    : NAVIGATION_RESOURCE_TYPES;
  return [
    {
      id: firstRuleId,
      priority,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: resolved.target.base || resolved.target.origin },
      },
      condition: { regexFilter: `^https?://${host}$`, resourceTypes },
    },
    {
      id: firstRuleId + 1,
      priority,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: `${resolved.target.base}\\1` },
      },
      condition: { regexFilter: `^https?://${host}([/?#].*)$`, resourceTypes },
    },
  ];
}

/**
 * Accepts one resolved swap or a list of them. Earlier entries get the higher
 * priority, so a row nearer the top wins when two rows claim the same host.
 */
export function buildRules(resolved) {
  const list = Array.isArray(resolved) ? resolved : [resolved];
  const capped = list.slice(0, MAX_SWAPS);
  const rules = [];
  for (const [index, swap] of capped.entries()) {
    rules.push(...rulePairFor(swap, index * RULES_PER_SWAP + 1, capped.length - index));
  }
  return rules;
}

export function previewSwap(resolved, sampleUrl) {
  const sample = stripWrapping(sampleUrl);
  let url;
  try {
    url = new URL(sample);
  } catch {
    return null;
  }
  const sampleHost = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const hostMatches = resolved.sourceHost.includes(':')
    ? sampleHost === resolved.sourceHost
    : url.hostname === resolved.sourceHost;
  if (!hostMatches) return null;
  return `${resolved.target.base}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Reads either shape out of storage: the current `{ swaps: [...] }` or the
 * flat single-swap settings written by version 1.
 */
export function migrateConfig(stored) {
  if (Array.isArray(stored?.swaps)) {
    return { swaps: stored.swaps.map((swap) => ({ ...DEFAULT_SWAP, id: swap.id || newSwapId(), ...swap })) };
  }
  const legacy = stored || {};
  if (legacy.sourceHost || legacy.target) {
    return {
      swaps: [newSwap({
        enabled: Boolean(legacy.enabled),
        sourceHost: legacy.sourceHost ?? '',
        target: legacy.target ?? '',
        scope: legacy.scope === 'all' ? 'all' : 'navigation',
      })],
    };
  }
  return { swaps: [newSwap()] };
}
