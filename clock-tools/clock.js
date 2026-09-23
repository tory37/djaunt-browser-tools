// Pure helpers for Clock Tools — no DOM, no extension APIs, so this file can be
// unit-tested directly under Node and shared by popup.js, background.js and
// offscreen.js. Every timer is a plain object; every transition here returns a new
// object rather than mutating, so callers can diff old vs. new to know what to persist.

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStopwatch(name) {
  return {
    id: makeId(), type: 'stopwatch', name, running: false, startedAt: null,
    accumulatedMs: 0, laps: [], createdAt: Date.now(),
  };
}

export function createCountdown(name, durationMs, soundEnabled = false) {
  return {
    id: makeId(), type: 'countdown', name, running: false, completed: false,
    durationMs, remainingAtStartMs: durationMs, startedAt: null, soundEnabled,
    createdAt: Date.now(),
  };
}

export function createPomodoro(name, workMs, breakMs, totalCycles, soundEnabled = false) {
  return {
    id: makeId(), type: 'pomodoro', name, running: false, completed: false,
    phase: 'work', workMs, breakMs, totalCycles: totalCycles || null, cyclesCompleted: 0,
    remainingAtStartMs: workMs, startedAt: null, soundEnabled, createdAt: Date.now(),
  };
}

export function elapsedOf(t, now) {
  return t.accumulatedMs + (t.running ? now - t.startedAt : 0);
}

export function remainingOf(t, now) {
  const elapsed = t.running ? now - t.startedAt : 0;
  return t.remainingAtStartMs - elapsed;
}

export function startTimer(t, now) {
  if (t.running) return t;
  return { ...t, running: true, startedAt: now, completed: false };
}

export function pauseTimer(t, now) {
  if (!t.running) return t;
  if (t.type === 'stopwatch') {
    return { ...t, running: false, startedAt: null, accumulatedMs: elapsedOf(t, now) };
  }
  return { ...t, running: false, startedAt: null, remainingAtStartMs: remainingOf(t, now) };
}

export function resetTimer(t) {
  if (t.type === 'stopwatch') {
    return { ...t, running: false, startedAt: null, accumulatedMs: 0, laps: [] };
  }
  if (t.type === 'countdown') {
    return {
      ...t, running: false, completed: false, startedAt: null, remainingAtStartMs: t.durationMs,
    };
  }
  return {
    ...t, running: false, completed: false, startedAt: null, phase: 'work',
    cyclesCompleted: 0, remainingAtStartMs: t.workMs,
  };
}

export function addLap(t, now) {
  if (t.type !== 'stopwatch' || !t.running) return t;
  const totalMs = elapsedOf(t, now);
  const prevTotal = t.laps.length ? t.laps[t.laps.length - 1].totalMs : 0;
  const lap = { n: t.laps.length + 1, totalMs, splitMs: totalMs - prevTotal };
  return { ...t, laps: [...t.laps, lap] };
}

function advancePhase(t, now) {
  // Carry over any overshoot past zero (the service worker woke up late, or several
  // short phases elapsed since the last tick) so stepTimers' loop can roll through
  // more than one phase change in a single call instead of losing that time.
  const overshoot = t.running ? Math.max(0, -remainingOf(t, now)) : 0;
  const finishedWork = t.phase === 'work';
  const nextPhase = finishedWork ? 'break' : 'work';
  const cyclesCompleted = t.cyclesCompleted + (finishedWork ? 1 : 0);
  const reachedLimit = finishedWork && t.totalCycles != null && cyclesCompleted >= t.totalCycles;
  if (reachedLimit) {
    return {
      ...t, running: false, completed: true, startedAt: null, cyclesCompleted, remainingAtStartMs: 0,
    };
  }
  const nextDuration = nextPhase === 'work' ? t.workMs : t.breakMs;
  return {
    ...t, phase: nextPhase, cyclesCompleted, remainingAtStartMs: nextDuration,
    startedAt: t.running ? now - overshoot : null,
  };
}

export function skipPhase(t, now) {
  if (t.type !== 'pomodoro') return t;
  return advancePhase(t, now);
}

// Advances every running countdown/pomodoro whose time is up. Stopwatches never
// auto-complete. Returns the updated list, whether anything changed (so callers can
// skip an unnecessary storage write), and any alerts newly raised this call (a timer
// finishing, or a pomodoro phase changing) for the caller to flash the badge / play a
// sound for.
export function stepTimers(timers, now) {
  const alerts = [];
  const updated = timers.map((t) => {
    if (!t.running) return t;
    if (t.type === 'countdown') {
      if (remainingOf(t, now) > 0) return t;
      alerts.push({ id: t.id, name: t.name, kind: 'countdown-done', playSound: Boolean(t.soundEnabled) });
      return { ...t, running: false, completed: true, startedAt: null, remainingAtStartMs: 0 };
    }
    if (t.type === 'pomodoro') {
      let next = t;
      let guard = 0;
      while (next.running && remainingOf(next, now) <= 0 && guard < 20) {
        next = advancePhase(next, now);
        alerts.push({
          id: next.id, name: next.name, playSound: Boolean(next.soundEnabled),
          kind: next.completed ? 'pomodoro-complete' : `pomodoro-${next.phase}`,
        });
        guard += 1;
      }
      return next;
    }
    return t;
  });
  const changed = updated.some((t, i) => t !== timers[i]);
  return { timers: updated, alerts, changed };
}

export const BADGE_COLORS = {
  countdown: '#d4a017',
  'pomodoro-work': '#d4a017',
  'pomodoro-break': '#4a90d9',
  stopwatch: '#8a8f9c',
  idle: '#3a3f4a',
};

// Picks which running timer the toolbar badge should reflect: the time-boxed timer
// (countdown/pomodoro) soonest to finish takes priority over any stopwatch, since a
// stopwatch never "runs out" and finishing is the more actionable thing to surface.
export function selectPriorityTimer(timers, now) {
  const boxed = timers.filter((t) => t.running && (t.type === 'countdown' || t.type === 'pomodoro'));
  if (boxed.length) {
    boxed.sort((a, b) => remainingOf(a, now) - remainingOf(b, now));
    const t = boxed[0];
    return {
      timer: t, ms: Math.max(0, remainingOf(t, now)),
      mode: t.type === 'pomodoro' ? `pomodoro-${t.phase}` : 'countdown',
    };
  }
  const watches = timers.filter((t) => t.type === 'stopwatch' && t.running);
  if (watches.length) {
    watches.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const t = watches[0];
    return { timer: t, ms: elapsedOf(t, now), mode: 'stopwatch' };
  }
  return null;
}

export function formatBadge(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
