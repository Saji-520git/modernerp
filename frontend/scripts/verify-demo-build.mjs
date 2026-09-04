#!/usr/bin/env node
// ─── Prove what is actually in the built bundles ─────────────────────────────
//
// CLAUDE.md §12.2: "If a fix does not appear, grep the built bundle for a string
// only the new code contains before debugging anything else." A July bundle
// once shipped in August because a rebuild rebuilt nothing.
//
// Two claims are checked here, and neither is taken on trust:
//
//   1. dist-demo/ CONTAINS the demo layer  — otherwise the demo silently tries
//      to reach a backend that is not there.
//   2. dist/ (the real build, if present) does NOT — otherwise a client install
//      could ship fictional seed data and hardcoded demo credentials.
//
// Exits non-zero on either failure.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Strings that exist ONLY in the demo layer.
const DEMO_MARKERS = [
  '__MODERNERP_DEMO__',
  'demo@akeel-hardware.lk',
  'modernerp-demo-db',
  'Akeel Hardware & Building Supplies',
];

function collectJs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectJs(full));
    else if (/\.(js|css|html)$/.test(name)) out.push(full);
  }
  return out;
}

function scan(dir) {
  const files = collectJs(dir);
  const found = new Map();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of DEMO_MARKERS) {
      if (text.includes(m)) {
        if (!found.has(m)) found.set(m, []);
        found.get(m).push(f.replace(ROOT, ''));
      }
    }
  }
  return { fileCount: files.length, found };
}

let failed = false;

// ── 0. The demo layer must stay a leaf ──
//
// services/api.ts imports demo/install, so ANY import from src/demo back into
// src/services closes a cycle. That is not theoretical: importing
// ALL_PERMISSIONS from services/users.ts threw "Cannot access 'ALL_PERMISSIONS'
// before initialization" at module-evaluation time and took every page down.
// utils/local-date is the one allowed target — it imports nothing.
{
  const srcDemo = join(ROOT, 'src', 'demo');
  const offenders = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(/from\s+['"](\.\.\/[^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.includes('/services/') || spec.endsWith('/services')) {
          offenders.push(`${full.replace(ROOT, '')} → ${spec}`);
        }
      }
    }
  };
  walk(srcDemo);
  if (offenders.length) {
    console.error('FAIL  src/demo imports back into src/services — import cycle via api.ts:');
    for (const o of offenders) console.error(`        ${o}`);
    failed = true;
  } else {
    console.log('PASS  src/demo is a leaf — no imports back into src/services');
  }
}

// ── 1. The demo build must carry the demo layer ──
const demoDir = join(ROOT, 'dist-demo');
if (!existsSync(demoDir)) {
  console.error('FAIL  dist-demo/ does not exist — run `npm run build:demo` first.');
  failed = true;
} else {
  const { fileCount, found } = scan(demoDir);
  const missing = DEMO_MARKERS.filter((m) => !found.has(m));
  if (missing.length) {
    console.error(`FAIL  dist-demo/ (${fileCount} files) is missing demo markers:`);
    for (const m of missing) console.error(`        ${m}`);
    console.error('      The demo layer was tree-shaken out, or a stale bundle was scanned.');
    failed = true;
  } else {
    console.log(`PASS  dist-demo/ carries all ${DEMO_MARKERS.length} demo markers (${fileCount} files scanned)`);
  }
}

// ── 2. The real build must NOT ──
const prodDir = join(ROOT, 'dist');
if (!existsSync(prodDir)) {
  console.log('SKIP  dist/ not built — nothing to check for demo leakage.');
} else {
  const { fileCount, found } = scan(prodDir);
  if (found.size) {
    console.error(`FAIL  dist/ (${fileCount} files) CONTAINS demo code — a client build would ship fictional data:`);
    for (const [m, files] of found) console.error(`        ${m}  in ${files.join(', ')}`);
    failed = true;
  } else {
    console.log(`PASS  dist/ is clean of every demo marker (${fileCount} files scanned)`);
  }
}

process.exit(failed ? 1 : 0);
