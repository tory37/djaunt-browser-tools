import assert from 'node:assert/strict';
import {
  createStopwatch, createCountdown, createPomodoro, elapsedOf, remainingOf,
  startTimer, pauseTimer, resetTimer, addLap, skipPhase, stepTimers,
  selectPriorityTimer, formatBadge, formatDuration,
} from './clock.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

// ---- formatBadge / formatDuration ----

check('formatBadge: under a minute', () => {
  assert.equal(formatBadge(45_000), '0:45');
});

check('formatBadge: minutes and seconds', () => {
  assert.equal(formatBadge(125_000), '2:05');
});

check('formatBadge: hours drop the seconds', () => {
  assert.equal(formatBadge(2 * 3600_000 + 15 * 60_000), '2:15');
});

check('formatBadge: negative clamps to zero', () => {
  assert.equal(formatBadge(-500), '0:00');
});

check('formatDuration: includes hours when present', () => {
  assert.equal(formatDuration(3661_000), '1:01:01');
});

check('formatDuration: no hours when under one', () => {
  assert.equal(formatDuration(61_000), '1:01');
});

// ---- stopwatch ----

check('createStopwatch: starts at zero, paused', () => {
  const sw = createStopwatch('Test');
  assert.equal(sw.type, 'stopwatch');
  assert.equal(sw.running, false);
  assert.equal(elapsedOf(sw, Date.now()), 0);
});

check('startTimer/pauseTimer: stopwatch accumulates elapsed time', () => {
  let sw = createStopwatch('Test');
  sw = startTimer(sw, 1000);
  assert.equal(elapsedOf(sw, 1500), 500);
  sw = pauseTimer(sw, 1500);
  assert.equal(sw.running, false);
  assert.equal(sw.accumulatedMs, 500);
  sw = startTimer(sw, 2000);
  assert.equal(elapsedOf(sw, 2300), 800);
});

check('pauseTimer: no-op on an already-paused timer', () => {
  const sw = createStopwatch('Test');
  assert.equal(pauseTimer(sw, 1000), sw);
});

check('startTimer: no-op on an already-running timer', () => {
  const sw = startTimer(createStopwatch('Test'), 1000);
  assert.equal(startTimer(sw, 5000), sw);
});

check('resetTimer: stopwatch clears elapsed time and laps', () => {
  let sw = startTimer(createStopwatch('Test'), 0);
  sw = addLap(sw, 1000);
  sw = resetTimer(sw);
  assert.equal(sw.accumulatedMs, 0);
  assert.equal(sw.running, false);
  assert.deepEqual(sw.laps, []);
});

check('addLap: records split and total time', () => {
  let sw = startTimer(createStopwatch('Test'), 0);
  sw = addLap(sw, 1000);
  sw = addLap(sw, 2500);
  assert.deepEqual(sw.laps, [
    { n: 1, totalMs: 1000, splitMs: 1000 },
    { n: 2, totalMs: 2500, splitMs: 1500 },
  ]);
});

check('addLap: ignored while paused', () => {
  const sw = createStopwatch('Test');
  assert.equal(addLap(sw, 1000), sw);
});

// ---- countdown ----

check('createCountdown: full duration remaining, paused', () => {
  const cd = createCountdown('Brew', 60_000);
  assert.equal(remainingOf(cd, Date.now()), 60_000);
  assert.equal(cd.running, false);
});

check('countdown: remaining decreases while running', () => {
  let cd = createCountdown('Brew', 60_000);
  cd = startTimer(cd, 1000);
  assert.equal(remainingOf(cd, 21_000), 40_000);
});

check('stepTimers: countdown completes and raises an alert', () => {
  let cd = createCountdown('Brew', 10_000, true);
  cd = startTimer(cd, 0);
  const { timers, alerts, changed } = stepTimers([cd], 10_500);
  assert.equal(changed, true);
  assert.equal(timers[0].running, false);
  assert.equal(timers[0].completed, true);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'countdown-done');
  assert.equal(alerts[0].playSound, true);
});

check('stepTimers: does not re-alert a completed countdown on the next tick', () => {
  let cd = createCountdown('Brew', 10_000);
  cd = startTimer(cd, 0);
  ({ timers: [cd] } = stepTimers([cd], 10_500));
  const { alerts, changed } = stepTimers([cd], 11_500);
  assert.equal(alerts.length, 0);
  assert.equal(changed, false);
});

check('stepTimers: paused countdown is left alone', () => {
  const cd = createCountdown('Brew', 10_000);
  const { timers, changed } = stepTimers([cd], 999_999);
  assert.equal(changed, false);
  assert.equal(timers[0], cd);
});

check('resetTimer: countdown restores full duration', () => {
  let cd = createCountdown('Brew', 10_000);
  cd = startTimer(cd, 0);
  ({ timers: [cd] } = stepTimers([cd], 10_500));
  cd = resetTimer(cd);
  assert.equal(cd.completed, false);
  assert.equal(cd.remainingAtStartMs, 10_000);
});

// ---- pomodoro ----

check('createPomodoro: starts on the work phase for the full work duration', () => {
  const pomo = createPomodoro('Focus', 25 * 60_000, 5 * 60_000, 4);
  assert.equal(pomo.phase, 'work');
  assert.equal(remainingOf(pomo, Date.now()), 25 * 60_000);
});

check('stepTimers: pomodoro rolls from work into break', () => {
  let pomo = createPomodoro('Focus', 1000, 500, 2);
  pomo = startTimer(pomo, 0);
  const { timers, alerts } = stepTimers([pomo], 1200);
  assert.equal(timers[0].phase, 'break');
  assert.equal(timers[0].running, true);
  assert.equal(timers[0].cyclesCompleted, 1);
  // 1200ms in on a 1000ms work phase overshoots by 200ms, which carries into the
  // break phase's remaining time instead of being dropped.
  assert.equal(remainingOf(timers[0], 1200), 300);
  assert.equal(alerts[0].kind, 'pomodoro-break');
});

check('stepTimers: pomodoro rolls from break back into work', () => {
  let pomo = createPomodoro('Focus', 1000, 500, 2);
  pomo = { ...pomo, phase: 'break', remainingAtStartMs: 500 };
  pomo = startTimer(pomo, 0);
  const { timers, alerts } = stepTimers([pomo], 600);
  assert.equal(timers[0].phase, 'work');
  assert.equal(alerts[0].kind, 'pomodoro-work');
});

check('stepTimers: pomodoro stops and completes after its last work phase', () => {
  let pomo = createPomodoro('Focus', 1000, 500, 1);
  pomo = startTimer(pomo, 0);
  const { timers, alerts } = stepTimers([pomo], 1200);
  assert.equal(timers[0].running, false);
  assert.equal(timers[0].completed, true);
  assert.equal(timers[0].cyclesCompleted, 1);
  assert.equal(alerts[0].kind, 'pomodoro-complete');
});

check('stepTimers: pomodoro can roll through multiple phases in one tick', () => {
  let pomo = createPomodoro('Focus', 100, 100, 5);
  pomo = startTimer(pomo, 0);
  const { timers, alerts } = stepTimers([pomo], 250);
  assert.equal(alerts.length, 2);
  assert.equal(timers[0].phase, 'work');
  assert.equal(timers[0].cyclesCompleted, 1);
});

check('skipPhase: jumps straight to the next phase while running', () => {
  let pomo = createPomodoro('Focus', 1000, 500, 3);
  pomo = startTimer(pomo, 0);
  pomo = skipPhase(pomo, 300);
  assert.equal(pomo.phase, 'break');
  assert.equal(pomo.startedAt, 300);
  assert.equal(remainingOf(pomo, 300), 500);
});

check('skipPhase: works while paused without setting startedAt', () => {
  const pomo = createPomodoro('Focus', 1000, 500, 3);
  const next = skipPhase(pomo, 300);
  assert.equal(next.phase, 'break');
  assert.equal(next.startedAt, null);
  assert.equal(next.running, false);
});

check('skipPhase: on a non-pomodoro timer is a no-op', () => {
  const sw = createStopwatch('Test');
  assert.equal(skipPhase(sw, 1000), sw);
});

check('resetTimer: pomodoro returns to work phase, cycle zero', () => {
  let pomo = createPomodoro('Focus', 1000, 500, 2);
  pomo = startTimer(pomo, 0);
  ({ timers: [pomo] } = stepTimers([pomo], 1200));
  pomo = resetTimer(pomo);
  assert.equal(pomo.phase, 'work');
  assert.equal(pomo.cyclesCompleted, 0);
  assert.equal(pomo.completed, false);
});

// ---- selectPriorityTimer ----

check('selectPriorityTimer: prefers the countdown soonest to finish', () => {
  const soon = startTimer(createCountdown('Soon', 5000), 0);
  const later = startTimer(createCountdown('Later', 50_000), 0);
  const sel = selectPriorityTimer([later, soon], 0);
  assert.equal(sel.timer.name, 'Soon');
  assert.equal(sel.mode, 'countdown');
});

check('selectPriorityTimer: a running countdown outranks a running stopwatch', () => {
  const cd = startTimer(createCountdown('Brew', 5000), 0);
  const sw = startTimer(createStopwatch('Watch'), 0);
  const sel = selectPriorityTimer([sw, cd], 0);
  assert.equal(sel.timer.name, 'Brew');
});

check('selectPriorityTimer: falls back to the most recently started stopwatch', () => {
  const first = startTimer(createStopwatch('First'), 0);
  const second = startTimer(createStopwatch('Second'), 500);
  const sel = selectPriorityTimer([first, second], 1000);
  assert.equal(sel.timer.name, 'Second');
  assert.equal(sel.mode, 'stopwatch');
});

check('selectPriorityTimer: pomodoro mode reflects the current phase', () => {
  let pomo = createPomodoro('Focus', 1000, 500, 2);
  pomo = { ...pomo, phase: 'break', remainingAtStartMs: 500 };
  pomo = startTimer(pomo, 0);
  const sel = selectPriorityTimer([pomo], 0);
  assert.equal(sel.mode, 'pomodoro-break');
});

check('selectPriorityTimer: null when nothing is running', () => {
  const sel = selectPriorityTimer([createStopwatch('Idle'), createCountdown('Idle2', 1000)], 0);
  assert.equal(sel, null);
});

console.log(`${passed + failed} assertions, ${failed} failed`);
if (failed > 0) process.exit(1);
