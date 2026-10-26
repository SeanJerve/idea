// Generates the design tokens (W3C Design Tokens 2025.10 JSON + CSS variables)
// and checks WCAG contrast for every text/background pair the UI uses.
// Change a hue or chroma in HUES, or a role mapping in roles, then run:
//   node design/generate-tokens.mjs
// The script exits with an error if any contrast check fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ---- OKLCH <-> sRGB ----
const lin2s = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
const s2lin = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
function oklchToLinear(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
function fit(L, C, h) { let c = C; while (c > 0 && !inGamut(oklchToLinear(L, c, h))) c -= 0.002; return Math.max(0, +c.toFixed(3)); }
const hex = (L, C, h) => '#' + oklchToLinear(L, C, h).map(v => Math.round(Math.min(1, Math.max(0, lin2s(v))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = hx => { const [r, g, b] = [1, 3, 5].map(i => s2lin(parseInt(hx.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- Ramps ----
const STEPS = {50: .975, 100: .945, 200: .89, 300: .815, 400: .73, 500: .64, 600: .55, 700: .47, 800: .385, 900: .3, 950: .225};
const HUES = {
  neutral: {h: 145, c: 0.014, desc: 'Basil-tinted neutral for backgrounds, text and borders'},
  basil: {h: 152, c: 0.13, desc: 'Brand primary: actions, selection, progress'},
  chili: {h: 42, c: 0.17, desc: 'Brand accent: prices and badges only'},
  protein: {h: 262, c: 0.16, desc: 'Macro color for protein'},
  carbs: {h: 78, c: 0.15, desc: 'Macro color for carbohydrates'},
  fat: {h: 355, c: 0.15, desc: 'Macro color for fat'},
  fiber: {h: 138, c: 0.14, desc: 'Macro color for fiber'},
  red: {h: 27, c: 0.18, desc: 'System errors only (never used to judge food)'},
};
const shape = L => Math.max(0.2, 1 - ((L - 0.62) / (L > 0.62 ? 0.38 : 0.48)) ** 2);
const ramps = {};
for (const [name, {h, c}] of Object.entries(HUES)) {
  ramps[name] = {};
  for (const [step, L] of Object.entries(STEPS)) { const C = fit(L, c * shape(L), h); ramps[name][step] = {L, C, h, hex: hex(L, C, h)}; }
}
const WHITE = {L: 1, C: 0, h: 0, hex: '#FFFFFF'};
const ref = s => { if (s === 'white') return WHITE; const [n, st] = s.split('.'); return ramps[n][st]; };

// ---- Semantic roles ----
const roles = {
  bg: ['neutral.50', 'neutral.950', 'Page background'],
  surface: ['white', 'neutral.900', 'Cards, panels, sheets'],
  'surface-2': ['neutral.100', 'neutral.800', 'Chips, tracks, image wells, segmented controls'],
  ink: ['neutral.950', 'neutral.50', 'Primary text'],
  muted: ['neutral.700', 'neutral.300', 'Secondary text'],
  line: ['neutral.200', 'neutral.700', 'Decorative hairlines and dividers (not the only boundary of a control)'],
  'line-control': ['neutral.500', 'neutral.400', 'Borders of chips, inputs and outlined buttons (WCAG 1.4.11, 3:1)'],
  primary: ['basil.700', 'basil.400', 'Primary buttons, selected borders, progress'],
  'on-primary': ['white', 'basil.950', 'Text and icons on primary'],
  'primary-soft': ['basil.100', 'basil.900', 'Selected backgrounds, success wash'],
  accent: ['chili.700', 'chili.300', 'Price and badge text'],
  'accent-soft': ['chili.100', 'chili.900', 'Price and badge backgrounds'],
  protein: ['protein.600', 'protein.300', 'Protein text, bars, ring'],
  carbs: ['carbs.700', 'carbs.300', 'Carbs text, bars, ring'],
  fat: ['fat.600', 'fat.300', 'Fat text, bars, ring'],
  fiber: ['fiber.700', 'fiber.300', 'Fiber text, bars, ring'],
  danger: ['red.600', 'red.300', 'System errors and destructive actions only'],
  focus: ['protein.600', 'protein.300', 'Focus ring'],
};
const checks = [
  ['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5],
  ['on-primary', 'primary', 4.5], ['accent', 'accent-soft', 4.5], ['accent', 'surface', 4.5], ['primary', 'surface', 4.5], ['primary', 'primary-soft', 4.5],
  ['protein', 'surface', 4.5], ['carbs', 'surface', 4.5], ['fat', 'surface', 4.5], ['fiber', 'surface', 4.5], ['danger', 'surface', 4.5],
  ['line', 'surface', 1.2], ['line-control', 'surface', 3], ['line-control', 'bg', 3], ['focus', 'bg', 3], ['protein', 'surface-2', 3], ['carbs', 'surface-2', 3], ['fat', 'surface-2', 3], ['fiber', 'surface-2', 3],
];
let fail = 0; const report = [];
for (const [mode, idx] of [['light', 0], ['dark', 1]]) for (const [fg, bgk, min] of checks) {
  const r = contrast(ref(roles[fg][idx]).hex, ref(roles[bgk][idx]).hex);
  report.push(`${mode.padEnd(5)} ${fg.padEnd(11)} on ${bgk.padEnd(12)} ${r.toFixed(2).padStart(5)} (min ${min}) ${r >= min ? 'ok' : 'FAIL'}`);
  if (r < min) fail++;
}
console.log(report.join('\n')); console.log('fails', fail);

// ---- DTCG 2025.10 token files ----
const colorTok = (c, desc) => ({$type: 'color', $value: {colorSpace: 'oklch', components: [c.L, c.C, c.h], hex: c.hex}, ...(desc ? {$description: desc} : {})});
const px = v => ({value: v, unit: 'px'}); const ms = v => ({value: v, unit: 'ms'});
const primitives = {color: {white: colorTok(WHITE)}};
for (const [n, r] of Object.entries(ramps)) { primitives.color[n] = {$description: HUES[n].desc}; for (const [st, c] of Object.entries(r)) primitives.color[n][st] = colorTok(c); }
Object.assign(primitives, {
  font: {family: {
    display: {$type: 'fontFamily', $value: ['Bricolage Grotesque', 'Segoe UI', 'system-ui', 'sans-serif'], $description: 'Headings and the big calorie number'},
    body: {$type: 'fontFamily', $value: ['Manrope', 'Segoe UI', 'system-ui', 'sans-serif'], $description: 'All UI and body text'},
    mono: {$type: 'fontFamily', $value: ['JetBrains Mono', 'ui-monospace', 'monospace'], $description: 'Codes (bowl codes, device IDs) in admin'}},
    weight: {regular: {$type: 'fontWeight', $value: 500}, semibold: {$type: 'fontWeight', $value: 600}, bold: {$type: 'fontWeight', $value: 700}, heavy: {$type: 'fontWeight', $value: 800}}},
  space: Object.fromEntries([[0, 0], [1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24], [8, 32], [10, 40], [12, 48], [16, 64], [20, 80]].map(([k, v]) => [k, {$type: 'dimension', $value: px(v)}])),
  radius: {sm: {$type: 'dimension', $value: px(8)}, md: {$type: 'dimension', $value: px(12)}, lg: {$type: 'dimension', $value: px(18)}, xl: {$type: 'dimension', $value: px(24)}, pill: {$type: 'dimension', $value: px(999)}},
  size: {'touch-min': {$type: 'dimension', $value: px(64), $description: 'Minimum touch target on the kiosk'}, 'touch-gap': {$type: 'dimension', $value: px(12)}, 'touch-min-compact': {$type: 'dimension', $value: px(48), $description: 'Admin and phone only'}},
  duration: {instant: {$type: 'duration', $value: ms(90), $description: 'Press feedback'}, fast: {$type: 'duration', $value: ms(160)}, base: {$type: 'duration', $value: ms(220)}, slow: {$type: 'duration', $value: ms(300), $description: 'Upper limit for any kiosk animation'}},
  easing: {standard: {$type: 'cubicBezier', $value: [0.2, 0, 0, 1]}, enter: {$type: 'cubicBezier', $value: [0.05, 0.7, 0.1, 1]}, exit: {$type: 'cubicBezier', $value: [0.3, 0, 1, 1]}},
});
const typeScale = {
  caption: [14, 600, 1.35, 'body'], 'body-sm': [16, 500, 1.45, 'body'], body: [18, 500, 1.45, 'body'], 'body-lg': [20, 600, 1.4, 'body'],
  label: [16, 700, 1.2, 'body'], 'title-sm': [22, 800, 1.2, 'display'], title: [28, 800, 1.15, 'display'], headline: [36, 800, 1.05, 'display'],
  display: [52, 800, 1.0, 'display'], numeral: [56, 800, 0.95, 'display'],
};
primitives.type = Object.fromEntries(Object.entries(typeScale).map(([k, [s, w, lh, fam]]) => [k, {$type: 'typography', $value: {fontFamily: `{font.family.${fam}}`, fontSize: px(s), fontWeight: w, lineHeight: lh, letterSpacing: px(k === 'caption' ? 0.2 : 0)}}]));
const theme = idx => ({color: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, {$type: 'color', $value: v[idx] === 'white' ? '{color.white}' : `{color.${v[idx]}}`, $description: v[2]}]))});
const out = path.dirname(fileURLToPath(import.meta.url)) + '/';
fs.writeFileSync(out + 'tokens.primitives.json', JSON.stringify(primitives, null, 2) + '\n');
fs.writeFileSync(out + 'tokens.light.json', JSON.stringify(theme(0), null, 2) + '\n');
fs.writeFileSync(out + 'tokens.dark.json', JSON.stringify(theme(1), null, 2) + '\n');

// ---- CSS ----
const css = [];
const oklch = c => `oklch(${(c.L * 100).toFixed(1)}% ${c.C.toFixed(3)} ${c.h})`;
const block = idx => Object.entries(roles).map(([k, v]) => `  --${k}: ${oklch(ref(v[idx]))}; /* ${ref(v[idx]).hex} */`).join('\n');
css.push('/* Generated from tokens.*.json (W3C Design Tokens 2025.10). Do not edit by hand. */');
css.push(':root {\n' + block(0) + '\n' +
  Object.entries(primitives.space).map(([k, t]) => `  --space-${k}: ${t.$value.value}px;`).join('\n') + '\n' +
  Object.entries(primitives.radius).map(([k, t]) => `  --radius-${k}: ${t.$value.value}px;`).join('\n') + '\n' +
  `  --touch-min: 64px;\n  --touch-gap: 12px;\n` +
  Object.entries(primitives.duration).map(([k, t]) => `  --duration-${k}: ${t.$value.value}ms;`).join('\n') + '\n' +
  Object.entries(primitives.easing).map(([k, t]) => `  --ease-${k}: cubic-bezier(${t.$value.join(', ')});`).join('\n') + '\n' +
  `  --font-display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;\n  --font-body: "Manrope", "Segoe UI", system-ui, sans-serif;\n` +
  Object.entries(typeScale).map(([k, [s, w, lh, fam]]) => `  --text-${k}: ${w} ${s / 16}rem/${lh} var(--font-${fam});`).join('\n') + '\n  color-scheme: light;\n}');
css.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${block(1).replace(/^/gm, '  ')}\n    color-scheme: dark;\n  }\n}`);
css.push(`:root[data-theme="dark"] {\n${block(1)}\n  color-scheme: dark;\n}`);
css.push(`@media (prefers-reduced-motion: reduce) {\n  :root { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; }\n}`);
fs.writeFileSync(out + 'tokens.css', css.join('\n\n') + '\n');
if (fail) { console.error(`${fail} contrast check(s) failed`); process.exit(1); }
console.log('wrote design/tokens.*.json and design/tokens.css');
