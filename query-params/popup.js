import { applyTweaks } from './apply.js';
import {
  MAX_TWEAKS, RULES_PER_TWEAK, migrateConfig, newTweak, parseAddList, parseRemoveList,
  previewTweak, resolveTweak,
} from './params.js';

const api = globalThis.browser ?? globalThis.chrome;

const SAMPLE_HOST = 'app.example.com';
const SAMPLE_QUERY = '/?token=abc123&id=42';
const SAVE_DEBOUNCE_MS = 250;

const els = {
  head: document.getElementById('head'),
  pill: document.getElementById('pill'),
  list: document.getElementById('list'),
  empty: document.getElementById('empty'),
  add: document.getElementById('add'),
  status: document.getElementById('status'),
  rowTemplate: document.getElementById('rowTemplate'),
  paramBoxTemplate: document.getElementById('paramBoxTemplate'),
  paramPairTemplate: document.getElementById('paramPairTemplate'),
};

let tweaks = [];
let saveTimer = null;

function bareHost(raw) {
  return String(raw ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
}

function sampleUrlFor(tweak) {
  return `https://${bareHost(tweak.host) || SAMPLE_HOST}${SAMPLE_QUERY}`;
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
  const added = countSafely(parseAddList, tweak.add);
  const parts = [];
  if (removed) parts.push(`−${removed}`);
  if (added) parts.push(`+${added}`);
  return parts.length ? `${parts.join(' ')} param(s)` : 'no changes';
}

function paintRow(row, tweak) {
  row.querySelector('.dj-row-line-from').textContent = bareHost(tweak.host) || 'no domain';
  row.querySelector('.dj-row-line-to').textContent = summarizeChanges(tweak);

  const toggle = row.querySelector('.dj-switch');
  toggle.setAttribute('aria-checked', String(Boolean(tweak.enabled)));

  const isAll = tweak.scope === 'all';
  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.setAttribute('aria-checked', String((seg.dataset.scope === 'all') === isAll));
  }
  row.querySelector('.scope-hint').textContent = isAll
    ? 'Every request type, including scripts, images and API calls.'
    : 'Page and iframe loads only. Leaves API calls alone.';

  let resolved = null;
  let problem = null;
  try {
    resolved = resolveTweak(tweak);
  } catch (error) {
    problem = error.message;
  }

  const incomplete = !tweak.host.trim() || (!tweak.remove.trim() && !tweak.add.trim());
  const showProblem = Boolean(problem) && !incomplete;
  row.querySelector('.host').classList.toggle('invalid', showProblem);

  const rowError = row.querySelector('.dj-row-error');
  rowError.textContent = showProblem ? problem : '';
  rowError.hidden = !showProblem;

  const sample = sampleUrlFor(tweak);
  row.querySelector('.dj-row-preview-from').textContent = sample;
  const rewritten = resolved ? previewTweak(resolved, sample) : null;
  const previewTo = row.querySelector('.dj-row-preview-to');
  previewTo.textContent = rewritten ?? (incomplete ? 'Fill in the domain and a change' : '—');
  previewTo.classList.toggle('muted', !rewritten);

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
    ? `${installed.length} rewrite rule(s) live. Reload the tab to pick it up.`
    : 'No rewrite rule installed. No query string is being changed.';
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
  row.querySelector('.dj-row-disclose').setAttribute('aria-expanded', String(open));
}

/** Same split params.js uses to parse the remove list, but never throws — this only seeds UI boxes. */
function splitRemoveNames(raw) {
  return String(raw ?? '').split(/[\s,\n]+/).map((name) => name.trim()).filter(Boolean);
}

/** Same shape as params.js's add-list split, but never throws — this only seeds UI boxes. */
function splitAddPairs(raw) {
  return String(raw ?? '').split(/[\n,]+/).map((line) => line.trim()).filter(Boolean).map((entry) => {
    const splitAt = entry.indexOf('=');
    return splitAt < 0
      ? { key: entry, value: '' }
      : { key: entry.slice(0, splitAt).trim(), value: entry.slice(splitAt + 1).trim() };
  });
}

function syncRemoveList(container, tweak) {
  const names = Array.from(container.querySelectorAll('.param-box-input'))
    .map((input) => input.value.trim())
    .filter(Boolean);
  tweak.remove = names.join('\n');
}

function addRemoveBox(container, tweak, touch, name = '', { focus = false } = {}) {
  const box = els.paramBoxTemplate.content.firstElementChild.cloneNode(true);
  const input = box.querySelector('.param-box-input');
  input.value = name;

  input.addEventListener('input', () => { syncRemoveList(container, tweak); touch(false); });
  input.addEventListener('change', () => { syncRemoveList(container, tweak); touch(true); });

  box.querySelector('.param-box-remove').addEventListener('click', () => {
    box.remove();
    if (!container.querySelector('.param-box')) addRemoveBox(container, tweak, touch);
    syncRemoveList(container, tweak);
    touch(true);
  });

  container.append(box);
  if (focus) input.focus();
  return box;
}

function syncAddList(container, tweak) {
  const pairs = Array.from(container.querySelectorAll('.param-pair'))
    .map((pairEl) => ({
      key: pairEl.querySelector('.param-pair-key').value.trim(),
      value: pairEl.querySelector('.param-pair-value').value,
    }))
    .filter((pair) => pair.key || pair.value);
  tweak.add = pairs.map((pair) => `${pair.key}=${pair.value}`).join('\n');
}

function addAddPair(container, tweak, touch, key = '', value = '', { focus = false } = {}) {
  const pairEl = els.paramPairTemplate.content.firstElementChild.cloneNode(true);
  const keyInput = pairEl.querySelector('.param-pair-key');
  const valueInput = pairEl.querySelector('.param-pair-value');
  keyInput.value = key;
  valueInput.value = value;

  const onInput = () => { syncAddList(container, tweak); touch(false); };
  const onChange = () => { syncAddList(container, tweak); touch(true); };
  keyInput.addEventListener('input', onInput);
  keyInput.addEventListener('change', onChange);
  valueInput.addEventListener('input', onInput);
  valueInput.addEventListener('change', onChange);

  pairEl.querySelector('.param-box-remove').addEventListener('click', () => {
    pairEl.remove();
    if (!container.querySelector('.param-pair')) addAddPair(container, tweak, touch);
    syncAddList(container, tweak);
    touch(true);
  });

  container.append(pairEl);
  if (focus) keyInput.focus();
  return pairEl;
}

function createRow(tweak) {
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = tweak.id;

  const touch = (immediate) => {
    paintRow(row, tweak);
    save({ immediate });
  };

  const hostInput = row.querySelector('.host');
  hostInput.value = tweak.host ?? '';
  hostInput.addEventListener('input', () => {
    tweak.host = hostInput.value;
    touch(false);
  });
  hostInput.addEventListener('change', () => {
    tweak.host = hostInput.value;
    touch(true);
  });

  const removeList = row.querySelector('.remove-params-list');
  const removeNames = splitRemoveNames(tweak.remove);
  for (const name of (removeNames.length ? removeNames : [''])) addRemoveBox(removeList, tweak, touch, name);
  row.querySelector('.remove-params-add').addEventListener('click', () => {
    addRemoveBox(removeList, tweak, touch, '', { focus: true });
  });

  const addList = row.querySelector('.add-params-list');
  const addPairs = splitAddPairs(tweak.add);
  for (const pair of (addPairs.length ? addPairs : [{ key: '', value: '' }])) {
    addAddPair(addList, tweak, touch, pair.key, pair.value);
  }
  row.querySelector('.add-params-add').addEventListener('click', () => {
    addAddPair(addList, tweak, touch, '', '', { focus: true });
  });

  row.querySelector('.dj-row-disclose').addEventListener('click', () => {
    setOpen(row, row.dataset.open !== 'true');
  });

  row.querySelector('.dj-switch').addEventListener('click', () => {
    tweak.enabled = !tweak.enabled;
    touch(true);
  });

  row.querySelector('.dj-row-remove').addEventListener('click', () => {
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
