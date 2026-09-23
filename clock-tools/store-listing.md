# Chrome Web Store listing — Djaunt Clock Tools

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Clock Tools
- **Summary** (132 char max): Stopwatches, countdown timers and Pomodoro cycles, with the soonest one due shown live on the toolbar icon.
- **Category**: Productivity
- **Language**: English (United States)
- **Description**:

  Stopwatches, countdown timers and Pomodoro work/break cycles — the things a plain
  system clock doesn't do — all from the toolbar.

  Run as many of each as you like. Name a stopwatch and record laps, set a timer for
  minutes/hours/seconds with an optional alert beep, or set up a Pomodoro cycle that
  auto-advances between work and break. Everything keeps running after you close the
  popup, and the toolbar badge always shows whichever one is soonest to finish (or the
  newest stopwatch's elapsed time, if nothing's counting down) — glance at the icon,
  no need to open the popup.

  - No page access at all — this extension never reads or touches anything on the
    pages you visit. It only needs permission to remember your timers and to keep
    ticking in the background.
  - Badge flashes when a timer or Pomodoro phase finishes; check the box for a sound
    alert too.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/clock-tools

- **Icon**: `icons/icon128.png`
- **Screenshot(s)**: `store-assets/popup.png` (run `npm run store:screenshots`
  to generate).

## Privacy practices tab

- **Single purpose**: Runs stopwatches, countdown timers and Pomodoro work/break
  cycles, showing the most urgent one on the toolbar badge.
- **Permission justifications**:
  - `storage` — saves your stopwatches, timers and Pomodoro cycles locally so they
    survive closing the popup, closing the browser, or a browser restart.
  - `alarms` — a once-a-minute check that re-creates the ticking engine and toolbar
    badge if the browser was restarted or the extension's background process was
    evicted while a timer was running.
  - `offscreen` — (Chrome only) runs the second-by-second badge updates and plays the
    alert sound from a hidden page, since Chrome's service worker is suspended after
    about 30 seconds idle and can do neither on its own.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
