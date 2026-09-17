import {
  parseColor, rgbToHex, formatRgb, formatHsl, formatOklch, contrastRatio,
  contrastRating, gradientCss,
} from './color.js';

const api = globalThis.browser ?? globalThis.chrome;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      return true;
    } catch (fallbackError) {
      return false;
    }
  }
}

function flashCopied(button) {
  const original = button.textContent;
  button.textContent = 'Copied';
  button.classList.add('copied');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('copied');
  }, 900);
}

$$('.copy-btn').forEach((button) => {
  button.addEventListener('click', async () => {
    const row = button.closest('.fmt-row');
    const value = row ? $('.fmt-value', row)?.textContent : null;
    if (value && (await copyText(value))) flashCopied(button);
  });
});

// ---- tabs ----

function activateTab(tab) {
  $$('.dj-seg[role="tab"]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  });
  $$('.panel').forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tab}`;
  });
}

$$('.dj-seg[role="tab"]').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ---- pick panel ----

let current = null;

function renderCurrent() {
  const swatch = $('#swatch');
  const fmtList = $('#fmt-list');
  if (!current) {
    swatch.dataset.empty = 'true';
    swatch.style.backgroundColor = '';
    fmtList.hidden = true;
    return;
  }
  swatch.dataset.empty = 'false';
  swatch.style.backgroundColor = formatRgb(current);
  fmtList.hidden = false;
  $('.fmt-row[data-format="hex"] .fmt-value').textContent = rgbToHex(current);
  $('.fmt-row[data-format="rgb"] .fmt-value').textContent = formatRgb(current);
  $('.fmt-row[data-format="hsl"] .fmt-value').textContent = formatHsl(current);
  $('.fmt-row[data-format="oklch"] .fmt-value').textContent = formatOklch(current);
}

function setCurrentColor(rgba) {
  current = rgba;
  renderCurrent();
}

async function commitColor(rgba) {
  setCurrentColor(rgba);
  await api.runtime.sendMessage({ type: 'addToHistory', hex: rgbToHex(rgba) });
  await loadHistory();
}

async function pickColorFallback() {
  try {
    setStatus('Opening the picker…');
    const dataUrl = await api.tabs.captureVisibleTab({ format: 'png' });
    await api.storage.session.set({ pickerImage: dataUrl });
    await api.windows.create({
      url: api.runtime.getURL('picker.html'),
      type: 'popup',
      state: 'maximized',
      focused: true,
    });
    setStatus('');
  } catch (error) {
    setStatus('Could not capture this page — try a normal tab.', true);
  }
}

async function pickColor() {
  setStatus('');
  if (typeof EyeDropper !== 'undefined') {
    try {
      const result = await new EyeDropper().open();
      const rgba = parseColor(result.sRGBHex);
      if (rgba) await commitColor(rgba);
    } catch (error) {
      // The user pressed Esc or dismissed the eyedropper — not an error.
    }
    return;
  }
  await pickColorFallback();
}

$('#pick').addEventListener('click', pickColor);
$('#pick-hint').textContent = typeof EyeDropper !== 'undefined'
  ? 'Pick any pixel on screen, even outside the browser.'
  : 'Opens a full-page picker for pixel-accurate sampling.';

// ---- history panel ----

let history = [];
const swatchTemplate = $('#swatchTemplate');

async function loadHistory() {
  const stored = await api.storage.local.get('history');
  history = stored.history || [];
  renderHistory();
}

function renderHistory() {
  const grid = $('#history-grid');
  grid.innerHTML = '';
  $('#history-empty').hidden = history.length > 0;

  for (const hex of history) {
    const node = swatchTemplate.content.cloneNode(true);
    const cell = node.querySelector('.swatch-cell');
    const select = node.querySelector('.swatch-select');
    const remove = node.querySelector('.swatch-remove');

    cell.style.setProperty('--swatch-color', hex);
    select.title = hex;
    select.addEventListener('click', () => {
      const rgba = parseColor(hex);
      if (rgba) setCurrentColor(rgba);
      activateTab('pick');
    });
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await api.runtime.sendMessage({ type: 'removeFromHistory', hex });
      await loadHistory();
    });

    grid.appendChild(node);
  }
}

$('#clear-history').addEventListener('click', async () => {
  await api.runtime.sendMessage({ type: 'clearHistory' });
  await loadHistory();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) loadHistory();
});

// ---- gradient panel ----

const gradient = {
  type: 'linear',
  angle: 90,
  stops: [
    { hex: '#2fb3c9', pos: 0 },
    { hex: '#9b8cff', pos: 100 },
  ],
};

const stopTemplate = $('#stopTemplate');

function renderGradientOutput() {
  const css = gradientCss(gradient);
  $('#gradient-preview').style.background = css;
  $('#gradient-output').textContent = `background: ${css};`;
}

function renderGradient() {
  $$('#panel-gradient .dj-seg[role="radio"]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.type === gradient.type));
  });
  $('#angle-field').hidden = gradient.type === 'radial';
  $('#angle').value = gradient.angle;
  $('#angle-value').textContent = `${gradient.angle}°`;

  const list = $('#stop-list');
  list.innerHTML = '';

  gradient.stops.forEach((stop, index) => {
    const node = stopTemplate.content.cloneNode(true);
    const swatch = node.querySelector('.stop-swatch');
    const hexInput = node.querySelector('.stop-hex');
    const posInput = node.querySelector('.stop-pos');
    const posValue = node.querySelector('.stop-pos-value');
    const removeBtn = node.querySelector('.stop-remove');

    swatch.value = stop.hex;
    hexInput.value = stop.hex;
    posInput.value = stop.pos;
    posValue.textContent = `${Math.round(stop.pos)}%`;
    removeBtn.disabled = gradient.stops.length <= 2;

    swatch.addEventListener('input', () => {
      stop.hex = swatch.value;
      hexInput.value = swatch.value;
      renderGradientOutput();
    });
    hexInput.addEventListener('input', () => {
      const rgba = parseColor(hexInput.value);
      if (!rgba) return;
      stop.hex = rgbToHex(rgba);
      swatch.value = stop.hex;
      renderGradientOutput();
    });
    posInput.addEventListener('input', () => {
      stop.pos = Number(posInput.value);
      posValue.textContent = `${stop.pos}%`;
      renderGradientOutput();
    });
    removeBtn.addEventListener('click', () => {
      if (gradient.stops.length <= 2) return;
      gradient.stops.splice(index, 1);
      renderGradient();
    });

    list.appendChild(node);
  });

  renderGradientOutput();
}

$$('#panel-gradient .dj-seg[role="radio"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    gradient.type = btn.dataset.type;
    renderGradient();
  });
});

$('#angle').addEventListener('input', (event) => {
  gradient.angle = Number(event.target.value);
  $('#angle-value').textContent = `${gradient.angle}°`;
  renderGradientOutput();
});

$('#add-stop').addEventListener('click', () => {
  if (gradient.stops.length >= 5) return;
  gradient.stops.push({ hex: '#ffffff', pos: 100 });
  renderGradient();
});

// ---- contrast panel ----

const contrast = { fg: '#f2f2f2', bg: '#0a0a0a' };

function setBadge(selector, pass) {
  $(selector).dataset.pass = String(pass);
}

function renderContrast() {
  $('#fg-swatch').value = contrast.fg;
  $('#fg-hex').value = contrast.fg;
  $('#bg-swatch').value = contrast.bg;
  $('#bg-hex').value = contrast.bg;

  const preview = $('#contrast-preview');
  preview.style.setProperty('--contrast-fg', contrast.fg);
  preview.style.setProperty('--contrast-bg', contrast.bg);

  const fgRgb = parseColor(contrast.fg);
  const bgRgb = parseColor(contrast.bg);
  if (!fgRgb || !bgRgb) return;

  const ratio = contrastRatio(fgRgb, bgRgb);
  $('#contrast-ratio').textContent = `${ratio.toFixed(2)}:1`;

  const rating = contrastRating(ratio);
  setBadge('#badge-aa-normal', rating.aaNormal);
  setBadge('#badge-aaa-normal', rating.aaaNormal);
  setBadge('#badge-aa-large', rating.aaLarge);
  setBadge('#badge-aaa-large', rating.aaaLarge);
}

$('#fg-swatch').addEventListener('input', (e) => { contrast.fg = e.target.value; renderContrast(); });
$('#bg-swatch').addEventListener('input', (e) => { contrast.bg = e.target.value; renderContrast(); });
$('#fg-hex').addEventListener('input', (e) => {
  const rgba = parseColor(e.target.value);
  if (rgba) { contrast.fg = rgbToHex(rgba); renderContrast(); }
});
$('#bg-hex').addEventListener('input', (e) => {
  const rgba = parseColor(e.target.value);
  if (rgba) { contrast.bg = rgbToHex(rgba); renderContrast(); }
});

// ---- init ----

activateTab('pick');
renderGradient();
renderContrast();
loadHistory();
