/**
 * Relay between the MAIN world and the background worker.
 *
 * The interceptor runs in the page's own world so it can replace `fetch`, which
 * means it has no extension APIs. This isolated-world script is the only path
 * between the two, and it carries everything as JSON strings — a primitive crosses
 * the world boundary in both browsers without any cloning ceremony.
 */

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const CALL_EVENT = 'djaunt-mock:call';
  const RESULT_EVENT = 'djaunt-mock:result';
  const RULES_EVENT = 'djaunt-mock:rules';
  const STORAGE_KEY = 'rules';

  function send(op, payload) {
    return new Promise((resolve) => {
      try {
        const reply = api.runtime.sendMessage({ channel: 'net-mock', op, payload });
        // Chrome hands back a callback-style undefined; Firefox hands back a promise.
        if (reply?.then) {
          reply.then(resolve, (error) => resolve({ ok: false, error: String(error?.message || error) }));
          return;
        }
        resolve(reply);
      } catch (error) {
        resolve({ ok: false, error: String(error?.message || error) });
      }
    });
  }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  }

  document.addEventListener(CALL_EVENT, (event) => {
    let call;
    try {
      call = JSON.parse(event.detail);
    } catch {
      return;
    }
    send(call.op, call.payload).then((reply) => {
      const answer = reply ?? { ok: false, error: 'The extension did not answer.' };
      emit(RESULT_EVENT, { callId: call.callId, ...answer });
    });
  });

  async function pushRules() {
    const reply = await send('getRules');
    if (!reply?.ok) return;
    emit(RULES_EVENT, { rules: reply.result });
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) pushRules();
  });

  pushRules();
})();
