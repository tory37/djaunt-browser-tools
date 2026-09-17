// Pure color math: parsing, format conversion, contrast, and gradient CSS.
// No DOM, no extension APIs — safe to import from a popup, a picker page, or
// this folder's test.mjs.

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const clampByte = (n) => Math.min(255, Math.max(0, Math.round(n)));

const HEX3_RE = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX4_RE = /^#?([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6_RE = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8_RE = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i;
const HSL_RE = /^hsla?\(\s*([\d.]+)(?:deg)?\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i;

function parseAlpha(raw) {
  if (raw === undefined) return 1;
  return raw.endsWith("%") ? clamp01(parseFloat(raw) / 100) : clamp01(parseFloat(raw));
}

// Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(). Returns
// {r,g,b,a} (0-255 channels, 0-1 alpha) or null if the input isn't a color.
export function parseColor(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();

  let m = HEX8_RE.exec(s) || HEX6_RE.exec(s);
  if (m) {
    const a = m[4] !== undefined ? parseInt(m[4], 16) / 255 : 1;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a };
  }
  m = HEX4_RE.exec(s) || HEX3_RE.exec(s);
  if (m) {
    const a = m[4] !== undefined ? parseInt(m[4] + m[4], 16) / 255 : 1;
    return {
      r: parseInt(m[1] + m[1], 16),
      g: parseInt(m[2] + m[2], 16),
      b: parseInt(m[3] + m[3], 16),
      a,
    };
  }

  m = RGB_RE.exec(s);
  if (m) {
    return {
      r: clampByte(parseFloat(m[1])),
      g: clampByte(parseFloat(m[2])),
      b: clampByte(parseFloat(m[3])),
      a: parseAlpha(m[4]),
    };
  }

  m = HSL_RE.exec(s);
  if (m) {
    const rgb = hslToRgb({ h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) });
    return { ...rgb, a: parseAlpha(m[4]) };
  }

  return null;
}

export function rgbToHex({ r, g, b, a = 1 }) {
  const toHex = (n) => clampByte(n).toString(16).padStart(2, "0");
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a >= 1 ? base : `${base}${toHex(a * 255)}`;
}

export function formatRgb({ r, g, b, a = 1 }) {
  const rgb = `${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}`;
  return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${round(a, 2)})`;
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
    case gn: h = (bn - rn) / d + 2; break;
    default: h = (rn - gn) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }) {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = clamp01(s / 100);
  const ln = clamp01(l / 100);

  if (sn === 0) {
    const v = clampByte(ln * 255);
    return { r: v, g: v, b: v };
  }

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hueToRgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: clampByte(hueToRgb(hn + 1 / 3) * 255),
    g: clampByte(hueToRgb(hn) * 255),
    b: clampByte(hueToRgb(hn - 1 / 3) * 255),
  };
}

export function formatHsl({ r, g, b, a = 1 }) {
  const { h, s, l } = rgbToHsl({ r, g, b });
  const hsl = `${round(h, 0)}, ${round(s, 0)}%, ${round(l, 0)}%`;
  return a >= 1 ? `hsl(${hsl})` : `hsla(${hsl}, ${round(a, 2)})`;
}

// sRGB -> linear -> OKLab -> OKLCH, using Björn Ottosson's direct
// linear-sRGB-to-OKLab matrices (https://bottosson.github.io/posts/oklab/).
function srgbToLinear(c) {
  const cn = c / 255;
  return cn <= 0.04045 ? cn / 12.92 : Math.pow((cn + 0.055) / 1.055, 2.4);
}

export function rgbToOklch({ r, g, b }) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { l: L, c: C, h: C < 0.0001 ? 0 : H };
}

export function formatOklch({ r, g, b, a = 1 }) {
  const { l, c, h } = rgbToOklch({ r, g, b });
  const oklch = `${round(l, 3)} ${round(c, 3)} ${round(h, 1)}`;
  return a >= 1 ? `oklch(${oklch})` : `oklch(${oklch} / ${round(a, 2)})`;
}

// WCAG 2.x relative luminance and contrast ratio.
export function relativeLuminance({ r, g, b }) {
  const chan = (c) => {
    const cn = c / 255;
    return cn <= 0.03928 ? cn / 12.92 : Math.pow((cn + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRating(ratio) {
  return {
    aaNormal: ratio >= 4.5,
    aaaNormal: ratio >= 7,
    aaLarge: ratio >= 3,
    aaaLarge: ratio >= 4.5,
  };
}

export function gradientCss({ type, angle = 90, stops }) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const stopList = sorted.map((stop) => `${stop.hex} ${round(stop.pos, 0)}%`).join(", ");
  return type === "radial"
    ? `radial-gradient(circle, ${stopList})`
    : `linear-gradient(${round(angle, 0)}deg, ${stopList})`;
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
