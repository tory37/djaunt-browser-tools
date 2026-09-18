/**
 * Rule model, validation and matching for Net Mock.
 *
 * Pure module: no extension APIs, no DOM. The popup, the background worker, the
 * MAIN-world interceptor and `test.mjs` all import this, so a rule means exactly
 * the same thing wherever it is read.
 */

import './wire.js';

const wire = globalThis.__djauntMockWire;

export const MODES = ['mock', 'fail', 'passthrough'];
export const METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const MAX_RULES = 64;
export const MAX_DELAY_MS = 600000;
export const MAX_LOG_ENTRIES = 500;

export const DEFAULT_RULE = {
  id: '',
  enabled: false,
  label: '',
  match: { url: '', method: '*' },
  respond: { mode: 'mock', status: 200, headers: {}, body: '', delayMs: 0 },
  times: 0,
};

export const DEFAULT_CONFIG = { rules: [] };

const REGEX_PREFIX = 're:';
const METHOD_PATTERN = /^[A-Za-z]+$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  408: 'Request Timeout', 409: 'Conflict', 418: "I'm a Teapot", 422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimmed(raw) {
  return String(raw ?? '').trim();
}

export function newRuleId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newRule(overrides = {}) {
  const base = structuredCloneish(DEFAULT_RULE);
  const expanded = expandShorthand(overrides);
  return mergeRule(base, { ...expanded, id: expanded.id || newRuleId() });
}

/** `structuredClone` is not in every context this module loads into. */
function structuredCloneish(value) {
  return JSON.parse(JSON.stringify(value));
}

const SHORTHAND_MATCH_KEYS = ['url', 'method'];
const SHORTHAND_RESPOND_KEYS = ['mode', 'status', 'headers', 'body', 'json', 'delayMs'];

/**
 * Accepts the flat shape an agent is likely to type and returns the canonical
 * nested one. `{ url, method, status, json }` becomes
 * `{ match: { url, method }, respond: { status, body } }`. Already-canonical input
 * passes through untouched, so this is safe to run on anything.
 */
export function expandShorthand(input) {
  const raw = input && typeof input === 'object' ? { ...input } : {};
  const match = { ...(raw.match || {}) };
  const respond = { ...(raw.respond || {}) };

  for (const key of SHORTHAND_MATCH_KEYS) {
    if (key in raw) match[key] = raw[key];
    delete raw[key];
  }
  for (const key of SHORTHAND_RESPOND_KEYS) {
    if (key in raw) respond[key] = raw[key];
    delete raw[key];
  }

  // `json` is a convenience on either level: it serialises the body for you.
  if ('json' in respond) {
    respond.body = JSON.stringify(respond.json);
    delete respond.json;
    const headers = parseHeaders(respond.headers ?? {});
    if (!headers['content-type']) headers['content-type'] = 'application/json';
    respond.headers = headers;
  }

  const expanded = { ...raw };
  delete expanded.json;
  if (Object.keys(match).length) expanded.match = match;
  if (Object.keys(respond).length) expanded.respond = respond;
  return expanded;
}

/** Shallow-merges the nested `match`/`respond` groups so partial input is legal. */
function mergeRule(base, raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    ...base,
    ...source,
    match: { ...base.match, ...(source.match || {}) },
    respond: { ...base.respond, ...(source.respond || {}) },
  };
}

/** Accepts `Name: value` per line, or a plain object passed straight through. */
export function parseHeaders(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const fromObject = {};
    for (const [name, value] of Object.entries(raw)) {
      const key = trimmed(name);
      if (!HEADER_NAME_PATTERN.test(key)) throw new Error(`"${key}" is not a valid header name.`);
      fromObject[key.toLowerCase()] = String(value ?? '');
    }
    return fromObject;
  }
  const headers = {};
  for (const line of trimmed(raw).split('\n')) {
    const entry = line.trim();
    if (!entry) continue;
    const splitAt = entry.indexOf(':');
    if (splitAt < 0) throw new Error(`"${entry}" needs a colon, e.g. ${entry}: value.`);
    const name = entry.slice(0, splitAt).trim();
    const value = entry.slice(splitAt + 1).trim();
    if (!HEADER_NAME_PATTERN.test(name)) throw new Error(`"${name}" is not a valid header name.`);
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

/** A string is already in edit form — the popup keeps headers as text while typing. */
export function formatHeaders(headers) {
  if (typeof headers === 'string') return headers;
  return Object.entries(headers || {}).map(([name, value]) => `${name}: ${value}`).join('\n');
}

/**
 * Turns a URL pattern into an anchored matcher. A pattern is a glob where `*`
 * stands for any run of characters including `/`, unless it opens with `re:` —
 * then the rest is a regular expression, also anchored.
 */
export function compileUrlPattern(raw) {
  const pattern = trimmed(raw);
  if (!pattern) throw new Error('URL pattern is empty.');
  if (pattern.startsWith(REGEX_PREFIX)) {
    const source = pattern.slice(REGEX_PREFIX.length).trim();
    if (!source) throw new Error('Regex pattern is empty.');
    try {
      return new RegExp(`^(?:${source})$`, 'i');
    } catch (error) {
      throw new Error(`"${source}" is not a valid regex: ${error.message}`);
    }
  }
  const source = pattern.split('*').map(escapeForRegex).join('.*');
  return new RegExp(`^${source}$`, 'i');
}

function resolveInteger(value, { name, min, max, fallback }) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

/** Validates and normalises one stored rule, throwing a message fit to show a human. */
export function resolveRule(raw) {
  const rule = mergeRule(DEFAULT_RULE, expandShorthand(raw));

  const method = trimmed(rule.match.method) || '*';
  if (method !== '*' && !METHOD_PATTERN.test(method)) {
    throw new Error(`"${method}" is not a valid HTTP method.`);
  }

  const mode = trimmed(rule.respond.mode) || 'mock';
  if (!MODES.includes(mode)) {
    throw new Error(`"${mode}" is not a mode; use ${MODES.join(', ')}.`);
  }

  const resolved = {
    id: rule.id || '',
    enabled: Boolean(rule.enabled),
    label: trimmed(rule.label),
    match: {
      url: trimmed(rule.match.url),
      method: method === '*' ? '*' : method.toUpperCase(),
    },
    respond: {
      mode,
      status: resolveInteger(rule.respond.status, {
        name: 'Status', min: 200, max: 599, fallback: 200,
      }),
      headers: parseHeaders(rule.respond.headers),
      body: rule.respond.body == null ? '' : String(rule.respond.body),
      delayMs: resolveInteger(rule.respond.delayMs, {
        name: 'Delay', min: 0, max: MAX_DELAY_MS, fallback: 0,
      }),
    },
    times: resolveInteger(rule.times, {
      name: 'Times', min: 0, max: 1000000, fallback: 0,
    }),
    matcher: compileUrlPattern(rule.match.url),
  };

  if (mode === 'mock' && !resolved.respond.headers['content-type'] && looksLikeJson(resolved.respond.body)) {
    resolved.respond.headers['content-type'] = 'application/json';
  }
  return resolved;
}

function looksLikeJson(body) {
  const value = body.trim();
  if (!value.startsWith('{') && !value.startsWith('[')) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Splits a saved list into the rules that can be installed and the ones that
 * cannot, so one broken row never stops the others from working.
 */
export function resolveEnabledRules(rules) {
  const ready = [];
  const broken = [];
  for (const [index, rule] of (rules || []).entries()) {
    if (!rule?.enabled) continue;
    try {
      ready.push({ ...resolveRule(rule), index });
    } catch (error) {
      broken.push({ id: rule.id || '', index, message: error.message });
    }
  }
  return { ready: ready.slice(0, MAX_RULES), broken };
}

/** Shared with the MAIN-world interceptor; see `wire.js`. */
export function absoluteUrl(raw, base) {
  return wire.absoluteUrl(raw, base);
}

/**
 * First enabled match wins — list order is priority, the same way the other
 * extensions here treat their rows. `counts` maps a rule id to how many times it
 * has already fired, so a rule with a `times` budget stops matching once spent.
 */
export function matchRule(resolvedRules, request, counts) {
  const method = trimmed(request?.method).toUpperCase() || 'GET';
  const url = trimmed(request?.url);
  for (const rule of resolvedRules || []) {
    if (rule.match.method !== '*' && rule.match.method !== method) continue;
    if (!rule.matcher.test(url)) continue;
    if (rule.times > 0 && (counts?.get?.(rule.id) ?? 0) >= rule.times) continue;
    return rule;
  }
  return null;
}

export function statusTextFor(status) {
  return STATUS_TEXT[status] || '';
}

/**
 * Describes the response to hand back, as plain data — the interceptor turns this
 * into a real `Response` or an XHR readyState progression, and the tests read it
 * directly.
 */
export function buildMockResponse(resolved, url) {
  return {
    url,
    status: resolved.respond.status,
    statusText: statusTextFor(resolved.respond.status),
    headers: { ...resolved.respond.headers },
    body: resolved.respond.body,
    delayMs: resolved.respond.delayMs,
  };
}

/** Fills in ids and defaults for anything read out of storage. */
export function migrateConfig(stored) {
  if (!Array.isArray(stored?.rules)) return { rules: [] };
  return {
    rules: stored.rules.map((rule) => mergeRule(DEFAULT_RULE, {
      ...rule, id: rule?.id || newRuleId(),
    })),
  };
}

/**
 * Reads an exported ruleset back in. Accepts the `{ rules: [...] }` envelope or a
 * bare array, and rejects the whole import if any rule is invalid — a half-applied
 * ruleset is worse than a failed one.
 */
export function parseRuleset(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Not valid JSON: ${error.message}`);
    }
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(list)) throw new Error('Expected an array of rules, or { "rules": [...] }.');
  if (list.length > MAX_RULES) throw new Error(`Too many rules; the limit is ${MAX_RULES}.`);
  return list.map((rule, index) => {
    try {
      resolveRule(rule);
    } catch (error) {
      throw new Error(`Rule ${index + 1}: ${error.message}`);
    }
    const expanded = expandShorthand(rule);
    return mergeRule(DEFAULT_RULE, { ...expanded, id: expanded.id || newRuleId() });
  });
}

/**
 * Exports the canonical shape, with headers as an object rather than the text the
 * popup edits — an agent reading this file should see the same shape it would send.
 */
export function serializeRuleset(rules) {
  const canonical = migrateConfig({ rules }).rules.map((rule) => {
    let headers = rule.respond.headers;
    try {
      headers = parseHeaders(headers);
    } catch {
      // Leave an unparseable draft alone; the import will report it.
    }
    return { ...rule, respond: { ...rule.respond, headers } };
  });
  return JSON.stringify({ rules: canonical }, null, 2);
}

/**
 * Flattens a resolved rule for transport to the MAIN world, which must not re-run
 * validation. The matcher becomes a regex source string because a `RegExp` does not
 * survive the JSON hop across the bridge.
 */
export function toWireRule(resolved) {
  return {
    id: resolved.id,
    label: resolved.label,
    method: resolved.match.method,
    pattern: resolved.matcher.source,
    mode: resolved.respond.mode,
    status: resolved.respond.status,
    statusText: statusTextFor(resolved.respond.status),
    headers: { ...resolved.respond.headers },
    body: resolved.respond.body,
    delayMs: resolved.respond.delayMs,
    times: resolved.times,
  };
}

/** The snapshot the interceptor runs against. */
export function buildWireRules(rules) {
  return resolveEnabledRules(rules).ready.map(toWireRule);
}
