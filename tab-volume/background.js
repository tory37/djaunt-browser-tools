import { FULL_VOLUME, clamp, hostOf, pickVolume } from "./logic.js";

const api = globalThis.browser ?? globalThis.chrome;

const DOMAIN_STORE_KEY = "domainVolumes";
const TAB_STORE_KEY = "tabVolumes";

async function readDomainVolumes() {
  const stored = await api.storage.local.get(DOMAIN_STORE_KEY);
  return stored[DOMAIN_STORE_KEY] || {};
}

async function writeDomainVolumes(volumes) {
  await api.storage.local.set({ [DOMAIN_STORE_KEY]: volumes });
}

async function readTabVolumes() {
  const stored = await api.storage.session.get(TAB_STORE_KEY);
  return stored[TAB_STORE_KEY] || {};
}

async function writeTabVolumes(volumes) {
  await api.storage.session.set({ [TAB_STORE_KEY]: volumes });
}

async function resolveVolume(tabId, url) {
  const [tabVolumes, domainVolumes] = await Promise.all([
    readTabVolumes(),
    readDomainVolumes()
  ]);
  const host = hostOf(url);
  return pickVolume(tabVolumes[String(tabId)], host ? domainVolumes[host] : undefined);
}

async function updateBadge(tabId, volume) {
  const percent = Math.round(volume * 100);
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: "#9B8CFF" }); // --dj-accent, storm
    await api.action.setBadgeTextColor({ tabId, color: "#0A0912" }); // --dj-on-accent
    await api.action.setBadgeText({
      tabId,
      text: percent === 100 ? "" : String(percent)
    });
  } catch (error) {
    // The tab closed while we were updating it.
  }
}

async function applyToTab(tabId, volume) {
  try {
    await api.tabs.sendMessage(tabId, { type: "applyVolume", volume });
  } catch (error) {
    // No content script in this tab (chrome:// page, PDF viewer, discarded tab).
  }
  await updateBadge(tabId, volume);
}

async function applyToAllTabsOnHost(host, volume) {
  const tabs = await api.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => hostOf(tab.url) === host)
      .map((tab) => applyToTab(tab.id, volume))
  );
}

async function setTabVolume(tabId, volume) {
  const tabVolumes = await readTabVolumes();
  tabVolumes[String(tabId)] = clamp(volume);
  await writeTabVolumes(tabVolumes);
}

async function clearTabVolume(tabId) {
  const tabVolumes = await readTabVolumes();
  delete tabVolumes[String(tabId)];
  await writeTabVolumes(tabVolumes);
}

async function buildPopupState(tab) {
  const host = hostOf(tab.url);
  const domainVolumes = await readDomainVolumes();
  const isPersisted = Boolean(host) && typeof domainVolumes[host] === "number";
  return {
    tabId: tab.id,
    host,
    supported: Boolean(host),
    persisted: isPersisted,
    volume: await resolveVolume(tab.id, tab.url)
  };
}

const messageHandlers = {
  async requestVolume(message, sender) {
    if (!sender.tab) return { volume: FULL_VOLUME };
    return { volume: await resolveVolume(sender.tab.id, sender.tab.url) };
  },

  async getPopupState() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { supported: false };
    return buildPopupState(tab);
  },

  async setVolume({ tabId, volume }) {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const host = tab ? hostOf(tab.url) : null;
    const domainVolumes = await readDomainVolumes();
    const nextVolume = clamp(volume);

    if (host && typeof domainVolumes[host] === "number") {
      domainVolumes[host] = nextVolume;
      await writeDomainVolumes(domainVolumes);
      await applyToAllTabsOnHost(host, nextVolume);
      return { ok: true };
    }

    await setTabVolume(tabId, nextVolume);
    await applyToTab(tabId, nextVolume);
    return { ok: true };
  },

  async setPersisted({ tabId, persisted }) {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const host = tab ? hostOf(tab.url) : null;
    if (!host) return { ok: false };

    const currentVolume = await resolveVolume(tabId, tab.url);
    const domainVolumes = await readDomainVolumes();

    if (persisted) {
      domainVolumes[host] = currentVolume;
      await writeDomainVolumes(domainVolumes);
      // The per-tab value would otherwise shadow the domain setting.
      await clearTabVolume(tabId);
      await applyToAllTabsOnHost(host, currentVolume);
    } else {
      delete domainVolumes[host];
      await writeDomainVolumes(domainVolumes);
      await setTabVolume(tabId, currentVolume);
      await applyToTab(tabId, currentVolume);
    }
    return { ok: true };
  },

  async reset({ tabId }) {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const host = tab ? hostOf(tab.url) : null;
    await clearTabVolume(tabId);
    if (host) {
      const domainVolumes = await readDomainVolumes();
      delete domainVolumes[host];
      await writeDomainVolumes(domainVolumes);
      await applyToAllTabsOnHost(host, FULL_VOLUME);
    }
    await applyToTab(tabId, FULL_VOLUME);
    return { ok: true };
  }
};

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message && message.type];
  if (!handler) return false;
  handler(message, sender).then(sendResponse);
  return true;
});

api.tabs.onRemoved.addListener((tabId) => clearTabVolume(tabId));

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.status && !changeInfo.url) return;
  const volume = await resolveVolume(tabId, tab.url);
  await applyToTab(tabId, volume);
});

// Content scripts only auto-inject into pages loaded after installation, so
// seed the tabs that are already open.
async function injectIntoOpenTabs() {
  const tabs = await api.tabs.query({});
  for (const tab of tabs) {
    if (!hostOf(tab.url)) continue;
    for (const script of [
      { file: "content/audio.js", world: "MAIN" },
      { file: "content/bridge.js", world: "ISOLATED" }
    ]) {
      try {
        await api.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: [script.file],
          world: script.world
        });
      } catch (error) {
        // Restricted page or a tab that went away.
      }
    }
    await applyToTab(tab.id, await resolveVolume(tab.id, tab.url));
  }
}

api.runtime.onInstalled.addListener(injectIntoOpenTabs);
api.runtime.onStartup.addListener(injectIntoOpenTabs);
