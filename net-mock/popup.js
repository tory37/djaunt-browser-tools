import {
  MAX_RULES, formatHeaders, migrateConfig, newRule, parseRuleset, resolveEnabledRules,
  resolveRule, serializeRuleset,
} from './rules.js';

const api = globalThis.browser ?? globalThis.chrome;

const SAVE_DEBOUNCE_MS = 250;
const STORAGE_KEY = 'rules';
const EXPORT_FILENAME = 'net-mock-rules.json';

const MODE_HINTS = {
  mock: 'Answers the request with the response below. The network is never touched.',
  fail: 'Rejects the request the way a dropped connection does.',
  passthrough: 'Lets the request through untouched. Useful above a broader rule.',
};

const els = {
  head: document.getElementById('head'),
  pill: document.getElementById('pill'),
  list: document.getElementById('list'),
  empty: document.getElementById('empty'),
  add: document.getElementById('add'),
  importButton: document.getElementById('import'),
  importFile: document.getElementById('importFile'),
  exportButton: document.getElementById('export'),
  log: document.getElementById('log'),
  logToggle: document.getElementById('logToggle'),
  logCount: document.getElementById('logCount'),
  logList: document.getElementById('logList'),
  logEmpty: document.getElementById('logEmpty'),
  clearLog: document.getElementById('clearLog'),
  status: document.getElementById('status'),
  rowTemplate: document.getElementById('rowTemplate'),
};

let rules = [];
let saveTimer = null;

function ask(op, payload) {
  return Promise.resolve(api.runtime.sendMessage({ channel: 'net-mock', op, payload }))
    .catch(() => ({ ok: false, error: 'The extension background is not responding.' }));
}

function say(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

// ---- rule rows ----

function describeTarget(rule) {
  return rule.label.trim() || rule.match.url.trim() || 'no pattern';
}

function describeEffect(rule) {
  const method = rule.match.method.trim() || '*';
  const scope = method === '*' ? 'any' : method.toUpperCase();
  if (rule.respond.mode === 'fail') return `${scope} · fail`;
  if (rule.respond.mode === 'passthrough') return `${scope} · pass through`;
  return `${scope} · ${rule.respond.status || 200}`;
}

function paintRow(row, rule) {
  row.querySelector('.dj-row-line-from').textContent = describeTarget(rule);
  row.querySelector('.dj-row-line-to').textContent = describeEffect(rule);
  row.querySelector('.dj-switch').setAttribute('aria-checked', String(Boolean(rule.enabled)));

  row.dataset.mode = rule.respond.mode;
  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.setAttribute('aria-checked', String(seg.dataset.mode === rule.respond.mode));
  }
  row.querySelector('.mode-hint').textContent = MODE_HINTS[rule.respond.mode] ?? '';

  let problem = null;
  try {
    resolveRule(rule);
  } catch (error) {
    problem = error.message;
  }

  // A brand new row has no pattern yet; that is not a mistake worth shouting about.
  const incomplete = !rule.match.url.trim();
  const showProblem = Boolean(problem) && !incomplete;
  row.querySelector('.url').classList.toggle('invalid', showProblem);

  const rowError = row.querySelector('.dj-row-error');
  rowError.textContent = showProblem ? problem : '';
  rowError.hidden = !showProblem;

  row.dataset.state = rule.enabled && !problem ? 'active' : (rule.enabled && problem ? 'error' : 'idle');
}

function paintGlobal() {
  const { ready, broken } = resolveEnabledRules(rules);
  const state = ready.length ? 'active' : (broken.length ? 'error' : 'idle');
  els.head.dataset.state = state;
  els.pill.dataset.state = state;
  els.pill.textContent = ready.length ? `${ready.length} on` : (broken.length ? 'err' : 'off');

  els.empty.hidden = rules.length > 0;
  els.add.disabled = rules.length >= MAX_RULES;

  let message = ready.length
    ? `${ready.length} rule(s) live. Reload the tab to catch requests it already made.`
    : 'No rule is live. Every request goes to the network.';
  if (broken.length) message += ` ${broken.length} enabled rule(s) skipped — see the row error.`;
  say(message, broken.length > 0 && ready.length === 0);
}

function save({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const commit = () => api.storage.local.set({ [STORAGE_KEY]: rules });
  paintGlobal();
  if (immediate) return commit();
  saveTimer = setTimeout(commit, SAVE_DEBOUNCE_MS);
  return Promise.resolve();
}

function setOpen(row, open) {
  row.dataset.open = String(open);
  row.querySelector('.dj-row-disclose').setAttribute('aria-expanded', String(open));
}

function createRow(rule) {
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = rule.id;

  // Each entry maps an input to where its value lives on the rule.
  const fields = [
    [row.querySelector('.url'), (value) => { rule.match.url = value; }, () => rule.match.url],
    [row.querySelector('.method'), (value) => { rule.match.method = value; }, () => rule.match.method],
    [row.querySelector('.status'), (value) => { rule.respond.status = value; }, () => rule.respond.status],
    [row.querySelector('.delay'), (value) => { rule.respond.delayMs = value; }, () => rule.respond.delayMs],
    [row.querySelector('.times'), (value) => { rule.times = value; }, () => rule.times],
    [row.querySelector('.headers'), (value) => { rule.respond.headers = value; },
      () => formatHeaders(rule.respond.headers)],
    [row.querySelector('.body'), (value) => { rule.respond.body = value; }, () => rule.respond.body],
    [row.querySelector('.label'), (value) => { rule.label = value; }, () => rule.label],
  ];
  for (const [input, , read] of fields) input.value = read() ?? '';

  const touch = (immediate) => {
    paintRow(row, rule);
    save({ immediate });
  };

  row.querySelector('.dj-row-disclose').addEventListener('click', () => {
    setOpen(row, row.dataset.open !== 'true');
  });

  row.querySelector('.dj-switch').addEventListener('click', () => {
    rule.enabled = !rule.enabled;
    touch(true);
  });

  row.querySelector('.dj-row-remove').addEventListener('click', () => {
    rules = rules.filter((entry) => entry.id !== rule.id);
    row.remove();
    save({ immediate: true });
  });

  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.addEventListener('click', () => {
      rule.respond.mode = seg.dataset.mode;
      touch(true);
    });
  }

  for (const [input, write] of fields) {
    input.addEventListener('input', () => {
      write(input.value);
      touch(false);
    });
    input.addEventListener('change', () => {
      write(input.value);
      touch(true);
    });
  }

  paintRow(row, rule);
  return row;
}

function renderAll() {
  els.list.replaceChildren(...rules.map(createRow));
}

// ---- match log ----

function timeOf(entry) {
  return new Date(entry.time).toLocaleTimeString([], { hour12: false });
}

function shortUrl(raw) {
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

function logRow(entry) {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.dataset.action = entry.action;
  row.title = `${entry.action}${entry.label ? ` · ${entry.label}` : ''}\n${entry.url}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = timeOf(entry);

  const method = document.createElement('span');
  method.className = 'log-method';
  method.textContent = entry.method;

  const url = document.createElement('span');
  url.className = 'log-url';
  url.textContent = shortUrl(entry.url);

  row.append(time, method, url);
  return row;
}

async function refreshLog() {
  const reply = await ask('log', { limit: 60 });
  const entries = reply?.ok ? reply.result : [];
  const newestFirst = [...entries].reverse();
  els.logList.replaceChildren(...newestFirst.map(logRow));
  els.logEmpty.hidden = newestFirst.length > 0;
  els.logCount.textContent = newestFirst.length ? String(newestFirst.length) : '';
}

els.logToggle.addEventListener('click', () => {
  const open = els.log.dataset.open !== 'true';
  els.log.dataset.open = String(open);
  document.body.dataset.logOpen = String(open);
  els.logToggle.setAttribute('aria-expanded', String(open));
  if (open) refreshLog();
});

els.clearLog.addEventListener('click', async () => {
  await ask('clearLog');
  await refreshLog();
});

// ---- add, import, export ----

els.add.addEventListener('click', () => {
  const rule = newRule();
  rules.push(rule);
  const row = createRow(rule);
  els.list.append(row);
  setOpen(row, true);
  row.querySelector('.url').focus();
  save({ immediate: true });
});

els.exportButton.addEventListener('click', () => {
  const blob = new Blob([serializeRuleset(rules)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(href);
  say(`Exported ${rules.length} rule(s) to ${EXPORT_FILENAME}.`);
});

els.importButton.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    rules = parseRuleset(await file.text());
    await save({ immediate: true });
    renderAll();
    say(`Imported ${rules.length} rule(s), replacing what was here.`);
  } catch (error) {
    say(`Import failed. ${error.message}`, true);
  }
});

// ---- boot ----

(async () => {
  const stored = await api.storage.local.get(STORAGE_KEY);
  rules = migrateConfig({ rules: stored?.[STORAGE_KEY] }).rules;
  // Persist the migrated shape immediately so nothing depends on a later edit.
  await api.storage.local.set({ [STORAGE_KEY]: rules });
  renderAll();
  // A single rule has nothing to compare against, so open it straight away.
  if (els.list.firstElementChild && rules.length === 1) setOpen(els.list.firstElementChild, true);
  paintGlobal();
})();
