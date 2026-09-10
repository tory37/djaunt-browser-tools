# Tab Volume

Chrome extension (Manifest V3) that sets the volume of each tab from 0 to 100 percent
of the system volume, with an option to save that level for every tab on the domain.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Use

- Click the toolbar icon to open the popup for the active tab.
- Drag the slider, or click a preset (0 / 25 / 50 / 100).
- Turn on **Keep for this domain** to save the level for every tab on that hostname.
- **Reset** clears both the tab level and the saved domain level, back to 100 percent.
- The toolbar badge shows the percentage whenever a tab is below 100.

## Scope rules

- A level set on a single tab wins over the saved domain level.
- Turning on the domain toggle drops the per-tab level so the domain value applies.
- Turning it off keeps the current level, but only for the tab you are on.
- Per-tab levels last until the tab closes or the browser restarts.
  Domain levels persist in `chrome.storage.local`.

## How it works

- `content/audio.js` runs in the page's own world. It wraps
  `HTMLMediaElement.prototype.volume` so the page keeps reading the volume it asked
  for while the element plays at `page volume x tab level`. It also puts a
  `GainNode` in front of every `AudioContext` destination, which covers sites that
  play sound through the Web Audio API instead of a media element.
- `content/bridge.js` runs in the isolated world and passes the level from the
  service worker to the page world through a `CustomEvent`.
- `background.js` resolves the level for a tab, stores it, updates the badge, and
  pushes changes to every tab on a domain when the domain level changes.

This attenuates only — it never boosts above the system volume, so no tab capture
permission is needed and audio stays on the tab's normal output path.

## Limits

- Chrome pages (`chrome://`, the Web Store, the built-in PDF viewer) block content
  scripts, so their volume cannot change.
- Cross-origin iframes are covered, since the content scripts run in all frames.
- DRM/EME playback that ignores the `volume` property is not affected.
