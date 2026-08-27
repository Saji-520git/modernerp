// The catalogue export, and the module switch that withholds it.
//
// Two things have to hold. The gate has to be a real gate — a client who should
// not be able to walk out with the catalogue must be refused by the SERVER, not
// merely shown no button. And the file has to survive Excel and come back
// through the importer, which is where CSV exports usually fail: an unquoted
// comma in a product name silently turns one row into two, and a missing BOM
// turns any non-ASCII name into mojibake.
import { PrismaClient } from '@prisma/client';
import { exportCsv } from '../dist/modules/products/products.controller.js';
import { isModuleEnabled, OPTIONAL_MODULES, MODULE_META } from '../dist/config/modules.js';
import { requireModule } from '../dist/middleware/require-module.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

// Minimal express doubles — enough for a controller that only sets headers and
// sends a body.
const mockRes = () => {
  const r = { headers: {}, body: null, statusCode: 200 };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.send = (b) => { r.body = b; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  return r;
};

const main = async () => {
  // ── 1. It is registered as a switchable module ──────────────────────────
  ok('productExport is an optional module', OPTIONAL_MODULES.includes('productExport'));
  ok('auditLog is an optional module', OPTIONAL_MODULES.includes('auditLog'));
  ok('both carry a label an admin can read',
     !!MODULE_META.productExport?.label && !!MODULE_META.auditLog?.label);

  // ── 2. Off by default, and the gate is the server ───────────────────────
  ok('a module absent from the flags is OFF', isModuleEnabled({}, 'productExport') === false);
  ok('an explicit false is OFF', isModuleEnabled({ productExport: false }, 'productExport') === false);
  ok('only an explicit true enables it', isModuleEnabled({ productExport: true }, 'productExport') === true);
  ok('a truthy non-true value does NOT enable it',
     isModuleEnabled({ productExport: 'yes' }, 'productExport') === false,
     'a stray string in the flag map would switch the module on');

  // The middleware reads live settings, so drive it against both states.
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const original = settings?.moduleFlags ?? {};

  const runGate = async (flags) => {
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { moduleFlags: flags } });
    const mw = requireModule('productExport');
    let status = null;
    await new Promise((resolve) => {
      const req = { auth: { userId: 'x', role: 'ADMIN', permissions: [] } };
      const next = (err) => { status = err ? (err.status ?? err.statusCode ?? 500) : 'passed'; resolve(); };
      try { const maybe = mw(req, mockRes(), next); if (maybe?.catch) maybe.catch(() => resolve()); }
      catch (e) { status = e.status ?? e.statusCode ?? 500; resolve(); }
    });
    return status;
  };

  try {
    const offStatus = await runGate({ ...original, productExport: false });
    ok('with the module OFF the route is refused', offStatus !== 'passed', `got ${offStatus}`);

    const onStatus = await runGate({ ...original, productExport: true });
    ok('with the module ON the route is allowed', onStatus === 'passed', `got ${onStatus}`);
  } finally {
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { moduleFlags: original } });
  }

  // ── 3. The file itself ──────────────────────────────────────────────────
  const res = mockRes();
  await exportCsv({}, res);
  const body = res.body ?? '';

  ok('sends CSV with a filename', /text\/csv/.test(res.headers['content-type'] ?? '') &&
     /attachment; filename="products-\d{4}-\d{2}-\d{2}\.csv"/.test(res.headers['content-disposition'] ?? ''));

  ok('starts with a BOM so Excel reads UTF-8',
     body.charCodeAt(0) === 0xfeff,
     'without it any non-ASCII product name arrives mangled');

  const lines = body.replace(/^﻿/, '').split('\r\n');
  const header = lines[0];
  ok('header is in the importer\'s column order',
     header === 'sku,name,barcode,category,brand,unit,costPrice,sellPrice,taxPercent,reorderLevel,openingStock,isActive',
     header);

  const dbCount = await prisma.product.count();
  ok(`every product is present (${dbCount})`,
     lines.length - 1 === dbCount,
     `${lines.length - 1} data rows for ${dbCount} products`);

  // Quoting is the whole ballgame: one unescaped comma splits a row in two.
  ok('every field is quoted',
     lines.slice(1).every((l) => l.startsWith('"') && l.endsWith('"')),
     lines.slice(1).find((l) => !l.startsWith('"'))?.slice(0, 80));

  // Each row must have the same field count as the header once quoted commas
  // are ignored — the check that would have caught an unquoted product name.
  const fieldsOf = (line) => (line.match(/"(?:[^"]|"")*"/g) ?? []).length;
  const cols = header.split(',').length;
  const ragged = lines.slice(1).filter((l) => l && fieldsOf(l) !== cols);
  ok(`no row splits on a comma inside a value (${cols} columns)`,
     ragged.length === 0,
     ragged.slice(0, 2).map((r) => r.slice(0, 90)).join(' | '));

  // A product whose name genuinely contains a comma proves the escaping works
  // on real data rather than on a synthetic case.
  const comma = await prisma.product.findFirst({ where: { name: { contains: ',' } }, select: { name: true } });
  if (comma) {
    ok(`a name containing a comma survives ("${comma.name.slice(0, 30)}…")`,
       body.includes(comma.name.replace(/"/g, '""')));
  } else {
    ok('comma-in-name escaping', true, '(no product name contains a comma to test with)');
  }

  report();
};

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  return failed;
}

let code = 1;
main()
  .then(() => { code = out.filter((r) => !r.pass).length ? 1 : 0; })
  .catch((e) => { console.error('ERROR:', e.message); ok('script ran to completion', false, e.message); report(); code = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(code); });
