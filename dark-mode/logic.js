/**
 * The pure color-math and settings-resolution logic for Dark Mode, in the form both
 * worlds can load.
 *
 * This file declares no imports and no exports on purpose: it is legal as a classic
 * content script (where it seeds a global for `content.js`, loaded right after it) and
 * as an ES module (where `test.mjs` imports it for the same global). That keeps one
 * copy of the logic without adding a build step. See `net-mock/wire.js` for the same
 * pattern.
 */

(() => {
  const ALREADY_DARK_THRESHOLD = 0.4;

  function relativeLuminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  /** Parses a computed-style color string; returns null if it isn't rgb()/rgba(). */
  function parseColor(raw) {
    const match = String(raw ?? '').match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => parseFloat(part));
    const [r, g, b, a = 1] = parts;
    if ([r, g, b].some((value) => Number.isNaN(value))) return null;
    return { r, g, b, a };
  }

  /** A fully transparent color has no visible shade, so it can't be called dark or light. */
  function isAlreadyDark({ r, g, b, a }) {
    if (a === 0) return null;
    return relativeLuminance(r, g, b) < ALREADY_DARK_THRESHOLD;
  }

  /**
   * Whether dark mode should be applied given the domain override and the global
   * switch — before any "is this page already dark" detection runs. `resolveApplied`
   * returning true when there's no override is optimistic (applied right away to avoid
   * a flash of light content); the caller backs off once detection resolves.
   */
  function resolveApplied({ override, globalEnabled }) {
    if (override === 'on') return true;
    if (override === 'off') return false;
    return Boolean(globalEnabled);
  }

  globalThis.__djauntDarkMode = {
    ALREADY_DARK_THRESHOLD, relativeLuminance, parseColor, isAlreadyDark, resolveApplied,
  };
})();
