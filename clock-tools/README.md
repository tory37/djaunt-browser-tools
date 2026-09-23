# Djaunt Clock Tools

A Chrome & Firefox extension (Manifest V3) with stopwatches, countdown timers and
Pomodoro work/break cycles — the things a plain system clock doesn't do. Run as many of
each as you like; the toolbar icon always shows whichever one is soonest to finish (or,
if nothing's counting down, the most recently started stopwatch), so you can glance at
it without opening the popup.

## Install

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension so the toolbar button — and its badge — stay visible.

**Firefox** (121+, for this manifest's dual background key):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select this folder's `manifest.json`.

This load is temporary — Firefox drops it on restart, so reload it the same way after a
`git pull`. For a load that survives restarts, package the folder with
[`web-ext`](https://github.com/mozilla/web-ext) and sign it, or run it in a channel that
allows unsigned extensions (Nightly/ESR with `xpinstall.signatures.required` off in
`about:config`).

## Use

Click the toolbar icon and pick a tab:

- **Stopwatch** — name it (or leave it blank for an auto-numbered one), **Start**, and
  **Lap** while it runs to record splits. **Reset** clears it back to zero.
- **Timer** — set hours/minutes/seconds, optionally tick **Sound** for an alert beep
  when it finishes, then **Start**. It counts down and marks itself **Done** at zero.
- **Pomodoro** — set work and break lengths in minutes and, optionally, a number of
  cycles (leave it blank to run forever). **Start** begins the work phase; it
  auto-advances into breaks and back, and **Skip phase** jumps ahead early if you're
  done before the clock is.

All three keep running in the background after you close the popup — reopen it any time
to see current state, add another, or stop one.

**The toolbar badge shows one live number**, updated roughly every second: whichever
countdown timer or Pomodoro phase is soonest to finish, or — if none is running — the
most recently started stopwatch's elapsed time. When a timer or phase finishes, the
badge flashes red for a few seconds; timers with **Sound** checked also play a short
beep.

## How it works

- **No page access at all.** Unlike most of this repo's extensions, Clock Tools never
  touches a tab — it only needs `storage` (to remember your timers), `alarms` (a
  once-a-minute safety net that resurrects the badge/ticking after a browser restart or
  an evicted service worker) and `offscreen` (Chrome only, see below).
- **The pure timing/scheduling logic lives in `clock.js`** — creating, starting,
  pausing, resetting and stepping timers forward, and picking which one the badge
  should show. It has no DOM and no extension APIs, so `test.mjs` covers it directly
  under Node; `popup.js`, `background.js` and `offscreen.js` all import the same
  functions instead of re-implementing any of this.
- **Chrome's service worker gets suspended after ~30 seconds idle**, which would stop
  any `setInterval` used to tick the badge once the popup was closed. `background.js`
  works around that by creating a Chrome **offscreen document** (`offscreen.html`/`.js`)
  whenever a timer is running — a hidden page with a real DOM that keeps ticking every
  second, recomputes the badge, updates storage, and plays the alert sound directly
  (the service worker itself has no `Audio`/`AudioContext` to play one). It closes
  itself once nothing is left running.
- **Firefox has no offscreen-document API**, but its MV3 background script (the
  `scripts` key) stays loaded for as long as the browser runs, unlike Chrome's service
  worker — so on Firefox, `background.js` just runs the same tick loop with a plain
  `setInterval` directly, feature-detected via `Boolean(api.offscreen)`. Same files,
  same folder, no separate build — it just takes the path each browser actually
  supports.
- **The popup keeps its own lightweight 250ms refresh loop** purely for a smooth
  display while it's open, using the same `stepTimers` function; it also listens for
  `storage.onChanged` so a phase change or completion detected by the background engine
  while the popup is open updates the list immediately instead of waiting for the next
  local tick.

## Limits

- **The badge can only show one timer at a time.** With several running at once, it
  always shows the single most urgent one (soonest countdown/Pomodoro phase, or else the
  newest stopwatch) — open the popup to see everything.
- **Sub-second precision isn't guaranteed.** Both the Chrome offscreen document and the
  Firefox background script tick on a 1-second `setInterval`, so times can be briefly
  off by up to a second, especially right after the computer wakes from sleep. The
  once-a-minute `alarms` heartbeat re-syncs everything from stored timestamps, so this
  never compounds — it's always accurate as of the last tick, never drifting further.
- **No system notification, only the badge and an in-popup beep.** There's no OS-level
  notification when something finishes, so if the browser window isn't visible you
  could miss the moment it happens (though the flashing badge stays until you look).

## Permissions

`storage`, `alarms` and `offscreen` — no `host_permissions`, no `activeTab`, no
`scripting`, no access to any web page's content at all. `offscreen` only does anything
on Chrome; Firefox ignores it and ticks from its background script directly instead.

## Tests

`test.mjs` covers `clock.js`: creating each timer type, starting/pausing/resetting,
lap recording, countdown and Pomodoro completion (including rolling through more than
one phase change in a single tick after time lost to suspension), phase-skipping, and
badge-priority selection.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
