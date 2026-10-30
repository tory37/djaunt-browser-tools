import { applyRewrites } from './apply.js';
import {
  MAX_REWRITES, buildRules, newRewrite, parseAddList, parseRemoveList, previewRewrite,
  resolveRewrite,
} from './rewrite.js';

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

let rewrites = [];
let saveTimer = null;

function bareHost(raw) {
  return String(raw ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
}

/** The target without its scheme, keeping any path prefix. */
function bareTarget(raw) {
  return String(raw ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[?#]/)[0]
    .replace(/\/+$/, '');
}

function sampleUrlFor(rewrite) {
  return `https://${bareHost(rewrite.sourceHost) || SAMPLE_HOST}${SAMPLE_QUERY}`;
}

function parseSafely(parse, raw) {
  try {
    return parse(raw);
  } catch {
    return [];
  }
}

/** `to · −a −b +c=1`, leaving out whichever half the row does not use. */
function summarizeChanges(rewrite) {
  const removed = parseSafely(parseRemoveList, rewrite.remove).map((name) => `−${name}`);
  const added = parseSafely(parseAddList, rewrite.add).map((param) => `+${param.key}=${param.value}`);
  const parts = [];
  const target = bareTarget(rewrite.target);
  if (target) parts.push(target);
  if (removed.length || added.length) parts.push([...removed, ...added].join(' '));
  return parts.length ? parts.join(' · ') : 'no changes';
}

function paintRow(row, rewrite) {
  row.querySelector('.dj-row-line-from').textContent = bareHost(rewrite.sourceHost) || 'no source host';
  row.querySelector('.dj-row-line-to').textContent = summarizeChanges(rewrite);

  const toggle = row.querySelector('.dj-switch');
  toggle.setAttribute('aria-checked', String(Boolean(rewrite.enabled)));

  const isAll = rewrite.scope === 'all';
  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.setAttribute('aria-checked', String((seg.dataset.scope === 'all') === isAll));
  }
  row.querySelector('.scope-hint').textContent = isAll
    ? 'Every request type, including scripts, images and API calls.'
    : 'Page and iframe loads only. Leaves API calls alone.';

  let resolved = null;
  let problem = null;
  try {
    resolved = resolveRewrite(rewrite);
  } catch (error) {
    problem = error.message;
  }

  const hasChange = rewrite.target.trim() || rewrite.remove.trim() || rewrite.add.trim();
  const incomplete = !rewrite.sourceHost.trim() || !hasChange;
  const showProblem = Boolean(problem) && !incomplete;
  row.querySelector('.source-host').classList.toggle('invalid', showProblem);
  row.querySelector('.target').classList.toggle('invalid', showProblem);

  const rowError = row.querySelector('.dj-row-error');
  rowError.textContent = showProblem ? problem : '';
  rowError.hidden = !showProblem;

  const targetNote = row.querySelector('.rw-target-note');
  const noteTarget = resolved?.paramsMatchTarget
    ? `${resolved.target.hostWithPort}${resolved.target.pathPrefix}`
    : '';
  targetNote.textContent = noteTarget
    ? `Params rule also applies to direct visits to ${noteTarget}.`
    : '';
  targetNote.hidden = !noteTarget;

  const sample = sampleUrlFor(rewrite);
  row.querySelector('.dj-row-preview-from').textContent = sample;
  const rewritten = resolved ? previewRewrite(resolved, sample) : null;
  const previewTo = row.querySelector('.dj-row-preview-to');
  previewTo.textContent = rewritten ?? (incomplete ? 'Fill in the from host and a change' : '—');
  previewTo.classList.toggle('muted', !rewritten);

  row.dataset.state = resolved && rewrite.enabled ? 'active' : (problem && rewrite.enabled ? 'error' : 'idle');
}

/**
 * Installs the rules from here rather than waiting on the service worker, so the popup
 * always shows and enforces the same state.
 */
async function paintGlobal() {
  const { ready, broken } = await applyRewrites(rewrites);
  const state = ready.length ? 'active' : (broken.length ? 'error' : 'idle');
  els.head.dataset.state = state;
  els.pill.dataset.state = state;
  els.pill.textContent = ready.length ? `${ready.length} on` : (broken.length ? 'err' : 'off');

  els.empty.hidden = rewrites.length > 0;
  els.add.disabled = rewrites.length >= MAX_REWRITES;

  const installed = await api.declarativeNetRequest.getDynamicRules();
  // Each row needs one to three rules depending on its target, so count the real set.
  const expected = buildRules(ready).length;
  const stale = installed.length !== expected;
  els.status.classList.toggle('error', stale || (broken.length > 0 && ready.length === 0));

  let message = installed.length
    ? `${installed.length} redirect rule(s) live. Reload the tab to pick it up.`
    : 'No redirect rule installed. Nothing is being rewritten.';
  if (stale) message = `Expected ${expected} rule(s) but ${installed.length} are installed. Reload the extension at chrome://extensions.`;
  if (broken.length) message += ` ${broken.length} enabled rewrite(s) skipped — see the row error.`;
  els.status.textContent = message;
}

function save({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const commit = async () => {
    await api.storage.local.set({ rewrites });
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

/** Same split rewrite.js uses to parse the remove list, but never throws — this only seeds UI boxes. */
function splitRemoveNames(raw) {
  return String(raw ?? '').split(/[\s,\n]+/).map((name) => name.trim()).filter(Boolean);
}

/** Same shape as rewrite.js's add-list split, but never throws — this only seeds UI boxes. */
function splitAddPairs(raw) {
  return String(raw ?? '').split(/[\n,]+/).map((line) => line.trim()).filter(Boolean).map((entry) => {
    const splitAt = entry.indexOf('=');
    return splitAt < 0
      ? { key: entry, value: '' }
      : { key: entry.slice(0, splitAt).trim(), value: entry.slice(splitAt + 1).trim() };
  });
}

function syncRemoveList(container, rewrite) {
  const names = Array.from(container.querySelectorAll('.param-box-input'))
    .map((input) => input.value.trim())
    .filter(Boolean);
  rewrite.remove = names.join('\n');
}

function addRemoveBox(container, rewrite, touch, name = '', { focus = false } = {}) {
  const box = els.paramBoxTemplate.content.firstElementChild.cloneNode(true);
  const input = box.querySelector('.param-box-input');
  input.value = name;

  input.addEventListener('input', () => { syncRemoveList(container, rewrite); touch(false); });
  input.addEventListener('change', () => { syncRemoveList(container, rewrite); touch(true); });

  box.querySelector('.param-box-remove').addEventListener('click', () => {
    box.remove();
    if (!container.querySelector('.param-box')) addRemoveBox(container, rewrite, touch);
    syncRemoveList(container, rewrite);
    touch(true);
  });

  container.append(box);
  if (focus) input.focus();
  return box;
}

function syncAddList(container, rewrite) {
  const pairs = Array.from(container.querySelectorAll('.param-pair'))
    .map((pairEl) => ({
      key: pairEl.querySelector('.param-pair-key').value.trim(),
      value: pairEl.querySelector('.param-pair-value').value,
    }))
    .filter((pair) => pair.key || pair.value);
  rewrite.add = pairs.map((pair) => `${pair.key}=${pair.value}`).join('\n');
}

function addAddPair(container, rewrite, touch, key = '', value = '', { focus = false } = {}) {
  const pairEl = els.paramPairTemplate.content.firstElementChild.cloneNode(true);
  const keyInput = pairEl.querySelector('.param-pair-key');
  const valueInput = pairEl.querySelector('.param-pair-value');
  keyInput.value = key;
  valueInput.value = value;

  const onInput = () => { syncAddList(container, rewrite); touch(false); };
  const onChange = () => { syncAddList(container, rewrite); touch(true); };
  keyInput.addEventListener('input', onInput);
  keyInput.addEventListener('change', onChange);
  valueInput.addEventListener('input', onInput);
  valueInput.addEventListener('change', onChange);

  pairEl.querySelector('.param-box-remove').addEventListener('click', () => {
    pairEl.remove();
    if (!container.querySelector('.param-pair')) addAddPair(container, rewrite, touch);
    syncAddList(container, rewrite);
    touch(true);
  });

  container.append(pairEl);
  if (focus) keyInput.focus();
  return pairEl;
}

function createRow(rewrite) {
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = rewrite.id;

  const touch = (immediate) => {
    paintRow(row, rewrite);
    save({ immediate });
  };

  const sourceInput = row.querySelector('.source-host');
  const targetInput = row.querySelector('.target');
  sourceInput.value = rewrite.sourceHost ?? '';
  targetInput.value = rewrite.target ?? '';
  for (const [input, key] of [[sourceInput, 'sourceHost'], [targetInput, 'target']]) {
    input.addEventListener('input', () => {
      rewrite[key] = input.value;
      touch(false);
    });
    input.addEventListener('change', () => {
      rewrite[key] = input.value;
      touch(true);
    });
  }

  const removeList = row.querySelector('.remove-params-list');
  const removeNames = splitRemoveNames(rewrite.remove);
  for (const name of (removeNames.length ? removeNames : [''])) addRemoveBox(removeList, rewrite, touch, name);
  row.querySelector('.remove-params-add').addEventListener('click', () => {
    addRemoveBox(removeList, rewrite, touch, '', { focus: true });
  });

  const addList = row.querySelector('.add-params-list');
  const addPairs = splitAddPairs(rewrite.add);
  for (const pair of (addPairs.length ? addPairs : [{ key: '', value: '' }])) {
    addAddPair(addList, rewrite, touch, pair.key, pair.value);
  }
  row.querySelector('.add-params-add').addEventListener('click', () => {
    addAddPair(addList, rewrite, touch, '', '', { focus: true });
  });

  row.querySelector('.dj-row-disclose').addEventListener('click', () => {
    setOpen(row, row.dataset.open !== 'true');
  });

  row.querySelector('.dj-switch').addEventListener('click', () => {
    rewrite.enabled = !rewrite.enabled;
    touch(true);
  });

  row.querySelector('.dj-row-remove').addEventListener('click', () => {
    rewrites = rewrites.filter((entry) => entry.id !== rewrite.id);
    row.remove();
    save({ immediate: true });
  });

  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.addEventListener('click', () => {
      rewrite.scope = seg.dataset.scope;
      touch(true);
    });
  }

  paintRow(row, rewrite);
  return row;
}

function renderAll() {
  els.list.replaceChildren(...rewrites.map(createRow));
}

els.add.addEventListener('click', () => {
  const rewrite = newRewrite();
  rewrites.push(rewrite);
  const row = createRow(rewrite);
  els.list.append(row);
  setOpen(row, true);
  row.querySelector('.source-host').focus();
  save({ immediate: true });
});

(async () => {
  const stored = await api.storage.local.get('rewrites');
  rewrites = Array.isArray(stored.rewrites) ? stored.rewrites.map((entry) => newRewrite(entry)) : [];
  renderAll();
  // A single rewrite has nothing to compare against, so open it straight away.
  if (els.list.firstElementChild && rewrites.length === 1) setOpen(els.list.firstElementChild, true);
  await paintGlobal();
})();
