import {
  createStopwatch, createCountdown, createPomodoro, elapsedOf, remainingOf,
  startTimer, pauseTimer, resetTimer, addLap, skipPhase, stepTimers, formatDuration,
} from './clock.js';

const api = globalThis.browser ?? globalThis.chrome;

let timers = [];
let activeKind = 'stopwatch';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  swName: $('#sw-name'), swAdd: $('#sw-add'), swList: $('#sw-list'), swEmpty: $('#sw-empty'),
  cdName: $('#cd-name'), cdH: $('#cd-h'), cdM: $('#cd-m'), cdS: $('#cd-s'),
  cdSound: $('#cd-sound'), cdAdd: $('#cd-add'), cdError: $('#cd-error'),
  cdList: $('#cd-list'), cdEmpty: $('#cd-empty'),
  pmName: $('#pm-name'), pmWork: $('#pm-work'), pmBreak: $('#pm-break'), pmCycles: $('#pm-cycles'),
  pmSound: $('#pm-sound'), pmAdd: $('#pm-add'), pmError: $('#pm-error'),
  pmList: $('#pm-list'), pmEmpty: $('#pm-empty'),
};

async function load() {
  const stored = await api.storage.local.get('timers');
  timers = stored.timers || [];
}

async function save() {
  await api.storage.local.set({ timers });
  api.runtime.sendMessage({ type: 'dj-clock-ensure-engine' });
}

function byKind(kind) {
  return timers.filter((t) => t.type === kind).sort((a, b) => a.createdAt - b.createdAt);
}

function replaceTimer(next) {
  timers = timers.map((t) => (t.id === next.id ? next : t));
}

function removeTimer(id) {
  timers = timers.filter((t) => t.id !== id);
}

// ---- tabs ----

$$('.dj-seg[role="tab"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeKind = btn.dataset.kind;
    $$('.dj-seg[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== activeKind; });
  });
});

// ---- stopwatch ----

function renderStopwatchRow(t, now) {
  const row = document.createElement('div');
  row.className = 'entry-row';

  const head = document.createElement('div');
  head.className = 'entry-head';
  const name = document.createElement('span');
  name.className = 'entry-name';
  name.textContent = t.name;
  head.append(name);

  const time = document.createElement('div');
  time.className = 'entry-time mono';
  time.textContent = formatDuration(elapsedOf(t, now));

  const actions = document.createElement('div');
  actions.className = 'entry-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'mini-btn primary';
  toggleBtn.textContent = t.running ? 'Pause' : 'Start';
  toggleBtn.addEventListener('click', async () => {
    replaceTimer(t.running ? pauseTimer(t, Date.now()) : startTimer(t, Date.now()));
    await save();
    render();
  });

  const lapBtn = document.createElement('button');
  lapBtn.type = 'button';
  lapBtn.className = 'mini-btn';
  lapBtn.textContent = 'Lap';
  lapBtn.disabled = !t.running;
  lapBtn.addEventListener('click', async () => {
    replaceTimer(addLap(t, Date.now()));
    await save();
    render();
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'mini-btn';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', async () => {
    replaceTimer(resetTimer(t));
    await save();
    render();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mini-btn danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    removeTimer(t.id);
    await save();
    render();
  });

  actions.append(toggleBtn, lapBtn, resetBtn, deleteBtn);
  row.append(head, time, actions);

  if (t.laps.length) {
    const laps = document.createElement('div');
    laps.className = 'laps';
    for (const lap of [...t.laps].reverse()) {
      const lapRow = document.createElement('div');
      lapRow.className = 'lap-row';
      lapRow.innerHTML = `<span>Lap ${lap.n}</span><span>${formatDuration(lap.splitMs)} · ${formatDuration(lap.totalMs)}</span>`;
      laps.append(lapRow);
    }
    row.append(laps);
  }

  return row;
}

// ---- countdown ----

function renderCountdownRow(t, now) {
  const row = document.createElement('div');
  row.className = `entry-row${t.completed ? ' done' : ''}`;

  const head = document.createElement('div');
  head.className = 'entry-head';
  const name = document.createElement('span');
  name.className = 'entry-name';
  name.textContent = t.name;
  head.append(name);
  if (t.completed) {
    const badge = document.createElement('span');
    badge.className = 'entry-phase';
    badge.textContent = 'Done';
    head.append(badge);
  }

  const remaining = Math.max(0, remainingOf(t, now));
  const time = document.createElement('div');
  time.className = 'entry-time mono';
  time.textContent = formatDuration(remaining);

  const sub = document.createElement('div');
  sub.className = 'entry-sub';
  sub.textContent = `of ${formatDuration(t.durationMs)}${t.soundEnabled ? ' · 🔔' : ''}`;

  const actions = document.createElement('div');
  actions.className = 'entry-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'mini-btn primary';
  toggleBtn.textContent = t.running ? 'Pause' : 'Start';
  toggleBtn.disabled = t.completed;
  toggleBtn.addEventListener('click', async () => {
    replaceTimer(t.running ? pauseTimer(t, Date.now()) : startTimer(t, Date.now()));
    await save();
    render();
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'mini-btn';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', async () => {
    replaceTimer(resetTimer(t));
    await save();
    render();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mini-btn danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    removeTimer(t.id);
    await save();
    render();
  });

  actions.append(toggleBtn, resetBtn, deleteBtn);
  row.append(head, time, sub, actions);
  return row;
}

// ---- pomodoro ----

function renderPomodoroRow(t, now) {
  const row = document.createElement('div');
  row.className = `entry-row${t.completed ? ' done' : ''}`;

  const head = document.createElement('div');
  head.className = 'entry-head';
  const name = document.createElement('span');
  name.className = 'entry-name';
  name.textContent = t.name;
  const phase = document.createElement('span');
  phase.className = 'entry-phase';
  phase.textContent = t.completed ? 'Done' : t.phase;
  head.append(name, phase);

  const remaining = Math.max(0, remainingOf(t, now));
  const time = document.createElement('div');
  time.className = 'entry-time mono';
  time.textContent = formatDuration(remaining);

  const sub = document.createElement('div');
  sub.className = 'entry-sub';
  const cycleLabel = t.totalCycles ? `${t.cyclesCompleted}/${t.totalCycles} cycles` : `${t.cyclesCompleted} cycles`;
  sub.textContent = `${cycleLabel} · ${formatDuration(t.workMs)} work / ${formatDuration(t.breakMs)} break${t.soundEnabled ? ' · 🔔' : ''}`;

  const actions = document.createElement('div');
  actions.className = 'entry-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'mini-btn primary';
  toggleBtn.textContent = t.running ? 'Pause' : 'Start';
  toggleBtn.disabled = t.completed;
  toggleBtn.addEventListener('click', async () => {
    replaceTimer(t.running ? pauseTimer(t, Date.now()) : startTimer(t, Date.now()));
    await save();
    render();
  });

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'mini-btn';
  skipBtn.textContent = 'Skip phase';
  skipBtn.disabled = t.completed;
  skipBtn.addEventListener('click', async () => {
    replaceTimer(skipPhase(t, Date.now()));
    await save();
    render();
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'mini-btn';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', async () => {
    replaceTimer(resetTimer(t));
    await save();
    render();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mini-btn danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    removeTimer(t.id);
    await save();
    render();
  });

  actions.append(toggleBtn, skipBtn, resetBtn, deleteBtn);
  row.append(head, time, sub, actions);
  return row;
}

// ---- render ----

function render() {
  const now = Date.now();

  const stopwatches = byKind('stopwatch');
  els.swList.replaceChildren(...stopwatches.map((t) => renderStopwatchRow(t, now)));
  els.swEmpty.hidden = stopwatches.length !== 0;

  const countdowns = byKind('countdown');
  els.cdList.replaceChildren(...countdowns.map((t) => renderCountdownRow(t, now)));
  els.cdEmpty.hidden = countdowns.length !== 0;

  const pomodoros = byKind('pomodoro');
  els.pmList.replaceChildren(...pomodoros.map((t) => renderPomodoroRow(t, now)));
  els.pmEmpty.hidden = pomodoros.length !== 0;
}

// ---- add forms ----

els.swAdd.addEventListener('click', async () => {
  const name = els.swName.value.trim() || `Stopwatch ${byKind('stopwatch').length + 1}`;
  timers.push(createStopwatch(name));
  els.swName.value = '';
  await save();
  render();
});

function parseDurationMs(hEl, mEl, sEl) {
  const h = Number(hEl.value) || 0;
  const m = Number(mEl.value) || 0;
  const s = Number(sEl.value) || 0;
  return (h * 3600 + m * 60 + s) * 1000;
}

els.cdAdd.addEventListener('click', async () => {
  const durationMs = parseDurationMs(els.cdH, els.cdM, els.cdS);
  els.cdError.hidden = true;
  if (durationMs <= 0) {
    els.cdError.textContent = 'Set a duration greater than zero.';
    els.cdError.hidden = false;
    return;
  }
  const name = els.cdName.value.trim() || `Timer ${byKind('countdown').length + 1}`;
  timers.push(createCountdown(name, durationMs, els.cdSound.checked));
  els.cdName.value = '';
  els.cdH.value = '';
  els.cdM.value = '';
  els.cdS.value = '';
  await save();
  render();
});

els.pmAdd.addEventListener('click', async () => {
  const workMs = (Number(els.pmWork.value) || 0) * 60_000;
  const breakMs = (Number(els.pmBreak.value) || 0) * 60_000;
  const cycles = els.pmCycles.value.trim() ? Number(els.pmCycles.value) : null;
  els.pmError.hidden = true;
  if (workMs <= 0 || breakMs <= 0) {
    els.pmError.textContent = 'Set a work and break length greater than zero.';
    els.pmError.hidden = false;
    return;
  }
  const name = els.pmName.value.trim() || `Pomodoro ${byKind('pomodoro').length + 1}`;
  timers.push(createPomodoro(name, workMs, breakMs, cycles, els.pmSound.checked));
  els.pmName.value = '';
  els.pmCycles.value = '';
  await save();
  render();
});

// ---- live refresh + cross-context sync ----

function tickLocal() {
  const { timers: updated, changed } = stepTimers(timers, Date.now());
  timers = updated;
  render();
  if (changed) save();
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.timers) {
    timers = changes.timers.newValue || [];
    render();
  }
});

// ---- startup ----

await load();
render();
setInterval(tickLocal, 250);
