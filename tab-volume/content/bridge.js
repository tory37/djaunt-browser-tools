// Isolated-world bridge: carries the volume from the service worker to the
// page-world script, which cannot use the chrome.* APIs itself.
(() => {
  const SET_EVENT = "__tabVolume:set";
  const READY_EVENT = "__tabVolume:ready";

  let lastKnownVolume = 1;

  const pushToPage = (volume) => {
    lastKnownVolume = volume;
    document.dispatchEvent(new CustomEvent(SET_EVENT, { detail: volume }));
  };

  // Content script worlds start in an unspecified order, so replay the last
  // value once the page-world script announces itself.
  document.addEventListener(READY_EVENT, () => pushToPage(lastKnownVolume));

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "applyVolume") {
      pushToPage(message.volume);
    }
  });

  chrome.runtime
    .sendMessage({ type: "requestVolume" })
    .then((response) => {
      if (response && typeof response.volume === "number") {
        pushToPage(response.volume);
      }
    })
    .catch(() => {
      // The service worker may still be starting; the push path covers it.
    });
})();
