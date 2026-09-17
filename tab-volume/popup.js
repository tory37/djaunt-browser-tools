const elements = {
  body: document.body,
  head: document.getElementById("head"),
  host: document.getElementById("host"),
  readout: document.getElementById("readout"),
  speaker: document.getElementById("speaker"),
  slider: document.getElementById("slider"),
  presets: document.getElementById("presets"),
  persist: document.getElementById("persist"),
  persistNote: document.getElementById("persist-note"),
  scope: document.getElementById("scope"),
  reset: document.getElementById("reset"),
  unsupported: document.getElementById("unsupported")
};

let activeTabId = null;

const levelFor = (percent) => {
  if (percent === 0) return "muted";
  if (percent < 34) return "low";
  if (percent < 67) return "mid";
  return "high";
};

function renderVolume(percent) {
  elements.readout.textContent = String(percent);
  elements.slider.value = String(percent);
  elements.slider.style.setProperty("--fill", `${percent}%`);
  elements.speaker.dataset.level = levelFor(percent);
  for (const button of elements.presets.querySelectorAll("button")) {
    button.dataset.active = String(Number(button.dataset.value) === percent);
  }
}

function renderScope(isPersisted, host) {
  elements.persist.checked = isPersisted;
  elements.scope.textContent = isPersisted ? `All of ${host}` : "This tab only";
  elements.persistNote.textContent = isPersisted
    ? `Saved for ${host}`
    : "Applies to every tab on this site";
}

function render(state) {
  elements.body.dataset.supported = String(Boolean(state.supported));
  elements.unsupported.hidden = Boolean(state.supported);
  if (!state.supported) {
    elements.head.dataset.state = "error";
    elements.host.textContent = "unsupported page";
    return;
  }
  elements.head.dataset.state = state.persisted || state.volume !== 1 ? "active" : "idle";
  elements.host.textContent = state.host;
  activeTabId = state.tabId;
  renderVolume(Math.round(state.volume * 100));
  renderScope(state.persisted, state.host);
}

const send = (message) => chrome.runtime.sendMessage(message);

async function refresh() {
  render(await send({ type: "getPopupState" }));
}

function commitVolume(percent) {
  renderVolume(percent);
  send({ type: "setVolume", tabId: activeTabId, volume: percent / 100 });
}

elements.slider.addEventListener("input", (event) => {
  commitVolume(Number(event.target.value));
});

elements.presets.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) commitVolume(Number(button.dataset.value));
});

elements.persist.addEventListener("change", async (event) => {
  await send({
    type: "setPersisted",
    tabId: activeTabId,
    persisted: event.target.checked
  });
  await refresh();
});

elements.reset.addEventListener("click", async () => {
  await send({ type: "reset", tabId: activeTabId });
  await refresh();
});

refresh();
