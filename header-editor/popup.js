import { applyTweaks } from './apply.js';
import {
  MAX_TWEAKS, RULES_PER_TWEAK, migrateConfig, newTweak, parseRemoveList, parseSetList,
  resolveTweak,
} from './headers.js';

const api = globalThis.browser ?? globalThis.chrome;

const SAVE_DEBOUNCE_MS = 250;

const els = {
  head: document.getElementById('head'),
  pill: document.getElementById('pill'),
  list: document.getElementById('list'),
  empty: document.getElementById('empty'),
  add: document.getElementById('add'),
  status: document.getElementById('status'),
  rowTemplate: document.getElementById('rowTemplate'),
};

let tweaks = [];
let saveTimer = null;

function bareHost(raw) {
  return String(raw ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
}

function countSafely(parse, raw) {
  try {
    return parse(raw).length;
  } catch {
    return 0;
  }
}

function summarizeChanges(tweak) {
  const removed = countSafely(parseRemoveList, tweak.remove);
  const set = countSafely(parseSetList, tweak.set);
  const parts = [];
  if (removed) parts.push(`−${removed}`);
  if (set) parts.push(`+${set}`);
  return parts.length ? `${parts.join(' ')} header(s)` : 'no changes';
}

function paintPreview(row, resolved) {
  const list = row.querySelector('.preview-list');
  list.replaceChildren();
  if (!resolved) return;
  for (const header of resolved.setHeaders) {
    const item = document.createElement('li');
    item.className = 'preview-set';
    item.innerHTML = `<code>${header.name}: ${header.value}</code>`;
    list.append(item);
  }
  for (const name of resolved.removeHeaders) {
    const item = document.createElement('li');
    item.className = 'preview-remove';
    item.innerHTML = `<code>${name}</code>`;
    list.append(item);
  }
}

function paintRow(row, tweak) {
  row.querySelector('.tweak-host').textContent = bareHost(tweak.host) || 'no domain';
  row.querySelector('.tweak-changes').textContent = summarizeChanges(tweak);

  const toggle = row.querySelector('.dj-switch');
  toggle.setAttribute('aria-checked', String(Boolean(tweak.enabled)));

  const isNav = tweak.scope === 'navigation';
  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.setAttribute('aria-checked', String((seg.dataset.scope === 'navigation') === isNav));
  }
  row.querySelector('.scope-hint').textContent = isNav
    ? 'Page and iframe loads only. Leaves API calls alone.'
    : 'Every request type, including scripts, images and API calls.';

  let resolved = null;
  let problem = null;
  try {
    resolved = resolveTweak(tweak);
  } catch (error) {
    problem = error.message;
  }

  const incomplete = !tweak.host.trim() || (!tweak.remove.trim() && !tweak.set.trim());
  const showProblem = Boolean(problem) && !incomplete;
  row.querySelector('.host').classList.toggle('invalid', showProblem);

  const rowError = row.querySelector('.row-error');
  rowError.textContent = showProblem ? problem : '';
  rowError.hidden = !showProblem;

  paintPreview(row, resolved);

  row.dataset.state = resolved && tweak.enabled ? 'active' : (problem && tweak.enabled ? 'error' : 'idle');
}

/**
 * Installs the rules from here rather than waiting on the service worker, so the popup
 * always shows and enforces the same state.
 */
async function paintGlobal() {
  const { ready, broken } = await applyTweaks(tweaks);
  const state = ready.length ? 'active' : (broken.length ? 'error' : 'idle');
  els.head.dataset.state = state;
  els.pill.dataset.state = state;
  els.pill.textContent = ready.length ? `${ready.length} on` : (broken.length ? 'err' : 'off');

  els.empty.hidden = tweaks.length > 0;
  els.add.disabled = tweaks.length >= MAX_TWEAKS;

  const installed = await api.declarativeNetRequest.getDynamicRules();
  const expected = ready.length * RULES_PER_TWEAK;
  const stale = installed.length !== expected;
  els.status.classList.toggle('error', stale || (broken.length > 0 && ready.length === 0));

  let message = installed.length
    ? `${installed.length} header rule(s) live. Reload the tab to pick it up.`
    : 'No header rule installed. No request header is being changed.';
  if (stale) message = `Expected ${expected} rule(s) but ${installed.length} are installed. Reload the extension at chrome://extensions.`;
  if (broken.length) message += ` ${broken.length} enabled tweak(s) skipped — see the row error.`;
  els.status.textContent = message;
}

function save({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const commit = async () => {
    await api.storage.local.set({ tweaks });
    await paintGlobal();
  };
  if (immediate) return commit();
  saveTimer = setTimeout(commit, SAVE_DEBOUNCE_MS);
  return paintGlobal();
}

function setOpen(row, open) {
  row.dataset.open = String(open);
  row.querySelector('.disclose').setAttribute('aria-expanded', String(open));
}

function createRow(tweak) {
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = tweak.id;

  const fields = [
    [row.querySelector('.host'), 'host'],
    [row.querySelector('.remove-headers'), 'remove'],
    [row.querySelector('.set-headers'), 'set'],
  ];
  for (const [input, key] of fields) input.value = tweak[key] ?? '';

  const touch = (immediate) => {
    paintRow(row, tweak);
    save({ immediate });
  };

  row.querySelector('.disclose').addEventListener('click', () => {
    setOpen(row, row.dataset.open !== 'true');
  });

  row.querySelector('.dj-switch').addEventListener('click', () => {
    tweak.enabled = !tweak.enabled;
    touch(true);
  });

  row.querySelector('.remove').addEventListener('click', () => {
    tweaks = tweaks.filter((entry) => entry.id !== tweak.id);
    row.remove();
    save({ immediate: true });
  });

  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.addEventListener('click', () => {
      tweak.scope = seg.dataset.scope;
      touch(true);
    });
  }

  for (const [input, key] of fields) {
    input.addEventListener('input', () => {
      tweak[key] = input.value;
      touch(false);
    });
    input.addEventListener('change', () => {
      tweak[key] = input.value;
      touch(true);
    });
  }

  paintRow(row, tweak);
  return row;
}

function renderAll() {
  els.list.replaceChildren(...tweaks.map(createRow));
}

els.add.addEventListener('click', () => {
  const tweak = newTweak();
  tweaks.push(tweak);
  const row = createRow(tweak);
  els.list.append(row);
  setOpen(row, true);
  row.querySelector('.host').focus();
  save({ immediate: true });
});

(async () => {
  const stored = await api.storage.local.get(null);
  tweaks = migrateConfig(stored).tweaks;
  // Persist the migrated shape immediately so nothing depends on a later edit.
  await api.storage.local.set({ tweaks });
  renderAll();
  // A single tweak has nothing to compare against, so open it straight away.
  if (els.list.firstElementChild && tweaks.length === 1) setOpen(els.list.firstElementChild, true);
  await paintGlobal();
})();
