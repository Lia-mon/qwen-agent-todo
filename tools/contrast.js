#!/usr/bin/env node
/**
 * tools/contrast.js — WCAG contrast checker for the CSS in use.
 *
 * Run:  node tools/contrast.js
 *
 * For each theme (classic = base only; the other four = base + their override
 * file) it merges the `:root` tokens and the rules, then finds every rule that
 * sets BOTH a `color` and a `background`/`background-color`, resolves the
 * values (var() tokens, hex, rgb/rgba, named white/black, gradients → first
 * color stop), and reports the WCAG contrast ratio.
 *
 * Semi-transparent colors are composited over the theme's `--color-bg` and
 * marked with `~`.
 *
 * Verdicts:  AAA ≥ 7 · AA ≥ 4.5 · AA-lg ≥ 3 · LOW < 3
 *
 * Known limitation: only explicit color+background pairs in the SAME rule are
 * checked. Backgrounds inherited from a parent element are not considered.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Color math ──────────────────────────────────────────────
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function composite(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

// ── Color parsing ───────────────────────────────────────────
function parseHex(h) {
  h = h.replace(/^#/, '');
  let r, g, b, a = 1;
  if (h.length === 3) { r = rep(h[0]); g = rep(h[1]); b = rep(h[2]); }
  else if (h.length === 4) { r = rep(h[0]); g = rep(h[1]); b = rep(h[2]); a = rep(h[3]) / 255; }
  else if (h.length === 6) { r = int(h.slice(0, 2)); g = int(h.slice(2, 4)); b = int(h.slice(4, 6)); }
  else if (h.length === 8) { r = int(h.slice(0, 2)); g = int(h.slice(2, 4)); b = int(h.slice(4, 6)); a = int(h.slice(6, 8)) / 255; }
  else return null;
  return { r, g, b, a };
}
function rep(c) { return parseInt(c + c, 16); }
function int(s) { return parseInt(s, 16); }

function parseRgb(inner) {
  inner = inner.trim();
  if (inner.includes(',')) {
    const p = inner.split(',').map(s => s.trim());
    const r = Number(p[0]), g = Number(p[1]), b = Number(p[2]);
    const a = p.length > 3 ? Number(p[3]) : 1;
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return { r, g, b, a };
  }
  const m = inner.match(/^(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?))?\s*$/);
  if (m) {
    const r = +m[1], g = +m[2], b = +m[3];
    let a = 1;
    if (m[4]) a = m[4].includes('%') ? Number(m[4]) / 100 : Number(m[4]);
    return { r, g, b, a };
  }
  return null;
}

// All colors found in a value string, in order (gradient stops, …).
function extractAllColors(str) {
  const found = [];
  let m;
  const hexRe = /#([0-9a-fA-F]{3,8})\b/g;
  while ((m = hexRe.exec(str)) !== null) {
    const c = parseHex(m[1]);
    if (c) found.push({ pos: m.index, c });
  }
  const rgbRe = /rgba?\(([^)]*)\)/g;
  while ((m = rgbRe.exec(str)) !== null) {
    const c = parseRgb(m[1]);
    if (c) found.push({ pos: m.index, c });
  }
  const whiteRe = /\bwhite\b/g;
  while ((m = whiteRe.exec(str)) !== null) found.push({ pos: m.index, c: { r: 255, g: 255, b: 255, a: 1 } });
  const blackRe = /\bblack\b/g;
  while ((m = blackRe.exec(str)) !== null) found.push({ pos: m.index, c: { r: 0, g: 0, b: 0, a: 1 } });
  found.sort((a, b) => a.pos - b.pos);
  return found.map(f => f.c);
}

// Earliest color found in a value string (handles gradients → first stop).
function extractFirstColor(str) {
  const all = extractAllColors(str);
  return all.length ? all[0] : null;
}

// ── var() substitution ──────────────────────────────────────
function substituteVars(val, tokens, depth = 0) {
  if (depth > 12) return val;
  return val.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (match, name, fallback) => {
    const t = tokens[name];
    if (t !== undefined) return substituteVars(t, tokens, depth + 1);
    return fallback !== undefined ? fallback.trim() : match;
  });
}

// ── CSS parsing ─────────────────────────────────────────────
function parseDecls(body) {
  const decls = {};
  for (const part of body.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim();
    let val = part.slice(idx + 1).trim();
    val = val.replace(/\s*!important\s*$/i, '');
    if (prop) decls[prop] = val;
  }
  return decls;
}

function parseBlock(css, media, out) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) {
      if (/^@(media|supports)\b/.test(prelude)) {
        parseBlock(body, [...media, prelude], out);
      }
      // other at-rules (@keyframes, @font-face, …) are skipped
    } else if (prelude) {
      out.push({ media, selector: prelude, decls: parseDecls(body) });
    }
    i = j;
  }
}

function parseFile(file) {
  const css = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  parseBlock(css, [], rules);
  return rules;
}

// ── Run per theme ───────────────────────────────────────────
const THEMES = {
  classic: ['styles.css'],
  girly:   ['styles.css', 'girly.css'],
  suave:   ['styles.css', 'suave.css'],
  gothic:  ['styles.css', 'gothic.css'],
  farm:    ['styles.css', 'farm.css'],
};

function toHex({ r, g, b, a }) {
  const h = n => Math.round(n).toString(16).padStart(2, '0');
  return a >= 1 ? `#${h(r)}${h(g)}${h(b)}` : `#${h(r)}${h(g)}${h(b)}${h(a * 255)}`;
}

function verdict(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-lg';
  return 'LOW';
}

// ── --test mode: quick ratio check for candidate colors ──────
// Usage: node tools/contrast.js --test <fg> <bg> [<bg>...] [--over <base>]
// Semi-transparent bgs are composited over <base> when given.
function runTest(args) {
  let over = null;
  const idx = args.indexOf('--over');
  let colors;
  if (idx !== -1) {
    over = extractFirstColor(args[idx + 1] || '');
    colors = [...args.slice(0, idx), ...args.slice(idx + 2)];
  } else {
    colors = args;
  }
  if (colors.length < 2) {
    console.error('usage: node tools/contrast.js --test <fg> <bg> [<bg>...] [--over <base>]');
    process.exit(1);
  }
  const fg = extractFirstColor(colors[0]);
  if (!fg) { console.error(`cannot parse fg color: ${colors[0]}`); process.exit(1); }
  for (let i = 1; i < colors.length; i++) {
    let bg = extractFirstColor(colors[i]);
    if (!bg) { console.error(`cannot parse bg: ${colors[i]}`); continue; }
    let note = '';
    if (bg.a < 1) {
      if (over) { bg = composite(bg, over); note = '  (composited over base)'; }
      else note = '  (alpha, no base given)';
    }
    const ratio = contrast(fg, bg);
    console.log(`  ${ratio.toFixed(2)}  ${toHex(fg)} on ${toHex(bg)}  ${verdict(ratio)}${note}`);
  }
}

function main() {
  if (process.argv[2] === '--test') { runTest(process.argv.slice(3)); return; }
  for (const [theme, files] of Object.entries(THEMES)) {
    const tokens = {};
    const ruleMap = new Map();

    for (const file of files) {
      for (const rule of parseFile(file)) {
        if (rule.selector === ':root') {
          Object.assign(tokens, rule.decls);
          continue;
        }
        const key = rule.media.join(' ') + '\u0000' + rule.selector;
        if (!ruleMap.has(key)) ruleMap.set(key, { media: rule.media, selector: rule.selector, decls: {} });
        Object.assign(ruleMap.get(key).decls, rule.decls);
      }
    }

    const bgRaw = tokens['--color-bg'];
    const bgColor = bgRaw ? extractFirstColor(substituteVars(bgRaw, tokens)) : null;

    const rows = [];
    for (const rule of ruleMap.values()) {
      const colorVal = rule.decls.color;
      const bgVal = rule.decls['background-color'] ?? rule.decls.background;
      if (!colorVal || !bgVal) continue;

      const fg = extractFirstColor(substituteVars(colorVal, tokens));
      const bgStops = extractAllColors(substituteVars(bgVal, tokens));
      if (!fg || bgStops.length === 0) continue;

      // Worst case across all background stops (gradient backgrounds vary).
      let worst = null;
      for (const stop of bgStops) {
        let f = fg, b = stop, approx = false;
        if (fg.a < 1 && bgColor) { f = composite(fg, bgColor); approx = true; }
        if (stop.a < 1 && bgColor) { b = composite(stop, bgColor); approx = true; }
        const ratio = contrast(f, b);
        if (!worst || ratio < worst.ratio) worst = { ratio, bg: stop, approx };
      }
      rows.push({
        ratio: worst.ratio,
        fg: toHex(fg),
        bg: toHex(worst.bg),
        verdict: verdict(worst.ratio),
        selector: rule.selector.replace(/\s+/g, ' '),
        media: rule.media,
        approx: worst.approx,
      });
    }

    rows.sort((a, b) => a.ratio - b.ratio);

    console.log('\n══════════════════════════════════════════════');
    console.log(` THEME: ${theme}`);
    console.log('══════════════════════════════════════════════');
    if (rows.length === 0) {
      console.log('  (no color+background pairs found)');
    } else {
      for (const r of rows) {
        const media = r.media.length ? `  @media ${r.media[r.media.length - 1]}` : '';
        const mark = r.approx ? '~' : '';
        console.log(
          `  ${r.ratio.toFixed(2).padStart(5)}  ${r.fg} on ${r.bg}  ${r.verdict.padEnd(6)}  ${r.selector}${media}${mark}`
        );
      }
      const counts = { LOW: 0, 'AA-lg': 0, AA: 0, AAA: 0 };
      for (const r of rows) counts[r.verdict]++;
      console.log(`  ── ${counts.LOW} LOW · ${counts['AA-lg']} AA-lg · ${counts.AA} AA · ${counts.AAA} AAA ──`);
    }
  }
  console.log('\n');
}

main();