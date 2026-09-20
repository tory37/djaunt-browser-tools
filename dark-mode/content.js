(() => {
  const host = location.hostname;
  if (!host) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const { parseColor, isAlreadyDark, resolveApplied } = globalThis.__djauntDarkMode;

  const GLOBAL_KEY = "darkModeGlobal";
  const DOMAIN_KEY = "darkModeDomains";
  const DARK_CLASS = "djaunt-dark-mode";

  const CSS = `
    html.${DARK_CLASS} {
      background: #fff !important;
      filter: invert(1) hue-rotate(180deg) !important;
    }
    html.${DARK_CLASS} img,
    html.${DARK_CLASS} video,
    html.${DARK_CLASS} picture,
    html.${DARK_CLASS} canvas,
    html.${DARK_CLASS} iframe,
    html.${DARK_CLASS} svg image {
      filter: invert(1) hue-rotate(180deg) !important;
    }
  `;

  const style = document.createElement("style");
  style.id = "djaunt-dark-mode-style";
  style.textContent = CSS;
  document.documentElement.appendChild(style);

  let alreadyDark = null; // null until detected
  let applied = false;
  let detectionPromise = null;

  function setApplied(next) {
    applied = next;
    document.documentElement.classList.toggle(DARK_CLASS, applied);
    reportStatus();
  }

  function reportStatus() {
    api.runtime
      .sendMessage({ type: "darkModeStatus", host, applied, alreadyDark })
      .catch(() => {});
  }

  function detectAlreadyDark() {
    const candidates = [document.body, document.documentElement];
    for (const el of candidates) {
      if (!el) continue;
      const color = parseColor(getComputedStyle(el).backgroundColor);
      if (!color) continue;
      const dark = isAlreadyDark(color);
      if (dark !== null) return dark;
    }
    return false;
  }

  // Runs the background-color check once DOM content is available, and only
  // once per page load. Used both to show the reader the detected state and,
  // for the no-override case below, to decide whether to back off.
  function detectOnce() {
    if (!detectionPromise) {
      detectionPromise = new Promise((resolve) => {
        const run = () => {
          alreadyDark = detectAlreadyDark();
          resolve(alreadyDark);
        };
        if (document.body) run();
        else document.addEventListener("DOMContentLoaded", run, { once: true });
      });
    }
    return detectionPromise;
  }

  async function readSettings() {
    const [localStore, sessionStore] = await Promise.all([
      api.storage.local.get(GLOBAL_KEY),
      // Access can be denied for a moment right after install, before the
      // background script has widened storage.session to content scripts.
      api.storage.session.get(DOMAIN_KEY).catch(() => ({}))
    ]);
    return {
      globalEnabled: Boolean(localStore[GLOBAL_KEY]),
      override: (sessionStore[DOMAIN_KEY] || {})[host]
    };
  }

  async function evaluate() {
    const { globalEnabled, override } = await readSettings();
    setApplied(resolveApplied({ override, globalEnabled }));

    if (override || !globalEnabled) {
      detectOnce().then(reportStatus);
      return;
    }

    // No override, global is on: applied optimistically above to avoid a flash of
    // light content, then back off once we can tell the page is already dark.
    detectOnce().then((dark) => {
      if (dark) setApplied(false);
      else reportStatus();
    });
  }

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && GLOBAL_KEY in changes) evaluate();
    if (areaName === "session" && DOMAIN_KEY in changes) evaluate();
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "getStatus") {
      sendResponse({ host, applied, alreadyDark });
      return true;
    }
    return false;
  });

  evaluate();
})();
