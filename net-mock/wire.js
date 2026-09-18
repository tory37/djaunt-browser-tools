/**
 * The matching half of Net Mock, in the form both worlds can load.
 *
 * This file declares no imports and no exports on purpose: it is legal as a
 * classic content script (where it seeds a global in the MAIN world) and as an ES
 * module (where `background.js` and `test.mjs` import it for the same global). That
 * keeps one copy of the matching logic without adding a build step.
 *
 * A "wire rule" is a validated rule flattened for transport — see `toWireRule` in
 * `rules.js`. Nothing here validates; by the time a rule is on the wire it is known
 * good.
 */

(() => {
  const NULL_BODY_STATUSES = [101, 103, 204, 205, 304];

  /** Compiles once per snapshot and caches on the rule object. */
  function matcherFor(rule) {
    if (!rule.compiled) rule.compiled = new RegExp(rule.pattern, 'i');
    return rule.compiled;
  }

  /**
   * First match wins — list order is priority. `counts` maps a rule id to how many
   * times it has already fired in this frame, so a rule with a `times` budget stops
   * matching once it is spent.
   */
  function pickWireRule(wireRules, request, counts) {
    const method = String(request?.method || 'GET').toUpperCase();
    const url = String(request?.url || '');
    for (const rule of wireRules || []) {
      if (rule.method !== '*' && rule.method !== method) continue;
      if (!matcherFor(rule).test(url)) continue;
      if (rule.times > 0 && (counts?.get(rule.id) || 0) >= rule.times) continue;
      return rule;
    }
    return null;
  }

  /** A status the fetch spec forbids a body on; sending one throws. */
  function forbidsBody(status) {
    return NULL_BODY_STATUSES.includes(status);
  }

  /** Flattens headers to the single string `XMLHttpRequest.getAllResponseHeaders` returns. */
  function formatRawHeaders(headers) {
    return Object.entries(headers || {})
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join('');
  }

  /**
   * Resolves a request URL the way the page would, so a rule written as `*​/api/*`
   * still matches a relative `fetch('/api/x')`.
   */
  function absoluteUrl(raw, base) {
    try {
      return new URL(String(raw ?? ''), base || undefined).href;
    } catch {
      return String(raw ?? '');
    }
  }

  globalThis.__djauntMockWire = { pickWireRule, forbidsBody, formatRawHeaders, absoluteUrl };
})();
