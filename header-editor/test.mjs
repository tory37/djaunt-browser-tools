import {
  applyHeaderTransform, buildRules, migrateConfig, newTweak, parseRemoveList, parseSetList,
  resolveEnabledTweaks, resolveTweak,
} from './headers.js';

let pass = 0;
const failures = [];

/** Runs the first rule whose condition matches, the way Chrome picks by priority. */
function apply(rules, resolvedByRuleId, url, headers) {
  for (const rule of rules) {
    if (!new RegExp(rule.condition.regexFilter, 'i').test(url)) continue;
    return applyHeaderTransform(headers, resolvedByRuleId.get(rule.id));
  }
  return null;
}

function install(tweaks) {
  const { ready, broken } = resolveEnabledTweaks(tweaks);
  const rules = buildRules(ready);
  const resolvedByRuleId = new Map(rules.map((rule, index) => [rule.id, ready[index]]));
  return { rules, broken, run: (url, headers = {}) => apply(rules, resolvedByRuleId, url, headers) };
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

check('remove list splits on commas and newlines',
  parseRemoveList('Referer, Origin\nX-Debug').join('|'), 'Referer|Origin|X-Debug');
check('remove list drops case-insensitive duplicates', parseRemoveList('X-Foo, x-foo').join('|'), 'X-Foo');
check('set list keeps the last value for a repeated header',
  JSON.stringify(parseSetList('X-Env: dev\nX-Env: staging')), '[{"name":"X-Env","value":"staging"}]');
check('set list accepts an empty value',
  JSON.stringify(parseSetList('X-Flag:')), '[{"name":"X-Flag","value":""}]');
check('set list keeps a colon inside the value',
  JSON.stringify(parseSetList('Authorization: Bearer a:b')), '[{"name":"Authorization","value":"Bearer a:b"}]');
checkThrows('set entry without a colon is rejected', () => parseSetList('X-Debug'));
checkThrows('header name with a space is rejected', () => parseRemoveList('X Debug'));
checkThrows('tweak with no changes is rejected',
  () => resolveTweak({ host: 'api.example.com' }));
checkThrows('same header removed and set is rejected',
  () => resolveTweak({ host: 'api.example.com', remove: 'X-Debug', set: 'X-Debug: 1' }));
checkThrows('invalid domain is rejected', () => resolveTweak({ host: 'not a host', set: 'X-Debug: 1' }));

// ---- header transform ----

const basic = install([{ enabled: true, host: 'api.example.com', remove: 'Referer', set: 'X-Debug: 1' }]);

check('a header is set',
  JSON.stringify(basic.run('https://api.example.com/', { Origin: 'https://app.example.com' })),
  JSON.stringify({ Origin: 'https://app.example.com', 'X-Debug': '1' }));

check('a header is removed',
  JSON.stringify(basic.run('https://api.example.com/', { Referer: 'https://x.test', Origin: 'https://app.example.com' })),
  JSON.stringify({ Origin: 'https://app.example.com', 'X-Debug': '1' }));

check('setting an existing header (any case) overwrites it in place',
  JSON.stringify(install([{ enabled: true, host: 'api.example.com', set: 'x-debug: 2' }])
    .run('https://api.example.com/', { 'X-Debug': '1' })),
  JSON.stringify({ 'x-debug': '2' }));

check('removing a header not present does nothing',
  JSON.stringify(install([{ enabled: true, host: 'api.example.com', remove: 'Referer' }])
    .run('https://api.example.com/', { Origin: 'https://app.example.com' })),
  JSON.stringify({ Origin: 'https://app.example.com' }));

// ---- host matching ----

check('http is matched as well as https',
  basic.run('http://api.example.com/', {}) !== null, true);
check('any port matches when none is given',
  basic.run('https://api.example.com:8443/', {}) !== null, true);
check('host-prefix lookalike is not matched',
  basic.run('https://api.example.com.evil.test/', {}), null);
check('host-suffix lookalike is not matched',
  basic.run('https://not-api.example.com/', {}), null);
check('a subdomain is not matched',
  basic.run('https://staging.api.example.com/', {}), null);

const ported = install([{ enabled: true, host: 'localhost:8080', set: 'X-Debug: 1' }]);
check('an explicit port matches only that port',
  ported.run('http://localhost:8080/', {}) !== null, true);
check('an explicit port rejects another port',
  ported.run('http://localhost:3000/', {}), null);

// ---- rows are independent ----

const many = install([
  { enabled: true, host: 'one.example.com', remove: 'Referer' },
  { enabled: true, host: 'two.example.com', set: 'X-Env: staging' },
  { enabled: false, host: 'three.example.com', set: 'X-Env: staging' },
]);
check('two enabled rows install two rules', many.rules.length, 2);
check('rule ids are unique', new Set(many.rules.map((rule) => rule.id)).size, 2);
check('a disabled row installs nothing', many.run('https://three.example.com/', {}), null);
check('row two routes on its own domain',
  JSON.stringify(many.run('https://two.example.com/', {})), JSON.stringify({ 'X-Env': 'staging' }));

const shared = install([
  { enabled: true, host: 'dup.example.com', set: 'X-Winner: top' },
  { enabled: true, host: 'dup.example.com', set: 'X-Winner: bottom' },
]);
check('the row nearer the top has the higher priority',
  shared.rules[0].priority > shared.rules[1].priority, true);
check('the row nearer the top wins a shared domain',
  JSON.stringify(shared.run('https://dup.example.com/', {})), JSON.stringify({ 'X-Winner': 'top' }));

const mixed = install([
  { enabled: true, host: '', set: 'X-Debug: 1' },
  { enabled: true, host: 'good.example.com', set: 'X-Debug: 1' },
]);
check('a broken row is skipped, not fatal', mixed.rules.length, 1);
check('the broken row is reported', mixed.broken.length, 1);
check('the healthy row still runs', mixed.run('https://good.example.com/', {}) !== null, true);

// ---- scope ----

const navOnly = buildRules([resolveTweak({ host: 'a.example.com', set: 'X-Debug: 1', scope: 'navigation' })])[0];
const everything = buildRules([resolveTweak({ host: 'a.example.com', set: 'X-Debug: 1' })])[0];
check('navigation scope covers page and iframe loads only',
  navOnly.condition.resourceTypes.join(','), 'main_frame,sub_frame');
check('the default scope covers xmlhttprequest',
  everything.condition.resourceTypes.includes('xmlhttprequest'), true);

// ---- rule shape Chrome has to accept ----

const shaped = buildRules([resolveTweak({ host: 'a.example.com', remove: 'Referer', set: 'X-Debug: 1' })])[0];
check('action is a modifyHeaders action', shaped.action.type, 'modifyHeaders');
check('a set header uses the set operation',
  JSON.stringify(shaped.action.requestHeaders.find((h) => h.header === 'X-Debug')),
  '{"header":"X-Debug","operation":"set","value":"1"}');
check('a removed header uses the remove operation',
  JSON.stringify(shaped.action.requestHeaders.find((h) => h.header === 'Referer')),
  '{"header":"Referer","operation":"remove"}');

// ---- storage ----

check('empty storage yields one blank row', migrateConfig({}).tweaks.length, 1);
check('a saved row keeps its id',
  migrateConfig({ tweaks: [{ id: 'keep-me', host: 'a.example.com' }] }).tweaks[0].id, 'keep-me');
check('a saved row missing an id gets one',
  Boolean(migrateConfig({ tweaks: [{ host: 'a.example.com' }] }).tweaks[0].id), true);
check('a saved row gains the default scope',
  migrateConfig({ tweaks: [{ host: 'a.example.com' }] }).tweaks[0].scope, 'all');
check('a new row starts disabled', newTweak().enabled, false);

// ---- report ----

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${pass} passed`);
