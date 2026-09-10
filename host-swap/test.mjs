import {
  resolveConfig, buildRules, previewSwap, resolveEnabledSwaps, migrateConfig, newSwap,
} from './swap.js';

let pass = 0;
const failures = [];

function applyRules(rules, url) {
  for (const rule of rules) {
    const re = new RegExp(rule.condition.regexFilter, 'i');
    const match = re.exec(url);
    if (!match) continue;
    return rule.action.redirect.regexSubstitution.replace(
      /\\(\d)/g, (_, n) => match[Number(n)] ?? '');
  }
  return null;
}

function check(label, actual, expected) {
  if (actual === expected) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

const basic = resolveConfig({
  sourceHost: 'old-host.example.com',
  target: 'new-host.example.com',
});
const basicRules = buildRules(basic);

check('query params preserved',
  applyRules(basicRules, 'https://old-host.example.com/?token=abc&id=42'),
  'https://new-host.example.com/?token=abc&id=42');

check('deep path plus query preserved',
  applyRules(basicRules, 'https://old-host.example.com/story/read?id=7&x=1'),
  'https://new-host.example.com/story/read?id=7&x=1');

check('fragment preserved',
  applyRules(basicRules, 'https://old-host.example.com/?a=1#frag'),
  'https://new-host.example.com/?a=1#frag');

check('bare origin, no trailing slash',
  applyRules(basicRules, 'https://old-host.example.com'),
  'https://new-host.example.com');

check('http scheme also swapped',
  applyRules(basicRules, 'http://old-host.example.com/?a=1'),
  'https://new-host.example.com/?a=1');

check('encoded query left byte-identical',
  applyRules(basicRules, 'https://old-host.example.com/?r=a%2Bb%26c&t=x%3Dy'),
  'https://new-host.example.com/?r=a%2Bb%26c&t=x%3Dy');

check('host-prefix hijack rejected',
  applyRules(basicRules, 'https://old-host.example.com.evil.example/?a=1'),
  null);

check('host-suffix hijack rejected',
  applyRules(basicRules, 'https://not-old-host.example.com/?a=1'),
  null);

check('unrelated host untouched',
  applyRules(basicRules, 'https://assets.other.example.com/build/x.png'),
  null);

const prefixed = resolveConfig({
  sourceHost: 'old-host.example.com',
  target: 'https://new-host.example.com/my-branch/',
});
const prefixedRules = buildRules(prefixed);

check('target path prefix prepended, query kept',
  applyRules(prefixedRules, 'https://old-host.example.com/?token=abc'),
  'https://new-host.example.com/my-branch/?token=abc');

check('target path prefix on bare origin',
  applyRules(prefixedRules, 'https://old-host.example.com'),
  'https://new-host.example.com/my-branch');

const localhost = resolveConfig({ sourceHost: 'localhost:8080', target: 'localhost:3000' });
const localhostRules = buildRules(localhost);

check('explicit source port matched',
  applyRules(localhostRules, 'http://localhost:8080/?a=1'),
  'https://localhost:3000/?a=1');

check('other port not matched when source pins one',
  applyRules(localhostRules, 'http://localhost:9999/?a=1'),
  null);

check('portless source matches any port',
  applyRules(buildRules(resolveConfig({ sourceHost: 'example.test', target: 'b.test' })),
    'https://example.test:8443/?a=1'),
  'https://b.test/?a=1');

check('preview agrees with rules',
  previewSwap(basic, 'https://old-host.example.com/?token=abc&id=1'),
  'https://new-host.example.com/?token=abc&id=1');

check('scope all covers xhr',
  buildRules(resolveConfig({ sourceHost: 'a.test', target: 'b.test', scope: 'all' }))[1]
    .condition.resourceTypes.includes('xmlhttprequest'),
  true);

check('scope navigation excludes xhr',
  basicRules[1].condition.resourceTypes.includes('xmlhttprequest'),
  false);

for (const [label, cfg] of [
  ['empty target rejected', { sourceHost: 'a.test', target: '' }],
  ['same host rejected', { sourceHost: 'a.test', target: 'a.test' }],
  ['ftp target rejected', { sourceHost: 'a.test', target: 'ftp://b.test' }],
  ['bad source rejected', { sourceHost: 'not a host', target: 'b.test' }],
]) {
  let threw = false;
  try { resolveConfig(cfg); } catch { threw = true; }
  check(label, threw, true);
}

// ---- multiple swaps ----

const multi = [
  resolveConfig({ sourceHost: 'a.test', target: 'a-branch.test' }),
  resolveConfig({ sourceHost: 'b.test', target: 'b-branch.test/sub' }),
];
const multiRules = buildRules(multi);

check('two swaps build four rules', multiRules.length, 4);

check('rule ids are unique', new Set(multiRules.map((r) => r.id)).size, 4);

check('first swap routes independently',
  applyRules(multiRules, 'https://a.test/x?q=1'),
  'https://a-branch.test/x?q=1');

check('second swap routes independently',
  applyRules(multiRules, 'https://b.test/x?q=1'),
  'https://b-branch.test/sub/x?q=1');

check('host outside every swap untouched',
  applyRules(multiRules, 'https://c.test/x?q=1'),
  null);

const duped = buildRules([
  resolveConfig({ sourceHost: 'dup.test', target: 'first.test' }),
  resolveConfig({ sourceHost: 'dup.test', target: 'second.test' }),
]);

check('earlier row outranks a later row on the same host', duped[0].priority > duped[2].priority, true);

check('scope is per swap',
  buildRules([
    resolveConfig({ sourceHost: 'a.test', target: 'b.test', scope: 'all' }),
    resolveConfig({ sourceHost: 'c.test', target: 'd.test' }),
  ]).map((r) => r.condition.resourceTypes.includes('xmlhttprequest')).join(','),
  'true,true,false,false');

// ---- enable state and storage shape ----

const mixed = resolveEnabledSwaps([
  newSwap({ enabled: true, sourceHost: 'a.test', target: 'a2.test' }),
  newSwap({ enabled: false, sourceHost: 'b.test', target: 'b2.test' }),
  newSwap({ enabled: true, sourceHost: 'c.test', target: '' }),
]);

check('only enabled and valid swaps install', mixed.ready.length, 1);
check('enabled but broken swap is reported', mixed.broken.length, 1);
check('disabled swap is neither', mixed.ready.length + mixed.broken.length, 2);

check('one broken row does not block a good row',
  applyRules(buildRules(mixed.ready), 'https://a.test/x'),
  'https://a2.test/x');

const migrated = migrateConfig({
  enabled: true, sourceHost: 'old.test', target: 'new.test', scope: 'all',
});
check('legacy settings migrate to one swap', migrated.swaps.length, 1);
check('legacy target carried over', migrated.swaps[0].target, 'new.test');
check('legacy scope carried over', migrated.swaps[0].scope, 'all');
check('migrated swap gets an id', Boolean(migrated.swaps[0].id), true);

check('empty storage seeds one swap', migrateConfig({}).swaps.length, 1);
check('seeded swap starts disabled', migrateConfig({}).swaps[0].enabled, false);

const kept = migrateConfig({ swaps: [{ sourceHost: 'x.test', target: 'y.test' }] });
check('existing swaps list is kept', kept.swaps[0].sourceHost, 'x.test');
check('swap without id is given one', Boolean(kept.swaps[0].id), true);


console.log(`${pass + failures.length} assertions, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
