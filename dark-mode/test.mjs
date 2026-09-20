import './logic.js';

const { relativeLuminance, parseColor, isAlreadyDark, resolveApplied } = globalThis.__djauntDarkMode;

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

// ---- relativeLuminance ----

check('white is fully luminant', Math.round(relativeLuminance(255, 255, 255) * 1e10) / 1e10, 1);
check('black has no luminance', relativeLuminance(0, 0, 0), 0);
check('green weighs more than red or blue',
  relativeLuminance(0, 255, 0) > relativeLuminance(255, 0, 0), true);

// ---- parseColor ----

check('parses rgb()', JSON.stringify(parseColor('rgb(10, 20, 30)')), '{"r":10,"g":20,"b":30,"a":1}');
check('parses rgba()', JSON.stringify(parseColor('rgba(10, 20, 30, 0.5)')),
  '{"r":10,"g":20,"b":30,"a":0.5}');
check('rejects a non-color string', parseColor('transparent'), null);
check('rejects garbage inside the parens', parseColor('rgb(a, b, c)'), null);
check('rejects an empty string', parseColor(''), null);
check('rejects undefined', parseColor(undefined), null);

// ---- isAlreadyDark ----

check('near-black reads as already dark', isAlreadyDark({ r: 10, g: 10, b: 10, a: 1 }), true);
check('near-white reads as not already dark', isAlreadyDark({ r: 245, g: 245, b: 245, a: 1 }), false);
check('a fully transparent color is inconclusive',
  isAlreadyDark({ r: 0, g: 0, b: 0, a: 0 }), null);
check('a barely-visible color still counts',
  isAlreadyDark({ r: 0, g: 0, b: 0, a: 0.01 }), true);

const justAbove = 0.4 * 255 + 1;
const justBelow = 0.4 * 255 - 1;
check('just above the threshold is not dark',
  isAlreadyDark({ r: justAbove, g: justAbove, b: justAbove, a: 1 }), false);
check('just below the threshold is dark',
  isAlreadyDark({ r: justBelow, g: justBelow, b: justBelow, a: 1 }), true);

// ---- resolveApplied ----

check('override on applies regardless of the global switch',
  resolveApplied({ override: 'on', globalEnabled: false }), true);
check('override on applies when the global switch is also on',
  resolveApplied({ override: 'on', globalEnabled: true }), true);
check('override off never applies',
  resolveApplied({ override: 'off', globalEnabled: true }), false);
check('no override, global off does not apply',
  resolveApplied({ override: undefined, globalEnabled: false }), false);
check('no override, global on applies optimistically',
  resolveApplied({ override: undefined, globalEnabled: true }), true);

// ---- report ----

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${pass} passed`);
