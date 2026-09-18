#!/usr/bin/env node
// Guards the two things that make this paper work on a Kindle: it must stay
// legible to an old browser, and it must stay small enough to render fast on
// an e-ink panel.
//
//   node tools/check-legacy.mjs [dist]
//
// Exits 1 on the first budget broken or compatibility rule violated.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.argv[2] || 'dist');

// What the Kindle browser cannot be trusted with, and the weight ceilings.
const RULES = [
  { what: 'SVG', test: (html) => /<svg[\s>]/i.test(html) },
  { what: 'web font (@font-face)', test: (html) => /@font-face/i.test(html) },
  { what: 'CSS grid', test: (html) => /display\s*:\s*grid/i.test(html) },
  { what: 'ES6 arrow function', test: (html) => /=>/.test(html) },
];

const BUDGETS = {
  // The board carries every story of the edition in one page (a few hundred
  // KB of text, no images up front - pictures load as their slide comes up),
  // and the slide pages exist for the renderer only.
  html: 400 * 1024,
  image: 120 * 1024,
  // The board carries one picture per story, but it fetches them one at a time
  // as their slide comes up (data-src), so this total is disk, not transfer.
  total: 12 * 1024 * 1024,
};

let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.log(`  FAILED  ${msg}`);
};
const ok = (msg) => console.log(`  ok      ${msg}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

let total = 0;
const files = walk(DIST);

// One small inline ES5 script is allowed (the type fitter); anything else is
// not - the reader is an old browser and this project does not need more.
const SCRIPT_BUDGET = 3 * 1024;
function checkScript(html) {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  const opens = (html.match(/<script\b/gi) || []).length;
  if (opens !== scripts.length) return 'unclosed or malformed <script>';
  if (scripts.length > 1) return `${scripts.length} scripts (only one is allowed)`;
  if (scripts.length === 0) return null;
  const tag = scripts[0].match(/<script\b[^>]*>/i)[0];
  if (/\bsrc\s*=/i.test(tag)) return 'external script';
  // A module script is not ES5, and the bundled version would be minified into
  // syntax the Kindle's browser cannot parse.
  if (/type\s*=\s*["']?module/i.test(tag)) return 'module script';
  const body = scripts[0].replace(/<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
  if (body.length > SCRIPT_BUDGET) return `script is ${body.length} bytes (budget ${SCRIPT_BUDGET})`;
  if (/=>|\blet\s|\bconst\s|\bclass\s|`/.test(body)) return 'script is not ES5';
  return null;
}

// --- compatibility -----------------------------------------------------------

const pages = files.filter((f) => f.endsWith('.html'));
if (pages.length === 0) fail('no HTML built: run "npm run build" first');

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const name = path.relative(DIST, page);
  const broken = RULES.filter((rule) => rule.test(html)).map((rule) => rule.what);
  const scriptProblem = checkScript(html);
  if (scriptProblem) broken.push(scriptProblem);
  if (broken.length > 0) fail(`${name} uses ${broken.join(', ')}`);
  else ok(`${name} is old-browser clean`);
}

// --- weight ------------------------------------------------------------------

for (const file of files) {
  const name = path.relative(DIST, file);
  // kindle/ holds the page images the KOReader plugin downloads; the browser
  // never asks for them, so they are not part of the page's budget.
  if (name.startsWith('kindle/') || name === 'kindle') continue;

  const size = statSync(file).size;
  total += size;
  if (name.endsWith('.html') && size > BUDGETS.html) fail(`${name} is ${kb(size)} (budget ${kb(BUDGETS.html)})`);
  if (/\.(png|jpe?g|gif)$/i.test(name) && size > BUDGETS.image) {
    fail(`${name} is ${kb(size)} (budget ${kb(BUDGETS.image)})`);
  }
}
if (total > BUDGETS.total) fail(`the page is ${kb(total)} (budget ${kb(BUDGETS.total)})`);
else ok(`the page is ${kb(total)}, plugin pages excluded`);

// --- referenced images exist -------------------------------------------------

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  for (const ref of new Set(refs)) {
    const file = path.join(DIST, ref);
    if (!statSync(file, { throwIfNoEntry: false })) fail(`${path.relative(DIST, page)} points at a missing ${ref}`);
  }
}
ok('every referenced asset exists');

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

console.log(problems === 0 ? 'RESULT: passed' : 'RESULT: failed');
process.exit(problems === 0 ? 0 : 1);
