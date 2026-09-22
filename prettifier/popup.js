import { beautifyJson, diffJson, jsonDiffReport, summarizeJsonDiff } from './json-tool.js';
import {
  beautifyMarkdown, diffMarkdown, markdownDiffReport, summarizeMarkdownDiff,
} from './markdown-tool.js';

const api = globalThis.browser ?? globalThis.chrome;

const SAVE_DEBOUNCE_MS = 250;
const STORAGE_KEY = 'prettifier-state';

const DEFAULT_STATE = {
  tab: 'beautify',
  format: 'json',
  indent: 2,
  beautifyInput: '',
  compareA: '',
  compareB: '',
};

let state = { ...DEFAULT_STATE };
let saveTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  beautifyInput: $('#beautify-input'),
  beautifyOutput: $('#beautify-output'),
  beautifyError: $('#beautify-error'),
  beautifyCopy: $('#beautify-copy'),
  beautifyDownload: $('#beautify-download'),
  indentGroup: $('#indent-group'),
  compareA: $('#compare-a'),
  compareB: $('#compare-b'),
  compareSwap: $('#compare-swap'),
  compareError: $('#compare-error'),
  compareDownload: $('#compare-download'),
  diffList: $('#diff-list'),
  diffEmpty: $('#diff-empty'),
  diffSummary: $('#diff-summary'),
  status: $('#status'),
};

let lastReport = '';

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.storage.local.set({ [STORAGE_KEY]: state }), SAVE_DEBOUNCE_MS);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

// ---- tabs ----

function activateTab(tab) {
  state.tab = tab;
  $$('.dj-seg[role="tab"]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  });
  $('#panel-beautify').hidden = tab !== 'beautify';
  $('#panel-compare').hidden = tab !== 'compare';
  save();
}

$$('.dj-seg[role="tab"]').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ---- format ----

function activateFormat(format) {
  state.format = format;
  $$('#format-group .dj-seg').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.format === format));
  });
  els.indentGroup.hidden = format !== 'json';
  runBeautify();
  runCompare();
  save();
}

$$('#format-group .dj-seg').forEach((btn) => {
  btn.addEventListener('click', () => activateFormat(btn.dataset.format));
});

// ---- indent ----

function activateIndent(indent) {
  state.indent = indent;
  $$('#indent-group .dj-seg').forEach((btn) => {
    btn.setAttribute('aria-checked', String(Number(btn.dataset.indent) === indent));
  });
  runBeautify();
  save();
}

$$('#indent-group .dj-seg').forEach((btn) => {
  btn.addEventListener('click', () => activateIndent(Number(btn.dataset.indent)));
});

// ---- beautify ----

function runBeautify() {
  const text = els.beautifyInput.value;
  if (!text.trim()) {
    els.beautifyOutput.value = '';
    els.beautifyError.hidden = true;
    return;
  }
  try {
    const output = state.format === 'json' ? beautifyJson(text, state.indent) : beautifyMarkdown(text);
    els.beautifyOutput.value = output;
    els.beautifyError.hidden = true;
  } catch (error) {
    els.beautifyOutput.value = '';
    els.beautifyError.textContent = error.message;
    els.beautifyError.hidden = false;
  }
}

els.beautifyInput.addEventListener('input', () => {
  state.beautifyInput = els.beautifyInput.value;
  runBeautify();
  save();
});

els.beautifyCopy.addEventListener('click', async () => {
  if (!els.beautifyOutput.value) return;
  await navigator.clipboard.writeText(els.beautifyOutput.value);
  setStatus('Copied beautified output to the clipboard.');
});

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

els.beautifyDownload.addEventListener('click', () => {
  if (!els.beautifyOutput.value) return;
  downloadText(state.format === 'json' ? 'pretty.json' : 'pretty.md', els.beautifyOutput.value);
});

// ---- compare ----

function renderJsonDiff(a, b) {
  const changes = diffJson(a, b);
  const summary = summarizeJsonDiff(changes);
  els.diffList.replaceChildren();
  for (const change of changes) {
    const row = document.createElement('div');
    row.className = `diff-entry ${change.kind === 'added' ? 'added' : change.kind === 'removed' ? 'removed' : 'changed'}`;
    const path = `<span class="diff-path">${change.path}</span>`;
    if (change.kind === 'added') row.innerHTML = `+ ${path} = ${JSON.stringify(change.after)}`;
    else if (change.kind === 'removed') row.innerHTML = `− ${path} = ${JSON.stringify(change.before)}`;
    else if (change.kind === 'type-changed') {
      row.innerHTML = `~ ${path}: ${change.beforeType} <del>${JSON.stringify(change.before)}</del> <ins>${JSON.stringify(change.after)}</ins> (${change.afterType})`;
    } else {
      row.innerHTML = `~ ${path}: <del>${JSON.stringify(change.before)}</del> <ins>${JSON.stringify(change.after)}</ins>`;
    }
    els.diffList.append(row);
  }
  return { changes, summary, report: jsonDiffReport(changes) };
}

function renderWords(words) {
  return words.map((op) => {
    if (op.type === 'equal') return op.a;
    if (op.type === 'remove') return `<del>${op.a}</del>`;
    return `<ins>${op.b}</ins>`;
  }).join(' ');
}

function describeBlock(block) {
  if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.text}`;
  if (block.type === 'list') return block.items.join(', ');
  if (block.type === 'code') return `[code block${block.lang ? ` · ${block.lang}` : ''}]`;
  if (block.type === 'hr') return '---';
  return block.text;
}

function renderMarkdownDiff(a, b) {
  const sections = diffMarkdown(a, b);
  const summary = summarizeMarkdownDiff(sections);
  els.diffList.replaceChildren();
  for (const section of sections) {
    const head = document.createElement('div');
    head.className = 'diff-section-head';
    head.textContent = section.path;
    els.diffList.append(head);

    if (section.kind === 'section-added') {
      const row = document.createElement('div');
      row.className = 'diff-entry added';
      row.textContent = '+ section added';
      els.diffList.append(row);
      continue;
    }
    if (section.kind === 'section-removed') {
      const row = document.createElement('div');
      row.className = 'diff-entry removed';
      row.textContent = '− section removed';
      els.diffList.append(row);
      continue;
    }

    for (const change of section.changes) {
      const row = document.createElement('div');
      if (change.kind === 'block-added') {
        row.className = 'diff-entry added';
        row.textContent = `+ ${describeBlock(change.block)}`;
      } else if (change.kind === 'block-removed') {
        row.className = 'diff-entry removed';
        row.textContent = `− ${describeBlock(change.block)}`;
      } else if (change.kind === 'list-changed') {
        for (const item of change.added) {
          const addRow = document.createElement('div');
          addRow.className = 'diff-entry added';
          addRow.textContent = `+ ${item}`;
          els.diffList.append(addRow);
        }
        for (const item of change.removed) {
          const removeRow = document.createElement('div');
          removeRow.className = 'diff-entry removed';
          removeRow.textContent = `− ${item}`;
          els.diffList.append(removeRow);
        }
        continue;
      } else if (change.words) {
        row.className = 'diff-entry changed';
        row.innerHTML = `~ ${change.blockType}: ${renderWords(change.words)}`;
      } else {
        row.className = 'diff-entry changed';
        row.innerHTML = `~ ${change.blockType}: <del>${change.before}</del> <ins>${change.after}</ins>`;
      }
      els.diffList.append(row);
    }
  }
  return { sections, summary, report: markdownDiffReport(sections) };
}

function renderSummary(summary) {
  const parts = [];
  if (summary.added) parts.push(`<span class="added">+${summary.added}</span>`);
  if (summary.removed) parts.push(`<span class="removed">−${summary.removed}</span>`);
  if (summary.changed) parts.push(`<span class="changed">~${summary.changed}</span>`);
  els.diffSummary.innerHTML = parts.join(' ');
}

function runCompare() {
  const textA = els.compareA.value;
  const textB = els.compareB.value;
  els.compareError.hidden = true;
  els.diffList.replaceChildren();
  els.diffSummary.innerHTML = '';
  els.compareDownload.disabled = true;
  lastReport = '';

  if (!textA.trim() && !textB.trim()) {
    els.diffEmpty.hidden = true;
    return;
  }

  if (state.format === 'json') {
    let valueA;
    let valueB;
    try {
      valueA = JSON.parse(textA || 'null');
    } catch (error) {
      els.compareError.textContent = `A: ${error.message}`;
      els.compareError.hidden = false;
      els.diffEmpty.hidden = true;
      return;
    }
    try {
      valueB = JSON.parse(textB || 'null');
    } catch (error) {
      els.compareError.textContent = `B: ${error.message}`;
      els.compareError.hidden = false;
      els.diffEmpty.hidden = true;
      return;
    }
    const { changes, summary, report } = renderJsonDiff(valueA, valueB);
    els.diffEmpty.hidden = changes.length > 0;
    renderSummary(summary);
    lastReport = report;
    els.compareDownload.disabled = false;
    return;
  }

  const { sections, summary, report } = renderMarkdownDiff(textA, textB);
  els.diffEmpty.hidden = sections.length > 0;
  renderSummary(summary);
  lastReport = report;
  els.compareDownload.disabled = false;
}

els.compareA.addEventListener('input', () => { state.compareA = els.compareA.value; runCompare(); save(); });
els.compareB.addEventListener('input', () => { state.compareB = els.compareB.value; runCompare(); save(); });

els.compareSwap.addEventListener('click', () => {
  const a = els.compareA.value;
  els.compareA.value = els.compareB.value;
  els.compareB.value = a;
  state.compareA = els.compareA.value;
  state.compareB = els.compareB.value;
  runCompare();
  save();
});

els.compareDownload.addEventListener('click', () => {
  if (!lastReport) return;
  downloadText(state.format === 'json' ? 'diff-report.txt' : 'diff-report.md', lastReport);
});

// ---- startup ----

(async () => {
  const stored = await api.storage.local.get(STORAGE_KEY);
  state = { ...DEFAULT_STATE, ...(stored[STORAGE_KEY] || {}) };

  els.beautifyInput.value = state.beautifyInput;
  els.compareA.value = state.compareA;
  els.compareB.value = state.compareB;

  activateTab(state.tab);
  activateFormat(state.format);
  activateIndent(state.indent);
  runBeautify();
  runCompare();
})();
