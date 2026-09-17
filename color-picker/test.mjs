import {
  parseColor, rgbToHex, formatRgb, rgbToHsl, hslToRgb, formatHsl, rgbToOklch,
  formatOklch, relativeLuminance, contrastRatio, contrastRating, gradientCss,
} from './color.js';

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.01
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

// ---- parseColor ----
check('hex6', parseColor('#ff0000'), { r: 255, g: 0, b: 0, a: 1 });
check('hex6 no hash', parseColor('ff0000'), { r: 255, g: 0, b: 0, a: 1 });
check('hex3', parseColor('#f00'), { r: 255, g: 0, b: 0, a: 1 });
check('hex8 with alpha', parseColor('#ff000080'), { r: 255, g: 0, b: 0, a: 128 / 255 });
check('hex4 with alpha', parseColor('#f008'), { r: 255, g: 0, b: 0, a: 136 / 255 });
check('rgb()', parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
check('rgba() with alpha', parseColor('rgba(255, 0, 0, 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
check('rgb() space syntax', parseColor('rgb(0 128 255 / 50%)'), { r: 0, g: 128, b: 255, a: 0.5 });
check('hsl() pure red', parseColor('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0, a: 1 });
check('invalid input', parseColor('not-a-color'), null);
check('non-string input', parseColor(null), null);

// ---- hex round trip ----
check('rgbToHex basic', rgbToHex({ r: 255, g: 0, b: 0 }), '#ff0000');
check('rgbToHex with alpha', rgbToHex({ r: 255, g: 0, b: 0, a: 0.5 }), '#ff000080');
check('rgbToHex clamps out-of-range', rgbToHex({ r: 300, g: -10, b: 0 }), '#ff0000');

// ---- rgb formatting ----
check('formatRgb opaque', formatRgb({ r: 10, g: 20, b: 30 }), 'rgb(10, 20, 30)');
check('formatRgb with alpha', formatRgb({ r: 10, g: 20, b: 30, a: 0.4 }), 'rgba(10, 20, 30, 0.4)');

// ---- hsl <-> rgb ----
const redHsl = rgbToHsl({ r: 255, g: 0, b: 0 });
check('rgbToHsl red hue', Math.round(redHsl.h), 0);
check('rgbToHsl red saturation', Math.round(redHsl.s), 100);
check('rgbToHsl red lightness', Math.round(redHsl.l), 50);

const grayHsl = rgbToHsl({ r: 128, g: 128, b: 128 });
check('rgbToHsl gray has zero saturation', grayHsl.s, 0);

check('hslToRgb red', hslToRgb({ h: 0, s: 100, l: 50 }), { r: 255, g: 0, b: 0 });
check('hslToRgb white', hslToRgb({ h: 0, s: 0, l: 100 }), { r: 255, g: 255, b: 255 });
check('hslToRgb black', hslToRgb({ h: 0, s: 0, l: 0 }), { r: 0, g: 0, b: 0 });
check('formatHsl opaque', formatHsl({ r: 255, g: 0, b: 0 }), 'hsl(0, 100%, 50%)');
check('formatHsl with alpha', formatHsl({ r: 255, g: 0, b: 0, a: 0.5 }), 'hsla(0, 100%, 50%, 0.5)');

// ---- oklch ----
const whiteOklch = rgbToOklch({ r: 255, g: 255, b: 255 });
check('white oklch lightness is ~1', Math.round(whiteOklch.l * 1000) / 1000, 1);
check('white oklch chroma is ~0', whiteOklch.c < 0.001, true);

const blackOklch = rgbToOklch({ r: 0, g: 0, b: 0 });
check('black oklch lightness is 0', blackOklch.l, 0);

check('formatOklch shape', /^oklch\([\d.]+ [\d.]+ [\d.]+\)$/.test(formatOklch({ r: 100, g: 150, b: 200 })), true);

// ---- contrast ----
check('white vs black luminance', relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
check('black luminance is 0', relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
check('white/black contrast is 21:1', contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }), 21);
check('contrast is symmetric', contrastRatio({ r: 10, g: 20, b: 30 }, { r: 200, g: 210, b: 220 }),
  contrastRatio({ r: 200, g: 210, b: 220 }, { r: 10, g: 20, b: 30 }));
check('same color contrast is 1:1', contrastRatio({ r: 50, g: 60, b: 70 }, { r: 50, g: 60, b: 70 }), 1);

const highRating = contrastRating(21);
check('21:1 passes every level', highRating, { aaNormal: true, aaaNormal: true, aaLarge: true, aaaLarge: true });
const lowRating = contrastRating(2);
check('2:1 passes nothing', lowRating, { aaNormal: false, aaaNormal: false, aaLarge: false, aaaLarge: false });
const midRating = contrastRating(4.5);
check('4.5:1 passes AA normal', midRating.aaNormal, true);
check('4.5:1 fails AAA normal', midRating.aaaNormal, false);

// ---- gradients ----
check('linear gradient css', gradientCss({
  type: 'linear', angle: 90, stops: [{ hex: '#000000', pos: 0 }, { hex: '#ffffff', pos: 100 }],
}), 'linear-gradient(90deg, #000000 0%, #ffffff 100%)');

check('radial gradient css', gradientCss({
  type: 'radial', stops: [{ hex: '#000000', pos: 0 }, { hex: '#ffffff', pos: 100 }],
}), 'radial-gradient(circle, #000000 0%, #ffffff 100%)');

check('gradient stops are sorted by position', gradientCss({
  type: 'linear', angle: 45,
  stops: [{ hex: '#ffffff', pos: 100 }, { hex: '#ff0000', pos: 50 }, { hex: '#000000', pos: 0 }],
}), 'linear-gradient(45deg, #000000 0%, #ff0000 50%, #ffffff 100%)');

console.log(`${pass + failures.length} assertions, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
