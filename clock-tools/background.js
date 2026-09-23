import { stepTimers, selectPriorityTimer, formatBadge, BADGE_COLORS } from './clock.js';

const api = globalThis.browser ?? globalThis.chrome;

// Firefox has no chrome.offscreen API, but its MV3 background script (unlike Chrome's
// service worker) stays loaded for as long as the browser runs, so a plain setInterval
// here works fine as the fallback path. Chrome's service worker gets suspended after
// ~30s idle, which is what the offscreen document exists to work around.
const HAS_OFFSCREEN = Boolean(api.offscreen);

const HEARTBEAT_ALARM = 'dj-clock-heartbeat';
const FLASH_MS = 400;
const FLASH_STEPS = 6;

let localInterval = null;
let flashTimer = null;

async function loadTimers() {
  const stored = await api.storage.local.get('timers');
  return stored.timers || [];
}

async function saveTimers(timers) {
  await api.storage.local.set({ timers });
}

async function applyBadge(text, color) {
  await api.action.setBadgeText({ text });
  if (!flashTimer) await api.action.setBadgeBackgroundColor({ color });
}

function flashBadge(color) {
  clearTimeout(flashTimer);
  let on = true;
  let stepsLeft = FLASH_STEPS;
  const step = () => {
    api.action.setBadgeBackgroundColor({ color: on ? color : BADGE_COLORS.idle });
    on = !on;
    stepsLeft -= 1;
    flashTimer = stepsLeft > 0 ? setTimeout(step, FLASH_MS) : null;
  };
  step();
}

// Only reachable on the Firefox fallback path, where this script is a real DOM
// document — Chrome's service worker has no Audio/AudioContext, which is exactly why
// the offscreen document (below) exists to play the sound there instead.
function playBeep() {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
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

async function runLocalTick() {
  const timers = await loadTimers();
  const now = Date.now();
  const { timers: updated, alerts, changed } = stepTimers(timers, now);
  if (changed) await saveTimers(updated);
  if (alerts.length) {
    flashBadge('#e0473e');
    if (alerts.some((a) => a.playSound)) playBeep();
  }
  const badge = computeBadge(updated, now);
  await applyBadge(badge.text, badge.color);
  if (!updated.some((t) => t.running)) await stopEngine();
}

function startLocalInterval() {
  if (localInterval) return;
  localInterval = setInterval(runLocalTick, 1000);
  runLocalTick();
}

async function ensureOffscreenDocument() {
  const has = await api.offscreen.hasDocument();
  if (has) return;
  await api.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Ticks running stopwatches/timers every second for the toolbar badge '
      + 'and plays an alert sound when one finishes, neither of which the service '
      + 'worker can do while suspended.',
  });
}

async function stopEngine() {
  if (localInterval) {
    clearInterval(localInterval);
    localInterval = null;
  }
  if (HAS_OFFSCREEN && await api.offscreen.hasDocument()) {
    await api.offscreen.closeDocument();
  }
  await api.alarms.clear(HEARTBEAT_ALARM);
  clearTimeout(flashTimer);
  flashTimer = null;
  await api.action.setBadgeText({ text: '' });
}

async function ensureEngine() {
  const timers = await loadTimers();
  if (!timers.some((t) => t.running)) {
    await stopEngine();
    return;
  }
  await api.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  if (HAS_OFFSCREEN) {
    await ensureOffscreenDocument();
  } else {
    startLocalInterval();
  }
}

api.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'dj-clock-ensure-engine') {
    ensureEngine();
  } else if (message.type === 'dj-clock-badge') {
    // Sent by offscreen.js, which owns the actual ticking/storage/sound on Chrome —
    // the service worker here only has permission to touch the toolbar icon.
    applyBadge(message.text, message.color);
    if (message.alerted) flashBadge('#e0473e');
  }
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return;
  if (HAS_OFFSCREEN) ensureEngine();
  else runLocalTick();
});

api.runtime.onStartup?.addListener(ensureEngine);
api.runtime.onInstalled?.addListener(ensureEngine);
ensureEngine();
