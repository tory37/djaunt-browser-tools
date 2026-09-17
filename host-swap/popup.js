import { applySwaps } from './apply.js';
import {
  MAX_SWAPS, RULES_PER_SWAP, migrateConfig, newSwap, previewSwap, resolveSwap,
} from './swap.js';

const api = globalThis.browser ?? globalThis.chrome;

const SAMPLE_HOST = 'old-host.example.com';
const SAMPLE_QUERY = '/?token=abc123&id=42';
const SAVE_DEBOUNCE_MS = 250;
const LEGACY_KEYS = ['enabled', 'sourceHost', 'target', 'scope'];

const els = {
  head: document.getElementById('head'),
  pill: document.getElementById('pill'),
  list: document.getElementById('list'),
  empty: document.getElementById('empty'),
  add: document.getElementById('add'),
  status: document.getElementById('status'),
  rowTemplate: document.getElementById('rowTemplate'),
};

let swaps = [];
let saveTimer = null;

function bareHost(raw) {
  return String(raw ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
}

function sampleUrlFor(swap) {
  return `https://${bareHost(swap.sourceHost) || SAMPLE_HOST}${SAMPLE_QUERY}`;
}

function summarize(swap) {
  const from = bareHost(swap.sourceHost) || 'no source host';
  const to = bareHost(swap.target) || 'no target';
  return { from, to };
}

function paintRow(row, swap) {
  const { from, to } = summarize(swap);
  row.querySelector('.swap-from').textContent = from;
  row.querySelector('.swap-to').textContent = to;

  const toggle = row.querySelector('.dj-switch');
  toggle.setAttribute('aria-checked', String(Boolean(swap.enabled)));

  const isAll = swap.scope === 'all';
  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.setAttribute('aria-checked', String((seg.dataset.scope === 'all') === isAll));
  }
  row.querySelector('.scope-hint').textContent = isAll
    ? 'Every request type, including scripts, images and API calls.'
    : 'Page and iframe loads only. Leaves API calls alone.';

  let resolved = null;
  let problem = null;
  try {
    resolved = resolveSwap(swap);
  } catch (error) {
    problem = error.message;
  }

  const incomplete = !swap.target.trim() || !swap.sourceHost.trim();
  const showProblem = Boolean(problem) && !incomplete;
  row.querySelector('.source-host').classList.toggle('invalid', showProblem);
  row.querySelector('.target').classList.toggle('invalid', showProblem);

  const rowError = row.querySelector('.row-error');
  rowError.textContent = showProblem ? problem : '';
  rowError.hidden = !showProblem;

  const sample = sampleUrlFor(swap);
  row.querySelector('.preview-from').textContent = sample;
  const swapped = resolved ? previewSwap(resolved, sample) : null;
  const previewTo = row.querySelector('.preview-to');
  previewTo.textContent = swapped ?? (incomplete ? 'Fill in both hosts' : '—');
  previewTo.classList.toggle('muted', !swapped);

  row.dataset.state = resolved && swap.enabled ? 'active' : (problem && swap.enabled ? 'error' : 'idle');
}

/**
 * Installs the rules from here rather than waiting on the service worker, so the popup
 * always shows and enforces the same state.
 */
async function paintGlobal() {
  const { ready, broken } = await applySwaps(swaps);
  const state = ready.length ? 'active' : (broken.length ? 'error' : 'idle');
  els.head.dataset.state = state;
  els.pill.dataset.state = state;
  els.pill.textContent = ready.length ? `${ready.length} on` : (broken.length ? 'err' : 'off');

  els.empty.hidden = swaps.length > 0;
  els.add.disabled = swaps.length >= MAX_SWAPS;

  const installed = await api.declarativeNetRequest.getDynamicRules();
  const expected = ready.length * RULES_PER_SWAP;
  const stale = installed.length !== expected;
  els.status.classList.toggle('error', stale || (broken.length > 0 && ready.length === 0));

  let message = installed.length
    ? `${installed.length} redirect rule(s) live. Reload the tab to pick it up.`
    : 'No redirect rule installed. Nothing is being rewritten.';
  if (stale) message = `Expected ${expected} rule(s) but ${installed.length} are installed. Reload the extension at chrome://extensions.`;
  if (broken.length) message += ` ${broken.length} enabled swap(s) skipped — see the row error.`;
  els.status.textContent = message;
}

function save({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const commit = async () => {
    await api.storage.local.set({ swaps });
    await api.storage.local.remove(LEGACY_KEYS);
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

function createRow(swap) {
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = swap.id;

  const sourceInput = row.querySelector('.source-host');
  const targetInput = row.querySelector('.target');
  sourceInput.value = swap.sourceHost ?? '';
  targetInput.value = swap.target ?? '';

  const touch = (immediate) => {
    paintRow(row, swap);
    save({ immediate });
  };

  row.querySelector('.disclose').addEventListener('click', () => {
    setOpen(row, row.dataset.open !== 'true');
  });

  row.querySelector('.dj-switch').addEventListener('click', () => {
    swap.enabled = !swap.enabled;
    touch(true);
  });

  row.querySelector('.remove').addEventListener('click', () => {
    swaps = swaps.filter((entry) => entry.id !== swap.id);
    row.remove();
    save({ immediate: true });
  });

  for (const seg of row.querySelectorAll('.dj-seg')) {
    seg.addEventListener('click', () => {
      swap.scope = seg.dataset.scope;
      touch(true);
    });
  }

  for (const [input, key] of [[sourceInput, 'sourceHost'], [targetInput, 'target']]) {
    input.addEventListener('input', () => {
      swap[key] = input.value;
      touch(false);
    });
    input.addEventListener('change', () => {
      swap[key] = input.value;
      touch(true);
    });
  }

  paintRow(row, swap);
  return row;
}

function renderAll() {
  els.list.replaceChildren(...swaps.map(createRow));
}

els.add.addEventListener('click', () => {
  const swap = newSwap();
  swaps.push(swap);
  const row = createRow(swap);
  els.list.append(row);
  setOpen(row, true);
  row.querySelector('.source-host').focus();
  save({ immediate: true });
});

(async () => {
  const stored = await api.storage.local.get(null);
  swaps = migrateConfig(stored).swaps;
  // Persist the migrated shape immediately so nothing depends on a later edit.
  await api.storage.local.set({ swaps });
  await api.storage.local.remove(LEGACY_KEYS);
  renderAll();
  // A single swap has nothing to compare against, so open it straight away.
  if (els.list.firstElementChild && swaps.length === 1) setOpen(els.list.firstElementChild, true);
  await paintGlobal();
})();
