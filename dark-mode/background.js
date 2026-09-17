const api = globalThis.browser ?? globalThis.chrome;

const APPLIED_BADGE_COLOR = "#a78bfa";

async function setBadge(tabId, applied) {
  try {
    await api.action.setBadgeBackgroundColor({ tabId, color: APPLIED_BADGE_COLOR });
    await api.action.setBadgeText({ tabId, text: applied ? "ON" : "" });
  } catch (error) {
    // The tab closed while we were updating it.
  }
}

api.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "darkModeStatus" && sender.tab) {
    setBadge(sender.tab.id, message.applied);
  }
  return false;
});

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

// Manifest content scripts only auto-inject into pages loaded after
// installation, so seed the tabs that are already open.
async function injectIntoOpenTabs() {
  const tabs = await api.tabs.query({});
  for (const tab of tabs) {
    if (!hostOf(tab.url)) continue;
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"]
      });
    } catch (error) {
      // Restricted page or a tab that went away.
    }
  }
}

// Session storage defaults to background/popup only; content scripts need
// the domain override map, so widen access before they can run.
async function allowSessionStorageInContentScripts() {
  await api.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"
  });
}

async function init() {
  await allowSessionStorageInContentScripts();
  await injectIntoOpenTabs();
}

api.runtime.onInstalled.addListener(init);
api.runtime.onStartup.addListener(init);
