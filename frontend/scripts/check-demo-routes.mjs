#!/usr/bin/env node
// ─── Compare what the app CALLS with what the demo ANSWERS ───────────────────
//
// The demo's route table was written by reading the service files, and reading
// is not proof. Three billing endpoints were registered as POST when the app
// calls them with PATCH — `salesApi.confirmSale` and friends — so confirming an
// invoice or taking a payment 404'd. Loading every page did not catch it,
// because a page load only issues GETs.
//
// This walks the source for `api.<verb>(...)` call sites, normalises the paths,
// and reports:
//   MISSING       — the app calls it and the demo has no handler
//   VERB MISMATCH — same path, registered under a different method
//
// Unused demo routes are reported separately and are not failures: a few exist
// for flows the demo deliberately does not surface.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** `/sales/${id}/pay` → `/sales/:x/pay` so paths compare regardless of variable name. */
function normalise(p) {
  return p
    .replace(/\$\{[^}]*\}/g, ':x')
    .replace(/\/:[A-Za-z0-9_]+/g, '/:x')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
}

// ── What the app calls ──
const called = new Map();          // "METHOD /path" → Set(file)
const CALL_RE = /\bapi\s*\.\s*(get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*([`'"])([^`'"]+)\2/g;

for (const file of walk(SRC)) {
  if (file.includes(join('src', 'demo'))) continue;      // the demo's own code
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(CALL_RE)) {
    const method = m[1].toUpperCase();
    const path = normalise(m[3]);
    if (!path.startsWith('/')) continue;
    const key = `${method} ${path}`;
    if (!called.has(key)) called.set(key, new Set());
    called.get(key).add(file.replace(ROOT, ''));
  }
}

// ── What the demo answers ──
const routesSrc = readFileSync(join(SRC, 'demo', 'handlers', 'index.ts'), 'utf8');
const served = new Set();
for (const m of routesSrc.matchAll(/'(GET|POST|PATCH|PUT|DELETE) ([^']+)'\s*:/g)) {
  served.add(`${m[1]} ${normalise(m[2])}`);
}

const servedPaths = new Map();     // path → Set(method)
for (const key of served) {
  const [method, path] = key.split(' ');
  if (!servedPaths.has(path)) servedPaths.set(path, new Set());
  servedPaths.get(path).add(method);
}

// ── Endpoints the demo is not expected to answer ──
//
// These belong to optional modules the seeded `moduleFlags` switch OFF, so
// AppShell hides their nav entries and ModuleGuard redirects their routes — the
// call sites are unreachable in a demo build. `products/export/csv` is behind
// the productExport module; `settings/modules` needs `manage_modules`, which is
// super-admin-only and no demo account holds. Attachments are file uploads the
// demo has nowhere to put.
//
// Anything NOT matched here is a real gap and fails the check.
const OUT_OF_SCOPE = [
  /^\/audit(\/|$)/,
  /^\/promotions(\/|$)/,
  /^\/quotations(\/|$)/,
  /^\/stock-takes(\/|$)/,
  /^\/loyalty(\/|$)/,
  /^\/data-management(\/|$)/,
  /^\/import(\/|$)/,
  /^\/attachments(\/|$)/,
  /^\/products\/export\//,
  /^\/settings\/modules$/,
];
const outOfScope = (path) => OUT_OF_SCOPE.some((re) => re.test(path));

// ── Compare ──
const missing = [];
const mismatched = [];
const skipped = [];
for (const [key, files] of called) {
  if (served.has(key)) continue;
  const p = key.split(' ')[1];
  if (outOfScope(p)) { skipped.push(key); continue; }
  const [method, path] = key.split(' ');
  const others = servedPaths.get(path);
  if (others && others.size) {
    mismatched.push({ key, has: [...others].join('/'), method, files: [...files] });
  } else {
    missing.push({ key, files: [...files] });
  }
}

const unused = [...served].filter((k) => !called.has(k));

let failed = false;

if (mismatched.length) {
  failed = true;
  console.error(`FAIL  ${mismatched.length} endpoint(s) registered under the wrong method:`);
  for (const m of mismatched) {
    console.error(`        app calls ${m.key}  —  demo serves ${m.has} ${m.key.split(' ')[1]}`);
    for (const f of m.files) console.error(`            ${f}`);
  }
}

if (missing.length) {
  failed = true;
  console.error(`FAIL  ${missing.length} endpoint(s) called by the app with no demo handler:`);
  for (const m of missing) {
    console.error(`        ${m.key}`);
    for (const f of m.files) console.error(`            ${f}`);
  }
}

if (!failed) {
  console.log(`PASS  every in-scope endpoint has a handler on the right method (${called.size} call sites)`);
}
if (skipped.length) {
  console.log(`NOTE  ${skipped.length} call site(s) skipped — modules the demo switches off, so unreachable.`);
}

if (unused.length) {
  console.log(`NOTE  ${unused.length} demo route(s) nothing calls (harmless):`);
  for (const u of unused.sort()) console.log(`        ${u}`);
}

process.exit(failed ? 1 : 0);
