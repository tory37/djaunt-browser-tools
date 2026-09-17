const api = globalThis.browser ?? globalThis.chrome;

const HISTORY_KEY = "history";
const HISTORY_LIMIT = 60;

async function readHistory() {
  const stored = await api.storage.local.get(HISTORY_KEY);
  return stored[HISTORY_KEY] || [];
}

async function writeHistory(history) {
  await api.storage.local.set({ [HISTORY_KEY]: history });
  await updateBadge(history[0]);
}

async function updateBadge(hex) {
  try {
    if (!hex) {
      await api.action.setBadgeText({ text: "" });
      return;
    }
    await api.action.setBadgeBackgroundColor({ color: hex });
    await api.action.setBadgeText({ text: " " });
  } catch (error) {
    // Badge APIs can throw on some restricted contexts; not worth surfacing.
  }
}

const messageHandlers = {
  async addToHistory({ hex }) {
    const history = await readHistory();
    const deduped = history.filter((entry) => entry !== hex);
    deduped.unshift(hex);
    await writeHistory(deduped.slice(0, HISTORY_LIMIT));
    return { ok: true };
  },

  async removeFromHistory({ hex }) {
    const history = await readHistory();
    await writeHistory(history.filter((entry) => entry !== hex));
    return { ok: true };
  },

  async clearHistory() {
    await writeHistory([]);
    return { ok: true };
  },
};

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = messageHandlers[message && message.type];
  if (!handler) return false;
  handler(message).then(sendResponse);
  return true;
});

api.runtime.onInstalled.addListener(async () => {
  const history = await readHistory();
  await updateBadge(history[0]);
});
