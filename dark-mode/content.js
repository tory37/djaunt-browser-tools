(() => {
  const host = location.hostname;
  if (!host) return;

  const GLOBAL_KEY = "darkModeGlobal";
  const DOMAIN_KEY = "darkModeDomains";
  const DARK_CLASS = "djaunt-dark-mode";
  const ALREADY_DARK_THRESHOLD = 0.4;

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
    browser.runtime
      .sendMessage({ type: "darkModeStatus", host, applied, alreadyDark })
      .catch(() => {});
  }

  function relativeLuminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function detectAlreadyDark() {
    const candidates = [document.body, document.documentElement];
    for (const el of candidates) {
      if (!el) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const match = bg.match(/rgba?\(([^)]+)\)/);
      if (!match) continue;
      const parts = match[1].split(",").map((part) => parseFloat(part));
      const [r, g, b, a = 1] = parts;
      if (a === 0) continue;
      return relativeLuminance(r, g, b) < ALREADY_DARK_THRESHOLD;
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
      browser.storage.local.get(GLOBAL_KEY),
      // Access can be denied for a moment right after install, before the
      // background script has widened storage.session to content scripts.
      browser.storage.session.get(DOMAIN_KEY).catch(() => ({}))
    ]);
    return {
      globalEnabled: Boolean(localStore[GLOBAL_KEY]),
      override: (sessionStore[DOMAIN_KEY] || {})[host]
    };
  }

  async function evaluate() {
    const { globalEnabled, override } = await readSettings();

    if (override === "on") {
      setApplied(true);
      detectOnce().then(reportStatus);
      return;
    }
    if (override === "off") {
      setApplied(false);
      detectOnce().then(reportStatus);
      return;
    }
    if (!globalEnabled) {
      setApplied(false);
      detectOnce().then(reportStatus);
      return;
    }

    // No override, global is on: apply right away to avoid a flash of light
    // content, then back off once we can tell the page is already dark.
    setApplied(true);
    detectOnce().then((dark) => {
      if (dark) setApplied(false);
      else reportStatus();
    });
  }

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && GLOBAL_KEY in changes) evaluate();
    if (areaName === "session" && DOMAIN_KEY in changes) evaluate();
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "getStatus") {
      sendResponse({ host, applied, alreadyDark });
      return true;
    }
    return false;
  });

  evaluate();
})();
