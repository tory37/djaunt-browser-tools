/**
 * Net Mock's MAIN-world half: it replaces the page's own `fetch` and
 * `XMLHttpRequest`, answers whatever matches a rule, and exposes `window.djauntMock`.
 *
 * Running in the page's world is what makes mocking possible at all — an isolated
 * content script cannot see, let alone replace, the page's `fetch`. The cost is no
 * extension APIs, so every rule read and every write goes over the `bridge.js`
 * relay.
 *
 * This is a development tool, not a security boundary: the page shares this world
 * and can replace `fetch` right back.
 */

(() => {
  const wire = globalThis.__djauntMockWire;
  delete globalThis.__djauntMockWire;
  if (!wire) return;

  const CALL_EVENT = 'djaunt-mock:call';
  const RESULT_EVENT = 'djaunt-mock:result';
  const RULES_EVENT = 'djaunt-mock:rules';

  /** Long enough for the bridge to answer, short enough that a broken relay never hangs a page. */
  const READY_TIMEOUT_MS = 3000;
  const LOG_FLUSH_MS = 250;
  /** Cap on how long a write waits for its own snapshot to come back. */
  const SNAPSHOT_TIMEOUT_MS = 1000;

  // ---- rule snapshot ----

  let wireRules = [];
  let ready = false;
  let settle;
  const rulesReady = new Promise((resolve) => { settle = resolve; });

  function markReady() {
    if (ready) return;
    ready = true;
    settle();
  }

  setTimeout(markReady, READY_TIMEOUT_MS);

  /**
   * Counts live per frame, so a rule's `times` budget is spent per page load. That
   * is what a test wants: "fail the first call, then behave" survives a reload.
   */
  const counts = new Map();

  document.addEventListener(RULES_EVENT, (event) => {
    try {
      wireRules = JSON.parse(event.detail).rules || [];
    } catch {
      wireRules = [];
    }
    counts.clear();
    markReady();
  });

  // ---- bridge calls ----

  const pending = new Map();
  let nextCallId = 1;

  document.addEventListener(RESULT_EVENT, (event) => {
    let reply;
    try {
      reply = JSON.parse(event.detail);
    } catch {
      return;
    }
    const waiting = pending.get(reply.callId);
    if (!waiting) return;
    pending.delete(reply.callId);
    if (reply.ok) waiting.resolve(reply.result);
    else waiting.reject(new Error(reply.error || 'Net Mock refused the request.'));
  });

  function call(op, payload) {
    return new Promise((resolve, reject) => {
      const callId = nextCallId;
      nextCallId += 1;
      pending.set(callId, { resolve, reject });
      document.dispatchEvent(new CustomEvent(CALL_EVENT, {
        detail: JSON.stringify({ callId, op, payload }),
      }));
    });
  }

  /** Resolves on the next rule snapshot the bridge pushes down. */
  function nextSnapshot() {
    return new Promise((resolve) => {
      document.addEventListener(RULES_EVENT, resolve, { once: true });
    });
  }

  /**
   * A write goes to storage, comes back through the background and only then
   * reaches this frame. Holding the promise until the new snapshot lands means
   * `await djauntMock.add(...)` can be followed straight away by a request the
   * rule catches — without it, the very next line races the round trip.
   *
   * The timeout covers a write that somehow changes nothing, which would emit no
   * snapshot at all.
   */
  function mutate(op, payload) {
    const landed = nextSnapshot();
    return call(op, payload).then((result) => Promise.race([
      landed,
      new Promise((resolve) => setTimeout(resolve, SNAPSHOT_TIMEOUT_MS)),
    ]).then(() => result));
  }

  // ---- match log ----

  let queued = [];
  let flushTimer = null;

  /** Batched so a chatty page does not send one message per request. */
  function flushLog() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!queued.length) return Promise.resolve();
    const entries = queued;
    queued = [];
    return call('record', { entries }).catch(() => {});
  }

  function record(entry) {
    queued.push({ time: Date.now(), page: location.href, ...entry });
    if (flushTimer) return;
    flushTimer = setTimeout(flushLog, LOG_FLUSH_MS);
  }

  function noteDecision(request, rule, action, extra) {
    record({
      url: request.url,
      method: request.method,
      ruleId: rule?.id || '',
      label: rule?.label || '',
      action,
      ...extra,
    });
  }

  // ---- matching ----

  async function decide(request) {
    if (!ready) await rulesReady;
    const rule = wire.pickWireRule(wireRules, request, counts);
    if (rule) counts.set(rule.id, (counts.get(rule.id) || 0) + 1);
    return rule;
  }

  function absolute(raw) {
    return wire.absoluteUrl(raw, document.baseURI || location.href);
  }

  function wait(ms) {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  // ---- fetch ----

  const nativeFetch = window.fetch;

  function describeFetch(input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = isRequest ? input.url : String(input?.url ?? input ?? '');
    const method = init?.method ?? (isRequest ? input.method : 'GET');
    return { url: absolute(url), method: String(method || 'GET').toUpperCase() };
  }

  function mockResponse(rule, url) {
    const body = wire.forbidsBody(rule.status) ? null : rule.body;
    const response = new Response(body, {
      status: rule.status,
      statusText: rule.statusText,
      headers: rule.headers,
    });
    try {
      Object.defineProperty(response, 'url', { value: url });
    } catch {
      // Some engines seal it; the status and body still carry the mock.
    }
    return response;
  }

  window.fetch = function fetch(input, init) {
    const target = this;
    const request = describeFetch(input, init);
    return decide(request).then((rule) => {
      if (!rule || rule.mode === 'passthrough') {
        noteDecision(request, rule, 'passed');
        return nativeFetch.call(target, input, init);
      }
      return wait(rule.delayMs).then(() => {
        if (rule.mode === 'fail') {
          noteDecision(request, rule, 'failed');
          throw new TypeError('Failed to fetch');
        }
        noteDecision(request, rule, 'mocked', { status: rule.status });
        return mockResponse(rule, request.url);
      });
    });
  };

  // ---- XMLHttpRequest ----

  const NativeXHR = window.XMLHttpRequest;
  const nativeOpen = NativeXHR.prototype.open;
  const nativeSend = NativeXHR.prototype.send;
  const nativeGetAllResponseHeaders = NativeXHR.prototype.getAllResponseHeaders;
  const nativeGetResponseHeader = NativeXHR.prototype.getResponseHeader;

  const DONE = 4;
  const openCalls = new WeakMap();

  function shadow(xhr, name, value) {
    Object.defineProperty(xhr, name, { configurable: true, get: () => value });
  }

  function fire(xhr, type, init) {
    const Ctor = init && typeof ProgressEvent === 'function' ? ProgressEvent : Event;
    xhr.dispatchEvent(Ctor === ProgressEvent ? new ProgressEvent(type, init) : new Event(type));
  }

  function advance(xhr, state) {
    shadow(xhr, 'readyState', state);
    fire(xhr, 'readystatechange');
  }

  /** Honours `responseType`, so axios and jQuery read the mock the way they expect. */
  function responseFor(xhr, rule) {
    const type = xhr.responseType;
    if (type === 'json') {
      try {
        return JSON.parse(rule.body);
      } catch {
        return null;
      }
    }
    if (type === 'arraybuffer') return new TextEncoder().encode(rule.body).buffer;
    if (type === 'blob') {
      return new Blob([rule.body], { type: rule.headers['content-type'] || '' });
    }
    if (type === 'document') {
      try {
        return new DOMParser().parseFromString(rule.body, 'text/html');
      } catch {
        return null;
      }
    }
    return rule.body;
  }

  function fulfil(xhr, rule, request) {
    fire(xhr, 'loadstart', { lengthComputable: false, loaded: 0, total: 0 });
    const raw = wire.formatRawHeaders(rule.headers);
    const lookup = {};
    for (const [name, value] of Object.entries(rule.headers)) lookup[name.toLowerCase()] = value;

    shadow(xhr, 'status', rule.status);
    shadow(xhr, 'statusText', rule.statusText);
    shadow(xhr, 'responseURL', request.url);
    shadow(xhr, 'response', responseFor(xhr, rule));
    shadow(xhr, 'responseText', xhr.responseType === '' || xhr.responseType === 'text' ? rule.body : '');
    Object.defineProperty(xhr, 'getAllResponseHeaders', { configurable: true, value: () => raw });
    Object.defineProperty(xhr, 'getResponseHeader', {
      configurable: true,
      value: (name) => lookup[String(name).toLowerCase()] ?? null,
    });

    const total = rule.body.length;
    advance(xhr, 2);
    advance(xhr, 3);
    fire(xhr, 'progress', { lengthComputable: true, loaded: total, total });
    advance(xhr, DONE);
    fire(xhr, 'load', { lengthComputable: true, loaded: total, total });
    fire(xhr, 'loadend', { lengthComputable: true, loaded: total, total });
  }

  function reject(xhr) {
    fire(xhr, 'loadstart', { lengthComputable: false, loaded: 0, total: 0 });
    shadow(xhr, 'status', 0);
    shadow(xhr, 'statusText', '');
    shadow(xhr, 'response', '');
    shadow(xhr, 'responseText', '');
    advance(xhr, DONE);
    fire(xhr, 'error', { lengthComputable: false, loaded: 0, total: 0 });
    fire(xhr, 'loadend', { lengthComputable: false, loaded: 0, total: 0 });
  }

  function restore(xhr) {
    for (const name of ['status', 'statusText', 'response', 'responseText', 'responseURL', 'readyState']) {
      delete xhr[name];
    }
    Object.defineProperty(xhr, 'getAllResponseHeaders', {
      configurable: true, value: nativeGetAllResponseHeaders,
    });
    Object.defineProperty(xhr, 'getResponseHeader', {
      configurable: true, value: nativeGetResponseHeader,
    });
  }

  NativeXHR.prototype.open = function open(method, url, isAsync, ...rest) {
    openCalls.set(this, {
      url: absolute(url),
      method: String(method || 'GET').toUpperCase(),
      isAsync: isAsync === undefined || isAsync !== false,
    });
    return nativeOpen.call(this, method, url, isAsync === undefined ? true : isAsync, ...rest);
  };

  NativeXHR.prototype.send = function send(body) {
    const request = openCalls.get(this);
    if (!request) return nativeSend.call(this, body);

    // A synchronous request cannot wait for the rule snapshot, so it always goes to
    // the network. Log it when a rule would otherwise have caught it.
    if (!request.isAsync) {
      const wouldMatch = ready ? wire.pickWireRule(wireRules, request, new Map()) : null;
      if (wouldMatch) noteDecision(request, wouldMatch, 'skipped', { reason: 'synchronous XHR' });
      return nativeSend.call(this, body);
    }

    const xhr = this;
    let abandoned = false;
    xhr.addEventListener('abort', () => { abandoned = true; }, { once: true });

    // `loadstart` is fired by whichever branch wins, so a passed-through request
    // does not get one from us and another from the real send.
    decide(request).then((rule) => {
      if (abandoned) return;
      if (!rule || rule.mode === 'passthrough') {
        noteDecision(request, rule, 'passed');
        restore(xhr);
        nativeSend.call(xhr, body);
        return;
      }
      wait(rule.delayMs).then(() => {
        if (abandoned) return;
        if (rule.mode === 'fail') {
          noteDecision(request, rule, 'failed');
          reject(xhr);
          return;
        }
        noteDecision(request, rule, 'mocked', { status: rule.status });
        fulfil(xhr, rule, request);
      });
    });
    return undefined;
  };

  // ---- the page-facing API ----

  /**
   * Every method returns a promise. A rule added here defaults to enabled — an
   * agent that just wrote a rule wants it live, unlike the popup where a new row
   * starts off while it is being filled in.
   */
  const djauntMock = Object.freeze({
    version: '1.0.0',
    ready: rulesReady.then(() => true),
    add: (rule) => mutate('add', { rule: { enabled: true, ...rule } }),
    list: () => call('list'),
    update: (id, patch) => mutate('update', { id, patch }),
    enable: (id, enabled = true) => mutate('enable', { id, enabled }),
    remove: (id) => mutate('remove', { id }),
    set: (rules) => mutate('set', { rules }),
    clear: () => mutate('clear'),
    import: (json, options) => mutate('import', { json, replace: options?.replace !== false }),
    export: () => call('export'),
    // Flushed first, so reading the log straight after a request shows that request.
    log: (options) => flushLog().then(() => call('log', { limit: options?.limit })),
    clearLog: () => call('clearLog'),
    active: () => Promise.resolve(wireRules.map(({ compiled, ...rule }) => rule)),
  });

  Object.defineProperty(window, 'djauntMock', {
    value: djauntMock,
    configurable: true,
    enumerable: false,
    writable: false,
  });
})();
