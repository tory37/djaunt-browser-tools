import {
  ALL_RULE_IDS, MAX_REWRITES, RULES_PER_REWRITE, applyQueryTransform, buildRules, newRewrite,
  parseAddList, parseRemoveList, parseTarget, previewRewrite, resolveEnabledRewrites,
  resolveRewrite,
} from './rewrite.js';

let pass = 0;
const failures = [];

const MAX_HOPS = 10;

function applyTransform(transform, url) {
  const parsed = new URL(url);
  const scheme = transform.scheme ?? parsed.protocol.slice(0, -1);
  const host = transform.host ?? parsed.hostname;
  const port = 'port' in transform ? transform.port : parsed.port;
  const search = transform.queryTransform
    ? applyQueryTransform(parsed.search, {
      removeParams: transform.queryTransform.removeParams ?? [],
      addOrReplaceParams: transform.queryTransform.addOrReplaceParams ?? [],
    })
    : parsed.search;
  return `${scheme}://${host}${port ? `:${port}` : ''}${parsed.pathname}${search}${parsed.hash}`;
}

/** One request: the highest-priority matching rule wins, ties go to the earlier rule. */
function redirectOnce(rules, url, resourceType) {
  let winner = null;
  let winnerMatch = null;
  for (const rule of rules) {
    if (!rule.condition.resourceTypes.includes(resourceType)) continue;
    const match = new RegExp(rule.condition.regexFilter, 'i').exec(url);
    if (!match) continue;
    if (winner && rule.priority <= winner.priority) continue;
    winner = rule;
    winnerMatch = match;
  }
  if (!winner) return null;
  const { redirect } = winner.action;
  const next = redirect.transform
    ? applyTransform(redirect.transform, url)
    : redirect.regexSubstitution.replace(/\\(\d)/g, (_, n) => winnerMatch[Number(n)] ?? '');
  return next === url ? null : next;
}

/** Chrome re-runs the rules on every redirected request, so follow the chain until it settles. */
function follow(rules, url, resourceType = 'main_frame') {
  let current = url;
  let hops = 0;
  for (;;) {
    const next = redirectOnce(rules, current, resourceType);
    if (next === null) return { url: hops ? current : null, hops };
    hops += 1;
    if (hops > MAX_HOPS) return { url: 'LOOP', hops };
    current = next;
  }
}

function install(rewrites) {
  const { ready, broken } = resolveEnabledRewrites(
    rewrites.map((rewrite) => ({ enabled: true, ...rewrite })));
  const rules = buildRules(ready);
  return {
    rules,
    ready,
    broken,
    run: (url, resourceType) => follow(rules, url, resourceType).url,
    hops: (url, resourceType) => follow(rules, url, resourceType).hops,
  };
}

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

// ---- parsing ----

check('remove list splits on commas, spaces and newlines',
  parseRemoveList('token, id\nutm_source  ref').join('|'), 'token|id|utm_source|ref');
check('add list keeps the last value for a repeated key',
  JSON.stringify(parseAddList('lang=en\nlang=es')), '[{"key":"lang","value":"es"}]');
check('target without a scheme defaults to https', parseTarget('b.test').scheme, 'https');
check('target keeps an explicit http scheme', parseTarget('http://b.test').scheme, 'http');
check('target port is split out', parseTarget('localhost:3000').port, '3000');
check('target trailing slash is not a path prefix', parseTarget('b.test/').pathPrefix, '');

// ---- validation ----

checkThrows('row with no target and no params is rejected',
  () => resolveRewrite({ sourceHost: 'a.test' }));
checkThrows('same host target is rejected',
  () => resolveRewrite({ sourceHost: 'a.test', target: 'a.test' }));
checkThrows('same host with a path prefix is rejected, it would loop',
  () => resolveRewrite({ sourceHost: 'a.test', target: 'a.test/branch' }));
checkThrows('portless source with a target on the same host is rejected',
  () => resolveRewrite({ sourceHost: 'a.test', target: 'a.test:3000' }));
checkThrows('same param removed and set is rejected',
  () => resolveRewrite({ sourceHost: 'a.test', remove: 'lang', add: 'lang=es' }));
checkThrows('ftp target is rejected',
  () => resolveRewrite({ sourceHost: 'a.test', target: 'ftp://b.test' }));
checkThrows('bad source host is rejected',
  () => resolveRewrite({ sourceHost: 'not a host', target: 'b.test' }));
checkThrows('add entry without = is rejected',
  () => resolveRewrite({ sourceHost: 'a.test', add: 'debug' }));
check('different ports on one host are allowed',
  resolveRewrite({ sourceHost: 'localhost:8080', target: 'localhost:3000' }).target.port, '3000');

// ---- swap only ----

const swapOnly = install([{ sourceHost: 'old.example.com', target: 'new.example.com' }]);
check('swap only: one rule', swapOnly.rules.length, 1);
check('swap only: path, query and fragment kept',
  swapOnly.run('https://old.example.com/story/read?id=7&x=1#frag'),
  'https://new.example.com/story/read?id=7&x=1#frag');
check('swap only: http source moves to the https target',
  swapOnly.run('http://old.example.com/?a=1'), 'https://new.example.com/?a=1');
check('swap only: encoded query left byte-identical',
  swapOnly.run('https://old.example.com/?r=a%2Bb%26c&t=x%3Dy'),
  'https://new.example.com/?r=a%2Bb%26c&t=x%3Dy');
check('swap only: no queryTransform is sent',
  'queryTransform' in swapOnly.rules[0].action.redirect.transform, false);
check('swap only: host-prefix lookalike untouched',
  swapOnly.run('https://old.example.com.evil.test/'), null);
check('swap only: host-suffix lookalike untouched',
  swapOnly.run('https://not-old.example.com/'), null);
check('swap only: one hop', swapOnly.hops('https://old.example.com/?a=1'), 1);

// ---- params only ----

const paramsOnly = install([{ sourceHost: 'app.example.com', remove: 'token', add: 'debug=1' }]);
check('params only: one rule', paramsOnly.rules.length, 1);
check('params only: no host in the transform',
  'host' in paramsOnly.rules[0].action.redirect.transform, false);
check('params only: param removed and added',
  paramsOnly.run('https://app.example.com/read?token=abc&id=42'),
  'https://app.example.com/read?id=42&debug=1');
check('params only: existing key replaced in place',
  paramsOnly.run('https://app.example.com/?debug=0&id=1'), 'https://app.example.com/?debug=1&id=1');
check('params only: already-correct URL is left alone',
  paramsOnly.run('https://app.example.com/?id=1&debug=1'), null);

// ---- swap and params, bare host ----

const bare = install([{
  sourceHost: 'old.example.com', target: 'new.example.com', remove: 'token', add: 'debug=1',
}]);
check('bare host: one rule', bare.rules.length, 1);
check('bare host: swap and params in one hop',
  bare.run('https://old.example.com/read?token=abc&id=42#f'),
  'https://new.example.com/read?id=42&debug=1#f');
check('bare host: one hop', bare.hops('https://old.example.com/read?token=abc'), 1);
check('bare host: rule uses transform, not regexSubstitution',
  'regexSubstitution' in bare.rules[0].action.redirect, false);
check('bare host: no path-prefix warning', bare.ready[0].paramsMatchTarget, false);
check('bare host: direct visit to the target is untouched',
  bare.run('https://new.example.com/?token=abc'), null);

// ---- swap and params, path prefix ----

const prefixed = install([{
  sourceHost: 'old.example.com', target: 'https://new.example.com/my-branch/', remove: 'token', add: 'debug=1',
}]);
check('path prefix: three rules', prefixed.rules.length, 3);
check('path prefix: two-hop chain ends correct',
  prefixed.run('https://old.example.com/read?token=abc&id=42#f'),
  'https://new.example.com/my-branch/read?id=42&debug=1#f');
check('path prefix: takes two hops', prefixed.hops('https://old.example.com/read?token=abc'), 2);
check('path prefix: bare origin gets prefix and params',
  prefixed.run('https://old.example.com'), 'https://new.example.com/my-branch?debug=1');
check('path prefix: warning flag is set', prefixed.ready[0].paramsMatchTarget, true);
check('path prefix: params rule also edits a direct visit to the target',
  prefixed.run('https://new.example.com/my-branch/x?token=a'),
  'https://new.example.com/my-branch/x?debug=1');
check('path prefix: target host outside the prefix is untouched',
  prefixed.run('https://new.example.com/other?token=a'), null);
check('path prefix: prefix lookalike is untouched',
  prefixed.run('https://new.example.com/my-branch-2/?token=a'), null);

const prefixedSwapOnly = install([{ sourceHost: 'old.example.com', target: 'new.example.com/sub' }]);
check('path prefix, swap only: two rules', prefixedSwapOnly.rules.length, 2);
check('path prefix, swap only: no warning', prefixedSwapOnly.ready[0].paramsMatchTarget, false);
check('path prefix, swap only: prefix prepended',
  prefixedSwapOnly.run('https://old.example.com/x?q=1'), 'https://new.example.com/sub/x?q=1');

// ---- ports ----

const ported = install([{ sourceHost: 'localhost:8080', target: 'localhost:3000', add: 'debug=1' }]);
check('port: explicit source port is swapped to the target port',
  ported.run('http://localhost:8080/?a=1'), 'https://localhost:3000/?a=1&debug=1');
check('port: another source port is untouched', ported.run('http://localhost:9999/?a=1'), null);

const anyPort = install([{ sourceHost: 'a.test', target: 'b.test', add: 'x=1' }]);
check('port: portless source matches any port, and the port is cleared',
  anyPort.run('https://a.test:8443/p'), 'https://b.test/p?x=1');

const httpTarget = install([{ sourceHost: 'a.test', target: 'http://localhost:3000' }]);
check('port: http target keeps its scheme and port',
  httpTarget.run('https://a.test/p?q=1'), 'http://localhost:3000/p?q=1');

const prefixedPort = install([{ sourceHost: 'a.test', target: 'localhost:3000/app', add: 'x=1' }]);
check('port: path prefix chain lands on the target port',
  prefixedPort.run('https://a.test/p'), 'https://localhost:3000/app/p?x=1');

// ---- priority between rows ----

const shared = install([
  { sourceHost: 'dup.test', target: 'first.test', add: 'winner=top' },
  { sourceHost: 'dup.test', target: 'second.test', add: 'winner=bottom' },
]);
check('top row has the higher priority', shared.rules[0].priority > shared.rules[1].priority, true);
check('top row wins a shared host', shared.run('https://dup.test/'), 'https://first.test/?winner=top');

const sharedPrefixed = install([
  { sourceHost: 'dup.test', target: 'first.test/a', add: 'winner=top' },
  { sourceHost: 'dup.test', add: 'winner=bottom' },
]);
check('top path-prefix row beats a lower params row on the same host',
  sharedPrefixed.run('https://dup.test/x'), 'https://first.test/a/x?winner=top');

const many = install([
  { sourceHost: 'one.test', target: 'one-b.test' },
  { sourceHost: 'two.test', remove: 'token' },
  { sourceHost: 'three.test', target: 'three-b.test/sub', add: 'x=1' },
]);
check('rule ids are unique', new Set(many.rules.map((rule) => rule.id)).size, many.rules.length);
check('row ids stay inside their slot',
  many.rules.every((rule) => rule.id >= 1 && rule.id <= 3 * RULES_PER_REWRITE), true);
check('row three starts at its own slot', many.rules.find((rule) => rule.id > 6).id, 7);
check('row one routes on its own host', many.run('https://one.test/x'), 'https://one-b.test/x');
check('row two routes on its own host', many.run('https://two.test/?token=a&k=1'), 'https://two.test/?k=1');
check('row three routes on its own host',
  many.run('https://three.test/x'), 'https://three-b.test/sub/x?x=1');
check('host outside every row is untouched', many.run('https://four.test/x'), null);

// ---- scope ----

const navOnly = install([{ sourceHost: 'a.test', target: 'b.test/sub', add: 'x=1' }]);
const everything = install([{ sourceHost: 'a.test', target: 'b.test/sub', add: 'x=1', scope: 'all' }]);
check('navigation scope: page and iframe loads only',
  navOnly.rules.every((rule) => rule.condition.resourceTypes.join(',') === 'main_frame,sub_frame'), true);
check('navigation scope: xhr untouched', navOnly.run('https://a.test/api', 'xmlhttprequest'), null);
check('navigation scope: iframe rewritten',
  navOnly.run('https://a.test/f', 'sub_frame'), 'https://b.test/sub/f?x=1');
check('all scope: every rule covers xhr',
  everything.rules.every((rule) => rule.condition.resourceTypes.includes('xmlhttprequest')), true);
check('all scope: xhr rewritten through the chain',
  everything.run('https://a.test/api', 'xmlhttprequest'), 'https://b.test/sub/api?x=1');

// ---- idempotence ----

for (const [label, installed, url] of [
  ['swap only', swapOnly, 'https://old.example.com/?a=1'],
  ['params only', paramsOnly, 'https://app.example.com/?token=a&id=1'],
  ['bare host', bare, 'https://old.example.com/?token=a&id=1'],
  ['path prefix', prefixed, 'https://old.example.com/?token=a&id=1'],
  ['port', ported, 'http://localhost:8080/?a=1'],
]) {
  const final = installed.run(url);
  check(`${label}: final URL does not trigger another change`, installed.run(final), null);
}

// ---- enable state and broken rows ----

const mixed = resolveEnabledRewrites([
  newRewrite({ enabled: true, sourceHost: 'a.test', target: 'a2.test' }),
  newRewrite({ enabled: false, sourceHost: 'b.test', target: 'b2.test' }),
  newRewrite({ enabled: true, sourceHost: 'c.test' }),
]);
check('only enabled and valid rows install', mixed.ready.length, 1);
check('enabled but broken row is reported', mixed.broken.length, 1);
check('broken row keeps its index', mixed.broken[0].index, 2);
check('one broken row does not block a good row',
  follow(buildRules(mixed.ready), 'https://a.test/x').url, 'https://a2.test/x');
check('a new row starts disabled', newRewrite().enabled, false);
check('a new row gets an id', Boolean(newRewrite().id), true);

// ---- rule id range ----

check('rule id range covers the worst case', ALL_RULE_IDS.length, MAX_REWRITES * RULES_PER_REWRITE);
const full = buildRules(Array.from({ length: MAX_REWRITES + 5 }, (_, index) =>
  resolveRewrite({ sourceHost: `h${index}.test`, target: `t${index}.test/p`, add: 'x=1' })));
check('rows past the cap are dropped', full.length, MAX_REWRITES * RULES_PER_REWRITE);
check('every rule id is in the reserved range',
  full.every((rule) => ALL_RULE_IDS.includes(rule.id)), true);

// ---- preview ----

check('preview: bare host matches the rules',
  previewRewrite(bare.ready[0], 'https://old.example.com/read?token=abc&id=42#f'),
  bare.run('https://old.example.com/read?token=abc&id=42#f'));
check('preview: path prefix matches the rule chain',
  previewRewrite(prefixed.ready[0], 'https://old.example.com/read?token=abc&id=42'),
  prefixed.run('https://old.example.com/read?token=abc&id=42'));
check('preview: params only keeps the origin',
  previewRewrite(paramsOnly.ready[0], 'http://app.example.com:8443/?token=a'),
  'http://app.example.com:8443/?debug=1');
check('preview: swap only leaves the query as is',
  previewRewrite(swapOnly.ready[0], 'https://old.example.com/?b=2&a=1'),
  'https://new.example.com/?b=2&a=1');
check('preview: another host returns null',
  previewRewrite(bare.ready[0], 'https://other.example.com/'), null);
check('preview: a non-URL returns null', previewRewrite(bare.ready[0], 'not a url'), null);

// ---- report ----

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${pass} passed`);
