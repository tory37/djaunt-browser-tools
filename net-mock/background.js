import {
  MAX_LOG_ENTRIES, MAX_RULES, buildWireRules, migrateConfig, newRule, parseRuleset,
  resolveEnabledRules, resolveRule, serializeRuleset,
} from './rules.js';

const api = globalThis.browser ?? globalThis.chrome;

const STORAGE_KEY = 'rules';
const LOG_KEY = 'log';

const BADGE_ACTIVE = '#A8E01F'; // --dj-accent, venom
const BADGE_ERROR = '#E0492E'; // --dj-danger
const BADGE_ON_ACCENT = '#080F04'; // --dj-on-accent, venom

/**
 * The match log is worth keeping only for the life of the browser session, and
 * `storage.session` survives a service worker restart where a module-level array
 * would not. Older builds without it fall back to memory.
 */
const sessionArea = api.storage.session ?? null;
let memoryLog = [];

async function readLog() {
  if (!sessionArea) return memoryLog;
  const stored = await sessionArea.get(LOG_KEY);
  return Array.isArray(stored?.[LOG_KEY]) ? stored[LOG_KEY] : [];
}

async function writeLog(entries) {
  const capped = entries.slice(-MAX_LOG_ENTRIES);
  if (!sessionArea) {
    memoryLog = capped;
    return;
  }
  await sessionArea.set({ [LOG_KEY]: capped });
}

async function readRules() {
  const stored = await api.storage.local.get(STORAGE_KEY);
  return migrateConfig({ rules: stored?.[STORAGE_KEY] }).rules;
}

async function writeRules(rules) {
  if (rules.length > MAX_RULES) throw new Error(`Too many rules; the limit is ${MAX_RULES}.`);
  await api.storage.local.set({ [STORAGE_KEY]: rules });
  return rules;
}

function ruleIndex(rules, id) {
  const index = rules.findIndex((rule) => rule.id === id);
  if (index < 0) throw new Error(`No rule with id "${id}".`);
  return index;
}

async function setBadge(rules) {
  const { ready, broken } = resolveEnabledRules(rules);
  const text = ready.length ? String(ready.length) : (broken.length ? 'ERR' : '');
  try {
    await api.action.setBadgeText({ text });
    if (!text) return;
    await api.action.setBadgeBackgroundColor({
      color: ready.length ? BADGE_ACTIVE : BADGE_ERROR,
    });
    await api.action.setBadgeTextColor?.({ color: BADGE_ON_ACCENT });
  } catch {
    // No action surface yet; the next storage change will retry.
  }
}

/**
 * Every operation the popup and the page-facing API can ask for. Each one reads
 * storage fresh, so two surfaces editing at once cannot write a stale list.
 */
const operations = {
  async getRules() {
    return buildWireRules(await readRules());
  },

  async list() {
    return readRules();
  },

  async state() {
    const rules = await readRules();
    const { ready, broken } = resolveEnabledRules(rules);
    return { rules, broken, activeCount: ready.length };
  },

  async add(payload) {
    const candidate = newRule(payload?.rule || payload || {});
    resolveRule(candidate);
    const rules = await readRules();
    await writeRules([...rules, candidate]);
    return candidate;
  },

  async update(payload) {
    const rules = await readRules();
    const index = ruleIndex(rules, payload?.id);
    const merged = {
      ...rules[index],
      ...(payload?.patch || {}),
      id: rules[index].id,
      match: { ...rules[index].match, ...(payload?.patch?.match || {}) },
      respond: { ...rules[index].respond, ...(payload?.patch?.respond || {}) },
    };
    resolveRule(merged);
    rules[index] = merged;
    await writeRules(rules);
    return merged;
  },

  async enable(payload) {
    return operations.update({ id: payload?.id, patch: { enabled: Boolean(payload?.enabled) } });
  },

  async remove(payload) {
    const rules = await readRules();
    const index = ruleIndex(rules, payload?.id);
    const [removed] = rules.splice(index, 1);
    await writeRules(rules);
    return removed;
  },

  async set(payload) {
    const rules = parseRuleset(payload?.rules ?? payload ?? []);
    await writeRules(rules);
    return rules;
  },

  async clear() {
    await writeRules([]);
    return [];
  },

  async import(payload) {
    const incoming = parseRuleset(payload?.json ?? payload);
    const existing = payload?.replace === false ? await readRules() : [];
    const merged = [...existing, ...incoming];
    await writeRules(merged);
    return merged;
  },

  async export() {
    return serializeRuleset(await readRules());
  },

  async log(payload) {
    const entries = await readLog();
    const limit = Number(payload?.limit);
    return Number.isInteger(limit) && limit > 0 ? entries.slice(-limit) : entries;
  },

  async clearLog() {
    await writeLog([]);
    return [];
  },

  /** Fire-and-forget from the interceptor; never blocks a request. */
  async record(payload) {
    const incoming = Array.isArray(payload?.entries) ? payload.entries : [];
    if (!incoming.length) return null;
    await writeLog([...(await readLog()), ...incoming]);
    return null;
  },
};

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.channel !== 'net-mock') return false;
  const operation = operations[message.op];
  if (!operation) {
    sendResponse({ ok: false, error: `Unknown operation "${message.op}".` });
    return false;
  }
  operation(message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true; // keeps the channel open for the async reply
});

async function refreshBadge() {
  await setBadge(await readRules());
}

api.runtime.onInstalled.addListener(refreshBadge);
api.runtime.onStartup.addListener(refreshBadge);
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) refreshBadge();
});

refreshBadge();
