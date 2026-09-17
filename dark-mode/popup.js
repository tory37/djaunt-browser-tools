const api = globalThis.browser ?? globalThis.chrome;

const GLOBAL_KEY = "darkModeGlobal";
const DOMAIN_KEY = "darkModeDomains";

const elements = {
  body: document.body,
  head: document.getElementById("head"),
  pill: document.getElementById("pill"),
  host: document.getElementById("host"),
  detected: document.getElementById("detected"),
  global: document.getElementById("global"),
  overrideHost: document.getElementById("override-host"),
  segmented: document.getElementById("segmented"),
  applied: document.getElementById("applied"),
  unsupported: document.getElementById("unsupported")
};

let activeTab = null;
let activeHost = null;

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname
      : null;
  } catch (error) {
    return null;
  }
}

async function getStatus(tabId) {
  try {
    return await api.tabs.sendMessage(tabId, { type: "getStatus" });
  } catch (error) {
    return null;
  }
}

function renderDetected(status) {
  if (!status || status.alreadyDark === null || status.alreadyDark === undefined) {
    elements.detected.textContent = "";
    return;
  }
  elements.detected.textContent = status.alreadyDark
    ? "This page already looks dark"
    : "This page looks light";
}

function renderApplied(status) {
  const isApplied = Boolean(status && status.applied);
  const state = isApplied ? "active" : "idle";
  elements.head.dataset.state = state;
  elements.pill.dataset.state = state;
  elements.pill.textContent = isApplied ? "on" : "off";
  elements.applied.textContent = isApplied
    ? "Dark mode is on for this tab"
    : "Dark mode is off for this tab";
}

function renderSegmented(overrideValue) {
  const value = overrideValue || "auto";
  for (const seg of elements.segmented.querySelectorAll(".dj-seg")) {
    seg.setAttribute("aria-checked", String(seg.dataset.value === value));
  }
}

async function refresh() {
  const globalStore = await api.storage.local.get(GLOBAL_KEY);
  const domainStore = await api.storage.session.get(DOMAIN_KEY);
  const domains = domainStore[DOMAIN_KEY] || {};

  elements.global.setAttribute("aria-checked", String(Boolean(globalStore[GLOBAL_KEY])));
  elements.overrideHost.textContent = activeHost;
  renderSegmented(domains[activeHost]);

  const status = await getStatus(activeTab.id);
  renderApplied(status);
  renderDetected(status);
}

elements.global.addEventListener("click", async () => {
  const next = elements.global.getAttribute("aria-checked") !== "true";
  await api.storage.local.set({ [GLOBAL_KEY]: next });
  setTimeout(refresh, 150);
});

elements.segmented.addEventListener("click", async (event) => {
  const seg = event.target.closest(".dj-seg");
  if (!seg) return;
  const value = seg.dataset.value;

  const domainStore = await api.storage.session.get(DOMAIN_KEY);
  const domains = domainStore[DOMAIN_KEY] || {};

  if (value === "auto") {
    delete domains[activeHost];
  } else {
    domains[activeHost] = value;
  }
  await api.storage.session.set({ [DOMAIN_KEY]: domains });
  setTimeout(refresh, 150);
});

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const host = tab ? hostOf(tab.url) : null;
  const supported = Boolean(host);

  elements.body.dataset.supported = String(supported);
  elements.unsupported.hidden = supported;

  if (!supported) {
    elements.host.textContent = "unsupported page";
    return;
  }

  activeTab = tab;
  activeHost = host;
  elements.host.textContent = host;
  await refresh();
}

init();
