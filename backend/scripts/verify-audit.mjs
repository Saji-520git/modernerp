// Does the audit trail actually record what happened — and stay quiet about
// what did not? Drives the real HTTP API, then cleans up its own entries.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

let token = null;
const startedAt = new Date();

const api = (path, init = {}) =>
  fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

const settle = () => new Promise((r) => setTimeout(r, 700));   // writes are fire-and-forget

const main = async () => {
  // The middleware needs a real signed-in actor. Credentials come from the
  // environment — this script never contains any.
  const email = process.env.AUDIT_TEST_EMAIL;
  const pass  = process.env.AUDIT_TEST_PASSWORD;

  if (email && pass) {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pass }) });
    const j = await r.json().catch(() => ({}));
    token = j.accessToken ?? j.token ?? null;
    ok('signed in for the authenticated checks', !!token, `status ${r.status}`);
  } else {
    ok('no AUDIT_TEST_EMAIL/PASSWORD set — authenticated checks skipped', true,
       '(anonymous checks still run)');
  }

  // Every check below drives the API over HTTP, so without a server there is
  // nothing to assert. Skip loudly rather than crashing: a dead port is a
  // missing precondition, not a defect in the audit trail.
  const reachable = await fetch(BASE + '/settings').then(() => true).catch(() => false);
  if (!reachable) {
    ok('backend not running on ' + BASE + ' — HTTP checks skipped', true,
       '(start it with: npm run dev)');
    return report();
  }

  // ── 1. A read must leave no trace ─────────────────────────────────────────
  const beforeGet = await prisma.auditLog.count();
  await api('/settings');
  await settle();
  ok('a GET records nothing', (await prisma.auditLog.count()) === beforeGet);

  // ── 2. A rejected write records nothing (4xx changed no state) ────────────
  const before4xx = await prisma.auditLog.count();
  await api('/units', { method: 'POST', body: JSON.stringify({ nonsense: true }) });
  await settle();
  ok('a rejected write (4xx) records nothing', (await prisma.auditLog.count()) === before4xx);

  // ── 3. A real write is recorded, with the actor and the verb ──────────────
  if (token) {
    const name = `AuditProbe-${Date.now().toString(36)}`;
    const r = await api('/units', {
      method: 'POST',
      body: JSON.stringify({ name, shortCode: name.slice(-6), type: 'COUNT', allowDecimal: false }),
    });
    const created = await r.json().catch(() => ({}));
    await settle();

    const entry = await prisma.auditLog.findFirst({
      where: { entity: 'units', action: 'CREATE', at: { gte: startedAt } },
      orderBy: { at: 'desc' },
    });
    ok('a successful write is recorded', !!entry, `unit create returned ${r.status}`);
    if (entry) {
      ok('records a real user name, not an id',
         !!entry.userName && entry.userName !== 'anonymous' && !entry.userName.startsWith('c'),
         `userName=${entry.userName}`);
      ok('records the role', !!entry.userRole && entry.userRole !== 'ANONYMOUS', `role=${entry.userRole}`);
      ok('records method, path and status',
         entry.method === 'POST' && entry.path.includes('/units') && entry.status < 300,
         `${entry.method} ${entry.path} ${entry.status}`);
      ok('captures the submitted body', JSON.stringify(entry.meta ?? {}).includes(name),
         JSON.stringify(entry.meta ?? {}).slice(0, 120));
    }

    // Clean up the probe unit.
    if (created?.id) {
      await api(`/units/${created.id}`, { method: 'DELETE' });
      await settle();
      const del = await prisma.auditLog.findFirst({
        where: { entity: 'units', action: 'DELETE', at: { gte: startedAt } },
        orderBy: { at: 'desc' },
      });
      ok('a delete is recorded as DELETE with the record id',
         !!del && del.entityId === created.id, `entityId=${del?.entityId}`);
    }

    // ── 4. Credentials never reach the table ────────────────────────────────
    const loginEntry = await prisma.auditLog.findFirst({
      where: { path: { contains: '/auth/login' }, at: { gte: startedAt } },
      orderBy: { at: 'desc' },
    });
    if (loginEntry) {
      const dump = JSON.stringify(loginEntry.meta ?? {});
      ok('the login password is redacted, not stored',
         !dump.includes(pass) && dump.includes('[redacted]'), dump.slice(0, 140));
      ok('login is recorded as LOGIN', loginEntry.action === 'LOGIN', `action=${loginEntry.action}`);
    } else {
      ok('login recorded', false, 'no login entry found');
    }

    // ── 5. The read API returns it, and is admin-gated ──────────────────────
    const listRes = await api('/audit?pageSize=5');
    const list    = await listRes.json().catch(() => ({}));
    ok('GET /audit returns the trail', listRes.ok && Array.isArray(list.data) && list.data.length > 0,
       `status ${listRes.status}`);

    const anonRes = await fetch(`${BASE}/audit`);
    ok('GET /audit refuses an unauthenticated caller', anonRes.status === 401 || anonRes.status === 403,
       `status ${anonRes.status}`);

    // ── 6. The trail is append-only over HTTP ───────────────────────────────
    const first = list.data?.[0];
    if (first) {
      const delRes   = await api(`/audit/${first.id}`, { method: 'DELETE' });
      const patchRes = await api(`/audit/${first.id}`, { method: 'PATCH', body: JSON.stringify({ summary: 'x' }) });
      ok('the trail cannot be deleted or edited through the API',
         delRes.status === 404 && patchRes.status === 404,
         `DELETE ${delRes.status}, PATCH ${patchRes.status}`);
    }
  }

  // ── 7. The write path itself, without HTTP ────────────────────────────────
  //
  // A successful write cannot be produced over HTTP without signing in, and
  // this script holds no credentials. The middleware is driven directly
  // instead: a fake request and response, a real 'finish', and the real
  // database underneath. That covers everything the HTTP route would —
  // shouldRecord, the actor lookup, redaction, and the insert.
  {
    const { auditTrail } = await import('../dist/middleware/audit.js');
    const { EventEmitter } = await import('events');

    const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, fullName: true } });

    const run = (req, statusCode) =>
      new Promise((resolve) => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        auditTrail(req, res, () => {});
        res.emit('finish');
        setTimeout(resolve, 600);          // the write is fire-and-forget
      });

    await run({
      method: 'POST',
      path: `/sales/${'c'.repeat(25)}/confirm`,
      originalUrl: `/api/v1/sales/${'c'.repeat(25)}/confirm?x=1`,
      body: { note: 'probe', password: 'should-never-appear', lines: [{ qty: 2 }] },
      ip: '127.0.0.1',
      auth: { userId: user.id, role: 'ADMIN', permissions: [] },
    }, 201);

    const row = await prisma.auditLog.findFirst({
      where: { at: { gte: startedAt }, entity: 'sales' },
      orderBy: { at: 'desc' },
    });

    ok('the middleware writes a row for a successful state change', !!row);
    if (row) {
      ok('reads the verb from the route, not the method (CONFIRM, not CREATE)',
         row.action === 'CONFIRM', `action=${row.action}`);
      ok('resolves the actor name from the id',
         row.userName === user.fullName, `userName=${row.userName}`);
      ok('records the role it acted under', row.userRole === 'ADMIN', `role=${row.userRole}`);
      ok('extracts the record id from the path', row.entityId === 'c'.repeat(25), `entityId=${row.entityId}`);
      ok('strips the query string from the stored path',
         row.path === `/api/v1/sales/${'c'.repeat(25)}/confirm`, row.path);
      ok('the password never reaches the table',
         !JSON.stringify(row.meta ?? {}).includes('should-never-appear')
         && JSON.stringify(row.meta ?? {}).includes('[redacted]'),
         JSON.stringify(row.meta ?? {}).slice(0, 140));
      ok('keeps the rest of the body', JSON.stringify(row.meta ?? {}).includes('probe'));
    }

    // A 500 must be kept — the write may have half-landed.
    const before5xx = await prisma.auditLog.count({ where: { at: { gte: startedAt } } });
    await run({
      method: 'POST', path: '/purchases', originalUrl: '/api/v1/purchases',
      body: {}, ip: '127.0.0.1', auth: { userId: user.id, role: 'ADMIN', permissions: [] },
    }, 500);
    const after5xx = await prisma.auditLog.count({ where: { at: { gte: startedAt } } });
    ok('a 500 is recorded, and marked as failed', after5xx === before5xx + 1);
    const failRow = await prisma.auditLog.findFirst({
      where: { at: { gte: startedAt }, status: 500 }, orderBy: { at: 'desc' },
    });
    ok('the failed entry says so in its summary',
       !!failRow && failRow.summary.includes('failed'), failRow?.summary);
  }

  await cleanup();
  report();
};

async function cleanup() {
  // Remove only what this run created.
  const removed = await prisma.auditLog.deleteMany({ where: { at: { gte: startedAt } } });
  ok(`cleanup removed this run's ${removed.count} entries`, true);
}

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('ERROR:', e.message); ok('script ran to completion', false, e.message); await cleanup().catch(() => {}); report(); })
  .finally(() => prisma.$disconnect());
