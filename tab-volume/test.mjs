import { FULL_VOLUME, clamp, hostOf, levelFor, pickVolume } from './logic.js';

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

// ---- clamp ----

check('a mid-range value passes through', clamp(0.5), 0.5);
check('a negative value clamps to 0', clamp(-1), 0);
check('a value above 1 clamps to 1', clamp(1.5), 1);
check('NaN clamps to 0', clamp('not a number'), 0);
check('undefined clamps to 0', clamp(undefined), 0);
check('the lower bound is inclusive', clamp(0), 0);
check('the upper bound is inclusive', clamp(1), 1);

// ---- hostOf ----

check('extracts the hostname from an https URL', hostOf('https://app.example.com/path'), 'app.example.com');
check('extracts the hostname from an http URL', hostOf('http://app.example.com'), 'app.example.com');
check('a chrome:// URL is unsupported', hostOf('chrome://extensions'), null);
check('a file:// URL is unsupported', hostOf('file:///tmp/x.html'), null);
check('a malformed URL is unsupported', hostOf('not a url'), null);
check('the port is not part of the host', hostOf('https://app.example.com:8443/'), 'app.example.com');

// ---- pickVolume ----

check('a tab volume wins over a domain volume', pickVolume(0.2, 0.8), 0.2);
check('a domain volume is used when there is no tab volume', pickVolume(undefined, 0.8), 0.8);
check('full volume is the default when neither is set', pickVolume(undefined, undefined), FULL_VOLUME);
check('a tab volume of 0 still wins (falsy but a real number)', pickVolume(0, 0.8), 0);
check('a non-number domain volume is ignored', pickVolume(undefined, 'oops'), FULL_VOLUME);

// ---- levelFor ----

check('0 percent is muted', levelFor(0), 'muted');
check('1 percent is low', levelFor(1), 'low');
check('33 percent is still low', levelFor(33), 'low');
check('34 percent is mid', levelFor(34), 'mid');
check('66 percent is still mid', levelFor(66), 'mid');
check('67 percent is high', levelFor(67), 'high');
check('100 percent is high', levelFor(100), 'high');

// ---- report ----

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${pass} passed`);
