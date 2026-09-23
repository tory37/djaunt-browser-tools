// Runs only inside the Chrome offscreen document created by background.js. A hidden
// document has a real DOM, so setInterval keeps firing every second even while the
// service worker itself would be suspended — that's the whole reason this file exists.
// It is the sole authority for ticking while it's alive: it reads/writes the timers in
// storage and plays alert sounds directly, then just hands the computed badge text and
// color to the service worker, which is the only context allowed to paint the toolbar
// icon.
import { stepTimers, selectPriorityTimer, formatBadge, BADGE_COLORS } from './clock.js';

const api = globalThis.browser ?? globalThis.chrome;

async function loadTimers() {
  const stored = await api.storage.local.get('timers');
  return stored.timers || [];
}

async function saveTimers(timers) {
  await api.storage.local.set({ timers });
}

function playBeep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.25);
  osc.onended = () => ctx.close();
}

function computeBadge(timers, now) {
  const sel = selectPriorityTimer(timers, now);
  if (!sel) return { text: '', color: BADGE_COLORS.idle };
  return { text: formatBadge(sel.ms), color: BADGE_COLORS[sel.mode] || BADGE_COLORS.idle };
}

async function tick() {
  const timers = await loadTimers();
  const now = Date.now();
  const { timers: updated, alerts, changed } = stepTimers(timers, now);
  if (changed) await saveTimers(updated);
  if (alerts.some((a) => a.playSound)) playBeep();

  const badge = computeBadge(updated, now);
  api.runtime.sendMessage({
    type: 'dj-clock-badge', text: badge.text, color: badge.color, alerted: alerts.length > 0,
  });

  if (!updated.some((t) => t.running)) {
    clearInterval(intervalId);
    api.offscreen.closeDocument();
  }
}

const intervalId = setInterval(tick, 1000);
tick();
