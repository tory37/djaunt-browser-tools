import {
  isRestrictedUrl, looksLikeJson, formatJsonPreview, byteLength, formatBytes, sortEntries,
  filterEntries, totalBytes, buildExport,
} from './storage.js';

const api = globalThis.browser ?? globalThis.chrome;

let tabId = null;
let store = 'local';
let entries = { local: [], session: [] };
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  originValue: $('#origin-value'),
  refreshBtn: $('#refresh-btn'),
  blockedMessage: $('#blocked-message'),
  toolbar: $('#toolbar'),
  panel: $('#panel'),
  footer: $('#footer'),
  filterInput: $('#filter-input'),
  newKey: $('#new-key'),
  newValue: $('#new-value'),
  addBtn: $('#add-btn'),
  addError: $('#add-error'),
  entryList: $('#entry-list'),
  emptyMessage: $('#empty-message'),
  toast: $('#toast'),
  entrySummary: $('#entry-summary'),
  exportBtn: $('#export-btn'),
  clearBtn: $('#clear-btn'),
};

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2500);
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---- page-context functions, executed via scripting.executeScript ----
// These run inside the inspected page and must be fully self-contained: no
// references to anything outside their own parameters.

function pageReadStorage() {
  function dump(storage) {
    const out = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      out.push({ key, value: storage.getItem(key) });
    }
    return out;
  }
  try {
    return { ok: true, local: dump(window.localStorage), session: dump(window.sessionStorage) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function pageSetItem(storeName, key, value) {
  try {
    window[storeName === 'local' ? 'localStorage' : 'sessionStorage'].setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function pageRemoveItem(storeName, key) {
  try {
    window[storeName === 'local' ? 'localStorage' : 'sessionStorage'].removeItem(key);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function pageClearStore(storeName) {
  try {
    window[storeName === 'local' ? 'localStorage' : 'sessionStorage'].clear();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function runInPage(func, args = []) {
  const [{ result }] = await api.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

// ---- data loading ----

async function loadSnapshot() {
  const result = await runInPage(pageReadStorage);
  if (!result.ok) {
    showToast(`Couldn't read storage: ${result.error}`, true);
    entries = { local: [], session: [] };
    return;
  }
  entries = { local: sortEntries(result.local), session: sortEntries(result.session) };
}

async function refresh() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setBlocked('No active tab.');
    return;
  }
  tabId = tab.id;
  els.originValue.textContent = tab.url || '(unknown)';

  if (isRestrictedUrl(tab.url)) {
    setBlocked("This page can't be inspected — browser-internal pages and store listings don't allow extension scripts.");
    return;
  }

  try {
    await loadSnapshot();
    setBlocked(null);
    render();
  } catch (error) {
    setBlocked(`Couldn't access this page: ${error.message}`);
  }
}

function setBlocked(message) {
  const blocked = Boolean(message);
  els.blockedMessage.hidden = !blocked;
  els.blockedMessage.textContent = message || '';
  els.toolbar.hidden = blocked;
  els.panel.hidden = blocked;
  els.footer.hidden = blocked;
}

// ---- rendering ----

function activateStore(nextStore) {
  store = nextStore;
  $$('.dj-seg[role="tab"]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.store === store));
  });
  render();
}

$$('.dj-seg[role="tab"]').forEach((btn) => {
  btn.addEventListener('click', () => activateStore(btn.dataset.store));
});

function renderEntryRow(entry) {
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.dataset.key = entry.key;

  const head = document.createElement('div');
  head.className = 'entry-head';

  const keySpan = document.createElement('span');
  keySpan.className = 'entry-key';
  keySpan.textContent = entry.key;
  keySpan.title = entry.key;

  const meta = document.createElement('span');
  meta.className = 'entry-meta';
  const badge = document.createElement('span');
  badge.className = 'json-badge';
  badge.textContent = 'JSON';
  badge.hidden = !looksLikeJson(entry.value);
  meta.append(badge);
  const size = document.createElement('span');
  size.className = 'entry-size';
  size.textContent = formatBytes(byteLength(entry.value));
  meta.append(size);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mini-btn entry-delete';
  deleteBtn.textContent = 'Delete';
  deleteBtn.setAttribute('aria-label', `Delete ${entry.key}`);

  head.append(keySpan, meta, deleteBtn);

  const valueArea = document.createElement('textarea');
  valueArea.className = 'entry-value mono';
  let baseline = looksLikeJson(entry.value) ? formatJsonPreview(entry.value) : entry.value;
  valueArea.value = baseline;
  valueArea.rows = Math.min(10, Math.max(1, baseline.split('\n').length));

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.hidden = true;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'mini-btn';
  saveBtn.textContent = 'Save';
  const revertBtn = document.createElement('button');
  revertBtn.type = 'button';
  revertBtn.className = 'mini-btn';
  revertBtn.textContent = 'Revert';
  actions.append(saveBtn, revertBtn);

  valueArea.addEventListener('input', () => {
    actions.hidden = valueArea.value === baseline;
  });

  saveBtn.addEventListener('click', async () => {
    const result = await runInPage(pageSetItem, [store, entry.key, valueArea.value]);
    if (!result.ok) {
      showToast(`Couldn't save "${entry.key}": ${result.error}`, true);
      return;
    }
    entry.value = valueArea.value;
    baseline = looksLikeJson(entry.value) ? formatJsonPreview(entry.value) : entry.value;
    valueArea.value = baseline;
    badge.hidden = !looksLikeJson(entry.value);
    actions.hidden = true;
    size.textContent = formatBytes(byteLength(entry.value));
    showToast(`Saved "${entry.key}".`);
  });

  revertBtn.addEventListener('click', () => {
    valueArea.value = baseline;
    actions.hidden = true;
  });

  deleteBtn.addEventListener('click', async () => {
    const result = await runInPage(pageRemoveItem, [store, entry.key]);
    if (!result.ok) {
      showToast(`Couldn't delete "${entry.key}": ${result.error}`, true);
      return;
    }
    entries[store] = entries[store].filter((item) => item.key !== entry.key);
    showToast(`Deleted "${entry.key}".`);
    render();
  });

  row.append(head, valueArea, actions);
  return row;
}

function render() {
  const all = entries[store];
  const filtered = filterEntries(all, els.filterInput.value);

  els.entryList.replaceChildren();
  for (const entry of filtered) {
    els.entryList.append(renderEntryRow(entry));
  }
  els.emptyMessage.hidden = filtered.length !== 0;
  els.emptyMessage.textContent = all.length === 0 ? 'No entries.' : 'Nothing matches that filter.';

  const count = all.length;
  els.entrySummary.textContent = `${count} ${count === 1 ? 'entry' : 'entries'} · ${formatBytes(totalBytes(all))}`;
}

els.filterInput.addEventListener('input', render);

// ---- add entry ----

els.addBtn.addEventListener('click', async () => {
  const key = els.newKey.value.trim();
  const value = els.newValue.value;
  els.addError.hidden = true;

  if (!key) {
    els.addError.textContent = 'Enter a key.';
    els.addError.hidden = false;
    return;
  }
  if (entries[store].some((entry) => entry.key === key)) {
    els.addError.textContent = `"${key}" already exists — edit it in the list below.`;
    els.addError.hidden = false;
    return;
  }

  const result = await runInPage(pageSetItem, [store, key, value]);
  if (!result.ok) {
    els.addError.textContent = result.error;
    els.addError.hidden = false;
    return;
  }
  entries[store] = sortEntries([...entries[store], { key, value }]);
  els.newKey.value = '';
  els.newValue.value = '';
  showToast(`Added "${key}".`);
  render();
});

// ---- footer actions ----

els.exportBtn.addEventListener('click', () => {
  const json = buildExport(entries[store]);
  downloadText(`${store}-storage.json`, json);
});

els.clearBtn.addEventListener('click', async () => {
  if (entries[store].length === 0) return;
  const result = await runInPage(pageClearStore, [store]);
  if (!result.ok) {
    showToast(`Couldn't clear storage: ${result.error}`, true);
    return;
  }
  entries[store] = [];
  showToast('Cleared.');
  render();
});

els.refreshBtn.addEventListener('click', refresh);

// ---- startup ----

refresh();
