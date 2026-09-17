import {
  applyQueryTransform, buildRules, migrateConfig, newTweak, parseAddList, parseRemoveList,
  previewTweak, resolveEnabledTweaks, resolveTweak,
} from './params.js';

let pass = 0;
const failures = [];

/** Runs the first rule whose condition matches, the way Chrome picks by priority. */
function rewrite(rules, resolvedByRuleId, url) {
  for (const rule of rules) {
    if (!new RegExp(rule.condition.regexFilter, 'i').test(url)) continue;
    const parsed = new URL(url);
    const search = applyQueryTransform(parsed.search, resolvedByRuleId.get(rule.id));
    return `${parsed.origin}${parsed.pathname}${search}${parsed.hash}`;
  }
  return null;
}

function install(tweaks) {
  const { ready, broken } = resolveEnabledTweaks(tweaks);
  const rules = buildRules(ready);
  const resolvedByRuleId = new Map(rules.map((rule, index) => [rule.id, ready[index]]));
  return { rules, broken, run: (url) => rewrite(rules, resolvedByRuleId, url) };
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
check('remove list drops duplicates', parseRemoveList('a, a, b').join('|'), 'a|b');
check('add list keeps the last value for a repeated key',
  JSON.stringify(parseAddList('lang=en\nlang=es')), '[{"key":"lang","value":"es"}]');
check('add list accepts an empty value',
  JSON.stringify(parseAddList('flag=')), '[{"key":"flag","value":""}]');
check('add list keeps = inside the value',
  JSON.stringify(parseAddList('q=a=b')), '[{"key":"q","value":"a=b"}]');
checkThrows('add entry without = is rejected', () => parseAddList('debug'));
checkThrows('param name with & is rejected', () => parseRemoveList('a&b'));
checkThrows('tweak with no changes is rejected',
  () => resolveTweak({ host: 'app.example.com' }));
checkThrows('same param removed and set is rejected',
  () => resolveTweak({ host: 'app.example.com', remove: 'lang', add: 'lang=es' }));
checkThrows('invalid domain is rejected', () => resolveTweak({ host: 'not a host', add: 'a=1' }));

// ---- rewriting ----

const basic = install([{ enabled: true, host: 'app.example.com', remove: 'token', add: 'debug=1' }]);

check('named param removed, new param appended',
  basic.run('https://app.example.com/read?token=abc&id=42'),
  'https://app.example.com/read?id=42&debug=1');

check('every copy of a removed param goes',
  basic.run('https://app.example.com/?token=a&token=b&id=1'),
  'https://app.example.com/?id=1&debug=1');

check('existing key is replaced in place, not appended',
  basic.run('https://app.example.com/?debug=0&id=1'),
  'https://app.example.com/?debug=1&id=1');

check('duplicate copies of a replaced key collapse to one',
  basic.run('https://app.example.com/?debug=0&id=1&debug=9'),
  'https://app.example.com/?debug=1&id=1');

check('a bare origin gets the added param',
  basic.run('https://app.example.com/'),
  'https://app.example.com/?debug=1');

check('untouched params keep their encoding',
  basic.run('https://app.example.com/?r=a%2Bb%26c&token=x'),
  'https://app.example.com/?r=a%2Bb%26c&debug=1');

check('a percent-encoded key is matched decoded (preview semantics)',
  basic.run('https://app.example.com/?to%6Ben=abc&id=1'),
  'https://app.example.com/?id=1&debug=1');

check('a valueless param is removed by name',
  install([{ enabled: true, host: 'app.example.com', remove: 'flag' }])
    .run('https://app.example.com/?flag&id=1'),
  'https://app.example.com/?id=1');

check('fragment survives the rewrite',
  basic.run('https://app.example.com/?token=a&id=1#frag'),
  'https://app.example.com/?id=1&debug=1#frag');

check('removing the only param leaves no question mark',
  install([{ enabled: true, host: 'app.example.com', remove: 'token' }])
    .run('https://app.example.com/read?token=abc'),
  'https://app.example.com/read');

check('path is untouched',
  basic.run('https://app.example.com/a/b/c.html?token=1'),
  'https://app.example.com/a/b/c.html?debug=1');

check('rewriting is idempotent, so no redirect loop',
  basic.run(basic.run('https://app.example.com/?token=a&id=1')),
  basic.run('https://app.example.com/?token=a&id=1'));

// ---- host matching ----

check('http is matched as well as https',
  basic.run('http://app.example.com/?token=a'), 'http://app.example.com/?debug=1');
check('any port matches when none is given',
  basic.run('https://app.example.com:8443/?token=a'), 'https://app.example.com:8443/?debug=1');
check('host-prefix lookalike is not matched',
  basic.run('https://app.example.com.evil.test/?token=a'), null);
check('host-suffix lookalike is not matched',
  basic.run('https://not-app.example.com/?token=a'), null);
check('a subdomain is not matched',
  basic.run('https://staging.app.example.com/?token=a'), null);

const ported = install([{ enabled: true, host: 'localhost:8080', remove: 'token' }]);
check('an explicit port matches only that port',
  ported.run('http://localhost:8080/?token=a'), 'http://localhost:8080/');
check('an explicit port rejects another port',
  ported.run('http://localhost:3000/?token=a'), null);

// ---- rows are independent ----

const many = install([
  { enabled: true, host: 'one.example.com', remove: 'token' },
  { enabled: true, host: 'two.example.com', add: 'lang=es' },
  { enabled: false, host: 'three.example.com', add: 'x=1' },
]);
check('two enabled rows install two rules', many.rules.length, 2);
check('rule ids are unique', new Set(many.rules.map((rule) => rule.id)).size, 2);
check('a disabled row installs nothing', many.run('https://three.example.com/?x=0'), null);
check('row one routes on its own domain',
  many.run('https://one.example.com/?token=a&keep=1'), 'https://one.example.com/?keep=1');
check('row two routes on its own domain',
  many.run('https://two.example.com/?keep=1'), 'https://two.example.com/?keep=1&lang=es');

const shared = install([
  { enabled: true, host: 'dup.example.com', add: 'winner=top' },
  { enabled: true, host: 'dup.example.com', add: 'winner=bottom' },
]);
check('the row nearer the top has the higher priority',
  shared.rules[0].priority > shared.rules[1].priority, true);
check('the row nearer the top wins a shared domain',
  shared.run('https://dup.example.com/'), 'https://dup.example.com/?winner=top');

const mixed = install([
  { enabled: true, host: '', add: 'x=1' },
  { enabled: true, host: 'good.example.com', add: 'x=1' },
]);
check('a broken row is skipped, not fatal', mixed.rules.length, 1);
check('the broken row is reported', mixed.broken.length, 1);
check('the healthy row still runs',
  mixed.run('https://good.example.com/'), 'https://good.example.com/?x=1');

// ---- scope ----

const navOnly = buildRules([resolveTweak({ host: 'a.example.com', add: 'x=1' })])[0];
const everything = buildRules([
  resolveTweak({ host: 'a.example.com', add: 'x=1', scope: 'all' }),
])[0];
check('navigation scope covers page and iframe loads only',
  navOnly.condition.resourceTypes.join(','), 'main_frame,sub_frame');
check('all scope covers xmlhttprequest',
  everything.condition.resourceTypes.includes('xmlhttprequest'), true);

// ---- rule shape Chrome has to accept ----

const shaped = buildRules([resolveTweak({ host: 'a.example.com', remove: 'token', add: 'x=1' })])[0];
check('action is a redirect transform', shaped.action.type, 'redirect');
check('removeParams is carried through',
  shaped.action.redirect.transform.queryTransform.removeParams.join(','), 'token');
check('addOrReplaceParams is carried through',
  JSON.stringify(shaped.action.redirect.transform.queryTransform.addOrReplaceParams),
  '[{"key":"x","value":"1"}]');
check('an empty transform key is omitted rather than sent empty',
  'addOrReplaceParams' in buildRules([resolveTweak({ host: 'a.example.com', remove: 'token' })])[0]
    .action.redirect.transform.queryTransform,
  false);

// ---- preview and storage ----

const resolved = resolveTweak({ host: 'app.example.com', remove: 'token', add: 'debug=1' });
check('preview matches the rule result',
  previewTweak(resolved, 'https://app.example.com/?token=a&id=1'),
  'https://app.example.com/?id=1&debug=1');
check('preview returns null for another domain',
  previewTweak(resolved, 'https://other.example.com/?token=a'), null);
check('preview returns null for a non-URL', previewTweak(resolved, 'not a url'), null);

check('empty storage yields one blank row', migrateConfig({}).tweaks.length, 1);
check('a saved row keeps its id',
  migrateConfig({ tweaks: [{ id: 'keep-me', host: 'a.example.com' }] }).tweaks[0].id, 'keep-me');
check('a saved row missing an id gets one',
  Boolean(migrateConfig({ tweaks: [{ host: 'a.example.com' }] }).tweaks[0].id), true);
check('a saved row gains the default scope',
  migrateConfig({ tweaks: [{ host: 'a.example.com' }] }).tweaks[0].scope, 'navigation');
check('a new row starts disabled', newTweak().enabled, false);

// ---- report ----

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${pass} passed`);
