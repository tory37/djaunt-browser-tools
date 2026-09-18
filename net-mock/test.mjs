import {
  absoluteUrl, buildMockResponse, buildWireRules, compileUrlPattern, formatHeaders, matchRule,
  expandShorthand, migrateConfig, newRule, parseHeaders, parseRuleset, resolveEnabledRules,
  resolveRule, serializeRuleset, statusTextFor, toWireRule,
} from './rules.js';
import './wire.js';

const { pickWireRule, forbidsBody, formatRawHeaders } = globalThis.__djauntMockWire;

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

function checkThrows(label, fn) {
  try {
    fn();
    failures.push(`${label}\n    expected a throw, got none`);
  } catch {
    pass += 1;
  }
}

/** Installs a rule list the way the interceptor does, then runs requests through it. */
function install(rules) {
  const { ready, broken } = resolveEnabledRules(rules);
  const counts = new Map();
  return {
    ready,
    broken,
    run(url, method = 'GET') {
      const hit = matchRule(ready, { url, method }, counts);
      if (!hit) return null;
      counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1);
      return hit;
    },
  };
}

function rule(overrides) {
  return newRule(overrides);
}

// ---- url patterns ----

check('glob star spans path segments',
  compileUrlPattern('*/api/*').test('https://app.example.com/api/v2/students'), true);
check('glob is anchored at both ends',
  compileUrlPattern('https://a.com/api').test('https://a.com/api/extra'), false);
check('glob matching ignores case',
  compileUrlPattern('*/API/*').test('https://a.com/api/x'), true);
check('dots in a glob are literal, not wildcards',
  compileUrlPattern('https://a.com/*').test('https://aXcom/y'), false);
check('regex mode matches',
  compileUrlPattern('re:^https://a\\.com/v[0-9]+/.*$').test('https://a.com/v2/x'), true);
check('regex mode is anchored',
  compileUrlPattern('re:https://a\\.com').test('https://a.com/extra'), false);
checkThrows('empty pattern is rejected', () => compileUrlPattern('   '));
checkThrows('broken regex is rejected', () => compileUrlPattern('re:[unclosed'));

// ---- headers ----

check('headers parse from Name: value lines',
  JSON.stringify(parseHeaders('Content-Type: application/json\nX-Test: 1')),
  '{"content-type":"application/json","x-test":"1"}');
check('header names are lowercased', Object.keys(parseHeaders('X-Case: 1'))[0], 'x-case');
check('blank header lines are ignored',
  Object.keys(parseHeaders('\n\nA: 1\n\n')).length, 1);
check('a header value may contain a colon',
  parseHeaders('Location: https://a.com/x')['location'], 'https://a.com/x');
check('an object of headers passes straight through',
  parseHeaders({ 'Content-Type': 'text/plain' })['content-type'], 'text/plain');
check('headers round-trip back to text',
  formatHeaders(parseHeaders('A: 1\nB: 2')), 'a: 1\nb: 2');
checkThrows('a header line without a colon is rejected', () => parseHeaders('nocolon'));
checkThrows('an invalid header name is rejected', () => parseHeaders('bad header: 1'));

// ---- rule validation ----

check('method is uppercased',
  resolveRule({ match: { url: '*', method: 'get' } }).match.method, 'GET');
check('a blank method means any method',
  resolveRule({ match: { url: '*', method: '' } }).match.method, '*');
check('status defaults to 200', resolveRule({ match: { url: '*' } }).respond.status, 200);
check('a JSON body gets a JSON content-type for free',
  resolveRule({ match: { url: '*' }, respond: { body: '{"a":1}' } }).respond.headers['content-type'],
  'application/json');
check('an explicit content-type is not overwritten',
  resolveRule({
    match: { url: '*' },
    respond: { body: '{"a":1}', headers: 'Content-Type: text/plain' },
  }).respond.headers['content-type'], 'text/plain');
check('a non-JSON body gets no content-type',
  resolveRule({ match: { url: '*' }, respond: { body: 'hello' } }).respond.headers['content-type'],
  undefined);
check('a body that only looks like JSON gets no content-type',
  resolveRule({ match: { url: '*' }, respond: { body: '{nope' } }).respond.headers['content-type'],
  undefined);
check('a numeric body is stored as a string',
  resolveRule({ match: { url: '*' }, respond: { body: 42 } }).respond.body, '42');
checkThrows('an unknown mode is rejected',
  () => resolveRule({ match: { url: '*' }, respond: { mode: 'explode' } }));
checkThrows('a status out of range is rejected',
  () => resolveRule({ match: { url: '*' }, respond: { status: 99 } }));
checkThrows('a fractional status is rejected',
  () => resolveRule({ match: { url: '*' }, respond: { status: 200.5 } }));
checkThrows('a negative delay is rejected',
  () => resolveRule({ match: { url: '*' }, respond: { delayMs: -1 } }));
checkThrows('a method with a space is rejected',
  () => resolveRule({ match: { url: '*', method: 'GET POST' } }));
checkThrows('an empty url is rejected', () => resolveRule({ match: { url: '' } }));

// ---- shorthand, the shape an agent types ----

check('flat url moves under match',
  expandShorthand({ url: '*/api/*' }).match.url, '*/api/*');
check('flat status moves under respond',
  expandShorthand({ url: '*', status: 404 }).respond.status, 404);
check('json is serialised into the body',
  expandShorthand({ url: '*', json: { name: 'Test' } }).respond.body, '{"name":"Test"}');
check('json sets a JSON content-type',
  expandShorthand({ url: '*', json: { a: 1 } }).respond.headers['content-type'],
  'application/json');
check('json does not survive as its own key',
  'json' in expandShorthand({ url: '*', json: { a: 1 } }).respond, false);
check('an explicit content-type beats the json default',
  expandShorthand({ url: '*', json: { a: 1 }, headers: 'Content-Type: text/plain' })
    .respond.headers['content-type'], 'text/plain');
check('label and enabled stay at the top level',
  expandShorthand({ url: '*', label: 'x', enabled: true }).label, 'x');
check('canonical input passes through untouched',
  expandShorthand({ match: { url: '*/a' }, respond: { status: 201 } }).respond.status, 201);
check('shorthand is idempotent',
  expandShorthand(expandShorthand({ url: '*/a', status: 201 })).match.url, '*/a');
check('a shorthand rule resolves',
  resolveRule({ url: '*/api/*', method: 'get', json: { a: 1 } }).match.method, 'GET');
check('a shorthand rule survives newRule',
  newRule({ url: '*/api/*', status: 503 }).respond.status, 503);
check('shorthand imports', parseRuleset('[{"url":"*/a","status":201}]')[0].respond.status, 201);
check('a matcher built from shorthand works',
  Boolean(matchRule([resolveRule({ url: '*/api/*' })], { url: 'https://a.com/api/x' }, new Map())),
  true);

// ---- enabled set ----

{
  const { ready, broken } = resolveEnabledRules([
    rule({ enabled: true, match: { url: '*/a' } }),
    rule({ enabled: false, match: { url: '*/b' } }),
    rule({ enabled: true, match: { url: '' } }),
  ]);
  check('disabled rules are left out', ready.length, 1);
  check('a broken rule is reported, not thrown', broken.length, 1);
  check('a broken rule keeps its list position', broken[0].index, 2);
}

// ---- matching ----

{
  const app = install([
    rule({ enabled: true, label: 'first', match: { url: '*/api/*', method: 'GET' } }),
    rule({ enabled: true, label: 'second', match: { url: '*/api/students*' } }),
  ]);
  check('the first matching rule wins',
    app.run('https://a.com/api/students/1')?.label, 'first');
  check('method filtering falls through to the next rule',
    app.run('https://a.com/api/students/1', 'POST')?.label, 'second');
  check('a non-matching url returns no rule', app.run('https://a.com/other'), null);
}

{
  const app = install([rule({ enabled: true, match: { url: '*/once' }, times: 2 })]);
  check('a times budget allows the first match', Boolean(app.run('https://a.com/once')), true);
  check('a times budget allows the second match', Boolean(app.run('https://a.com/once')), true);
  check('a spent times budget stops matching', app.run('https://a.com/once'), null);
}

{
  const app = install([rule({ enabled: true, match: { url: '*/ever' }, times: 0 })]);
  for (let i = 0; i < 5; i += 1) app.run('https://a.com/ever');
  check('times 0 never runs out', Boolean(app.run('https://a.com/ever')), true);
}

check('a method-less request is treated as GET',
  matchRule(install([rule({ enabled: true, match: { url: '*', method: 'GET' } })]).ready,
    { url: 'https://a.com/' }, new Map())?.match.method, 'GET');

// ---- relative urls ----

check('a relative url resolves against the page',
  absoluteUrl('/api/x', 'https://a.com/page'), 'https://a.com/api/x');
check('an absolute url is left alone',
  absoluteUrl('https://b.com/api/x', 'https://a.com/page'), 'https://b.com/api/x');
check('a protocol-relative url takes the page scheme',
  absoluteUrl('//b.com/x', 'https://a.com/page'), 'https://b.com/x');
check('a relative rule matches a relative fetch once resolved',
  install([rule({ enabled: true, match: { url: '*/api/*' } })])
    .run(absoluteUrl('/api/students', 'https://a.com/page')) !== null, true);

// ---- response building ----

{
  const resolved = resolveRule({
    match: { url: '*' },
    respond: { status: 404, body: '{"error":"gone"}', delayMs: 250 },
  });
  const response = buildMockResponse(resolved, 'https://a.com/x');
  check('the mock carries the status', response.status, 404);
  check('the mock carries a status text', response.statusText, 'Not Found');
  check('the mock carries the delay', response.delayMs, 250);
  check('the mock carries the request url', response.url, 'https://a.com/x');
  check('an unknown status has an empty status text', statusTextFor(599), '');
}

// ---- storage and import/export ----

check('an empty store yields no rules', migrateConfig(undefined).rules.length, 0);
check('a stored rule without an id gets one',
  Boolean(migrateConfig({ rules: [{ match: { url: '*' } }] }).rules[0].id), true);
check('a stored rule keeps its id',
  migrateConfig({ rules: [{ id: 'keep-me', match: { url: '*' } }] }).rules[0].id, 'keep-me');
check('a partial stored rule gets the defaults',
  migrateConfig({ rules: [{ match: { url: '*' } }] }).rules[0].respond.mode, 'mock');

check('a ruleset round-trips through export and import',
  parseRuleset(serializeRuleset([rule({ enabled: true, label: 'x', match: { url: '*/a' } })]))[0].label,
  'x');
check('a bare array imports', parseRuleset('[{"match":{"url":"*/a"}}]').length, 1);
check('an imported rule without an id gets one',
  Boolean(parseRuleset('[{"match":{"url":"*/a"}}]')[0].id), true);
checkThrows('invalid JSON is rejected on import', () => parseRuleset('{nope'));
checkThrows('a non-array import is rejected', () => parseRuleset('{"a":1}'));
checkThrows('one invalid rule fails the whole import',
  () => parseRuleset('[{"match":{"url":"*/a"}},{"match":{"url":""}}]'));

// ---- the wire format the MAIN world runs against ----

{
  const wire = buildWireRules([
    rule({ enabled: true, label: 'api', match: { url: '*/api/*', method: 'get' },
      respond: { status: 404, body: '{"a":1}', delayMs: 10 } }),
    rule({ enabled: false, label: 'off', match: { url: '*' } }),
  ]);
  check('only enabled rules reach the wire', wire.length, 1);
  check('the wire carries a regex source, not a RegExp', typeof wire[0].pattern, 'string');
  check('the wire regex still matches',
    new RegExp(wire[0].pattern, 'i').test('https://a.com/api/x'), true);
  check('the wire carries the normalised method', wire[0].method, 'GET');
  check('the wire carries the status text', wire[0].statusText, 'Not Found');
  check('the wire survives the JSON hop to the MAIN world',
    JSON.parse(JSON.stringify(wire))[0].label, 'api');
  check('a wire rule holds no RegExp that JSON would drop',
    Object.values(wire[0]).some((value) => value instanceof RegExp), false);
}

{
  const wire = buildWireRules([
    rule({ enabled: true, label: 'first', match: { url: '*/api/*', method: 'GET' } }),
    rule({ enabled: true, label: 'second', match: { url: '*/api/*' } }),
  ]);
  const counts = new Map();
  check('the wire matcher agrees with the resolved matcher on precedence',
    pickWireRule(wire, { url: 'https://a.com/api/x', method: 'GET' }, counts).label, 'first');
  check('the wire matcher falls through on method',
    pickWireRule(wire, { url: 'https://a.com/api/x', method: 'PUT' }, counts).label, 'second');
  check('the wire matcher returns null on no match',
    pickWireRule(wire, { url: 'https://a.com/other', method: 'GET' }, counts), null);
  check('the wire matcher defaults a missing method to GET',
    pickWireRule(wire, { url: 'https://a.com/api/x' }, counts).label, 'first');
}

{
  const wire = buildWireRules([rule({ enabled: true, match: { url: '*/once' }, times: 1 })]);
  const counts = new Map();
  const first = pickWireRule(wire, { url: 'https://a.com/once' }, counts);
  counts.set(first.id, 1);
  check('the wire matcher honours a spent times budget',
    pickWireRule(wire, { url: 'https://a.com/once' }, counts), null);
}

check('204 is flagged as a status that forbids a body', forbidsBody(204), true);
check('304 is flagged as a status that forbids a body', forbidsBody(304), true);
check('200 allows a body', forbidsBody(200), false);
check('raw headers use CRLF pairs the way XHR reports them',
  formatRawHeaders({ 'content-type': 'application/json', 'x-a': '1' }),
  'content-type: application/json\r\nx-a: 1\r\n');
check('raw headers of an empty set are an empty string', formatRawHeaders({}), '');

check('a resolved rule and its wire form carry the same body',
  toWireRule(resolveRule({ match: { url: '*' }, respond: { body: 'hi' } })).body, 'hi');

// ---- the interceptor, driven end to end ----
//
// Stands up just enough of a page — an event-target `document`, a `window`, and a
// fake `XMLHttpRequest` — to load the real MAIN-world script and put requests
// through it. The bridge is faked, so this covers everything except the extension
// APIs themselves.

globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.lengthComputable = Boolean(init.lengthComputable);
    this.loaded = init.loaded || 0;
    this.total = init.total || 0;
  }
};

const networkFetches = [];
const networkSends = [];
const bridgeCalls = [];

class FakeXHR extends EventTarget {
  constructor() {
    super();
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.response = '';
    this.responseText = '';
    this.responseType = '';
    this.responseURL = '';
  }

  open(method, url, isAsync = true) {
    this.readyState = 1;
    this.requestMethod = method;
    this.requestUrl = url;
    this.requestIsAsync = isAsync;
  }

  send(body) {
    networkSends.push({ url: this.requestUrl, method: this.requestMethod, body });
  }

  getAllResponseHeaders() { return ''; }

  getResponseHeader() { return null; }
}

const pageWindow = {
  async fetch(input) {
    networkFetches.push(String(input?.url ?? input));
    return new Response('from the network', { status: 200 });
  },
  XMLHttpRequest: FakeXHR,
};

globalThis.window = pageWindow;
globalThis.document = new EventTarget();
globalThis.document.baseURI = 'https://app.example.com/page';
globalThis.location = { href: 'https://app.example.com/page' };
globalThis.XMLHttpRequest = FakeXHR;

const MUTATING_OPS = ['add', 'update', 'enable', 'remove', 'set', 'clear', 'import'];
let snapshotAfterWrite = [];

document.addEventListener('djaunt-mock:call', (event) => {
  const request = JSON.parse(event.detail);
  bridgeCalls.push(request);
  document.dispatchEvent(new CustomEvent('djaunt-mock:result', {
    detail: JSON.stringify({ callId: request.callId, ok: true, result: { echo: request.op } }),
  }));
  // The real bridge answers a write, then pushes the new snapshot down. The
  // interceptor holds the write's promise until that arrives.
  if (MUTATING_OPS.includes(request.op)) {
    setTimeout(() => pushRules(snapshotAfterWrite), 5);
  }
});

function lastCall(op) {
  return [...bridgeCalls].reverse().find((entry) => entry.op === op);
}

await import('./interceptor.js');

function pushRules(list) {
  document.dispatchEvent(new CustomEvent('djaunt-mock:rules', {
    detail: JSON.stringify({ rules: buildWireRules(list) }),
  }));
}

// ---- fetch ----

pushRules([rule({ enabled: true, url: '*/api/students*', status: 201, json: { name: 'Test' } })]);

{
  const response = await window.fetch('/api/students/1');
  check('a matched fetch never reaches the network', networkFetches.length, 0);
  check('a matched fetch carries the mocked status', response.status, 201);
  check('a matched fetch carries the mocked status text', response.statusText, 'Created');
  check('a matched fetch carries the mocked body', (await response.json()).name, 'Test');
  check('a matched fetch carries the mocked content type',
    response.headers.get('content-type'), 'application/json');
  check('a matched fetch reports the request url', response.url, 'https://app.example.com/api/students/1');
}

{
  const response = await window.fetch('/somewhere/else');
  check('an unmatched fetch reaches the network', networkFetches.length, 1);
  check('an unmatched fetch returns the real response', await response.text(), 'from the network');
}

{
  const response = await window.fetch(new Request('https://app.example.com/api/students/9'));
  check('a Request object is matched too', response.status, 201);
}

{
  pushRules([rule({ enabled: true, url: '*/api/*', method: 'POST', status: 202 })]);
  await window.fetch('/api/thing');
  check('a method that does not match falls through to the network', networkFetches.length, 2);
  const response = await window.fetch('/api/thing', { method: 'post' });
  check('the method is compared case-insensitively', response.status, 202);
}

{
  pushRules([rule({ enabled: true, url: '*/boom', mode: 'fail' })]);
  let thrown = null;
  try {
    await window.fetch('/boom');
  } catch (error) {
    thrown = error;
  }
  check('a fail rule rejects', thrown instanceof TypeError, true);
  check('a fail rule rejects the way a dropped connection does',
    thrown?.message, 'Failed to fetch');
}

{
  pushRules([rule({ enabled: true, url: '*/passed', mode: 'passthrough' })]);
  const before = networkFetches.length;
  await window.fetch('/passed');
  check('a passthrough rule still reaches the network', networkFetches.length, before + 1);
}

{
  pushRules([rule({ enabled: true, url: '*/once', status: 503, times: 1 })]);
  const first = await window.fetch('/once');
  check('a times budget mocks the first request', first.status, 503);
  const before = networkFetches.length;
  await window.fetch('/once');
  check('a spent times budget lets the next request through', networkFetches.length, before + 1);
}

{
  pushRules([rule({ enabled: true, url: '*/slow', respond: { delayMs: 60 } })]);
  const startedAt = Date.now();
  await window.fetch('/slow');
  check('a delay actually delays', Date.now() - startedAt >= 55, true);
}

{
  pushRules([rule({ enabled: true, url: '*/gone', status: 204, body: 'ignored' })]);
  const response = await window.fetch('/gone');
  check('a 204 mock does not throw on its forbidden body', response.status, 204);
}

// ---- XMLHttpRequest ----

function runXhr(url, { method = 'GET', responseType = '', isAsync = true } = {}) {
  const xhr = new XMLHttpRequest();
  xhr.responseType = responseType;
  xhr.open(method, url, isAsync);
  const settled = new Promise((resolve) => {
    xhr.addEventListener('loadend', () => resolve(xhr));
    xhr.addEventListener('error', () => resolve(xhr));
  });
  const states = [];
  xhr.addEventListener('readystatechange', () => states.push(xhr.readyState));
  xhr.send();
  return { xhr, settled, states };
}

{
  pushRules([rule({ enabled: true, url: '*/api/x', json: { ok: 1 } })]);
  const { xhr, settled, states } = runXhr('/api/x');
  await settled;
  check('a matched xhr never reaches the network', networkSends.length, 0);
  check('a matched xhr reports the mocked status', xhr.status, 200);
  check('a matched xhr reports the mocked body', xhr.responseText, '{"ok":1}');
  check('a matched xhr exposes the body on response', xhr.response, '{"ok":1}');
  check('a matched xhr reports the mocked headers',
    xhr.getResponseHeader('Content-Type'), 'application/json');
  check('a matched xhr reports raw headers the way libraries parse them',
    xhr.getAllResponseHeaders(), 'content-type: application/json\r\n');
  check('a matched xhr reports the request url', xhr.responseURL, 'https://app.example.com/api/x');
  check('a matched xhr ends at readyState 4', xhr.readyState, 4);
  check('a matched xhr walks the readyState ladder', states.join(','), '2,3,4');
}

{
  pushRules([rule({ enabled: true, url: '*/api/j', json: { n: 7 } })]);
  const { xhr, settled } = runXhr('/api/j', { responseType: 'json' });
  await settled;
  check('responseType json hands back a parsed object', xhr.response.n, 7);
  check('responseType json leaves responseText empty, as the spec requires',
    xhr.responseText, '');
}

{
  pushRules([rule({ enabled: true, url: '*/api/no', mode: 'fail' })]);
  const { xhr, settled } = runXhr('/api/no');
  await settled;
  check('a failed xhr reports status 0', xhr.status, 0);
  check('a failed xhr never reaches the network', networkSends.length, 0);
}

{
  pushRules([rule({ enabled: true, url: '*/api/p', mode: 'passthrough' })]);
  // The fake network never answers, so wait on the tick rather than on `loadend`.
  runXhr('/api/p');
  await new Promise((resolve) => setTimeout(resolve, 20));
  check('a passed-through xhr reaches the network', networkSends.length, 1);
}

{
  pushRules([rule({ enabled: true, url: '*/api/sync', status: 500 })]);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/sync', false);
  xhr.send();
  check('a synchronous xhr is left alone rather than mocked', networkSends.length, 2);
}

// ---- the page-facing API ----

check('the page API is on window', typeof window.djauntMock.add, 'function');
check('the page API is frozen', Object.isFrozen(window.djauntMock), true);

{
  snapshotAfterWrite = [rule({ enabled: true, url: '*/api/new', status: 418 })];
  const result = await window.djauntMock.add({ url: '*/api/new' });
  check('an API call round-trips through the bridge', result.echo, 'add');
  check('a rule added through the API defaults to enabled',
    lastCall('add').payload.rule.enabled, true);

  // The point of holding the promise: the next line must already see the rule.
  const response = await window.fetch('/api/new');
  check('a rule is live the moment add resolves', response.status, 418);
}

{
  await window.djauntMock.add({ url: '*/api/new', enabled: false });
  check('an explicit enabled false is respected',
    lastCall('add').payload.rule.enabled, false);
}

check('the API reports the snapshot it is running',
  (await window.djauntMock.active()).length, 1);
check('the active snapshot carries no compiled regex that JSON would drop',
  'compiled' in (await window.djauntMock.active())[0], false);
check('a read is not held back for a snapshot',
  (await window.djauntMock.list()).echo, 'list');

// ---- report ----

if (failures.length) {
  console.error(`\n${failures.length} failing, ${pass} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`${pass} passing`);
