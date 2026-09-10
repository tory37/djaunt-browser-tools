// Runs in the page's own JavaScript world so it can attenuate both <video>/<audio>
// elements and audio produced through the Web Audio API.
(() => {
  const SET_EVENT = "__tabVolume:set";
  const READY_EVENT = "__tabVolume:ready";

  if (window.__tabVolumeInstalled) return;
  window.__tabVolumeInstalled = true;

  let tabGain = 1;

  const requestedVolumes = new WeakMap();
  const trackedElements = new Set();
  const trackedGainNodes = new Set();

  const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));

  const nativeVolume = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "volume"
  );

  const requestedVolumeOf = (element) => {
    const stored = requestedVolumes.get(element);
    return stored === undefined ? nativeVolume.get.call(element) : stored;
  };

  function trackElement(element) {
    trackedElements.add(new WeakRef(element));
  }

  function applyToElement(element) {
    nativeVolume.set.call(element, clamp(requestedVolumeOf(element) * tabGain));
  }

  // The page keeps reading and writing the volume it asked for; the multiplied
  // value never becomes visible to site code, so sliders on the page stay sane.
  Object.defineProperty(HTMLMediaElement.prototype, "volume", {
    configurable: true,
    enumerable: true,
    get() {
      return requestedVolumeOf(this);
    },
    set(value) {
      const requested = clamp(value);
      requestedVolumes.set(this, requested);
      trackElement(this);
      nativeVolume.set.call(this, clamp(requested * tabGain));
    }
  });

  function discoverElements(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    for (const element of root.querySelectorAll("video, audio")) {
      trackElement(element);
      applyToElement(element);
    }
  }

  function applyToEverything() {
    for (const reference of Array.from(trackedElements)) {
      const element = reference.deref();
      if (!element) {
        trackedElements.delete(reference);
        continue;
      }
      applyToElement(element);
    }
    discoverElements(document);
    for (const node of trackedGainNodes) {
      node.gain.value = tabGain;
    }
  }

  function setTabGain(value) {
    tabGain = clamp(value);
    applyToEverything();
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLMediaElement) {
          trackElement(node);
          applyToElement(node);
        } else {
          discoverElements(node);
        }
      }
    }
  });

  const startObserver = () => {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      discoverElements(document);
    }
  };

  startObserver();
  document.addEventListener("readystatechange", startObserver, true);
  for (const eventName of ["loadstart", "play", "playing", "canplay"]) {
    document.addEventListener(
      eventName,
      (event) => {
        if (event.target instanceof HTMLMediaElement) {
          trackElement(event.target);
          applyToElement(event.target);
        }
      },
      true
    );
  }

  // Web Audio graphs bypass HTMLMediaElement.volume, so every context gets a
  // gain node interposed in front of its real destination.
  function interposeGainNode(context) {
    try {
      const realDestination = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(Object.getPrototypeOf(context)),
        "destination"
      ).get.call(context);
      const gainNode = context.createGain();
      gainNode.gain.value = tabGain;
      gainNode.connect(realDestination);
      trackedGainNodes.add(gainNode);
      Object.defineProperty(context, "destination", {
        configurable: true,
        get: () => gainNode
      });
    } catch (error) {
      // A context we cannot interpose still plays at the site's own volume.
    }
  }

  const wrapContextConstructor = (Constructor) =>
    new Proxy(Constructor, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget);
        interposeGainNode(context);
        return context;
      }
    });

  for (const name of ["AudioContext", "webkitAudioContext"]) {
    if (typeof window[name] === "function") {
      window[name] = wrapContextConstructor(window[name]);
    }
  }

  document.addEventListener(SET_EVENT, (event) => setTabGain(event.detail));
  document.dispatchEvent(new CustomEvent(READY_EVENT));
})();
