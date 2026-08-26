// Can the client see, reach, or become the vendor's super-admin?
//
// This install ships offline on a machine the client controls, and the vendor
// keeps one SUPER_ADMIN account: the only account that can switch optional
// modules on. The product promise is that the client never sees it exists.
//
// Obscurity is not the control — the server is. Every assertion below drives
// the real service and controller guards, because a hidden row that a direct
// GET still returns is not hidden at all.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { usersService } from '../dist/modules/users/users.service.js';
import { SUPER_ADMIN_PERMISSIONS, ROLE_DEFAULTS, resolvePermissions } from '../dist/config/permissions.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

let tempAdminId = null;

const main = async () => {
  const supers = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' }, select: { id: true, email: true, passwordHash: true },
  });
  ok(`a vendor super-admin exists (${supers.length})`, supers.length >= 1);
  if (!supers.length) return report();
  const su = supers[0];

  // ── 1. The seeded credentials actually work ──────────────────────────────
  //
  // Checked through bcrypt, not by signing in: a wrong hash would lock the
  // vendor out of the one account that can license modules, on a machine that
  // may be a plane ride away.
  const expected = process.env.SUPER_ADMIN_PASSWORD ?? 'superadmin123';
  ok('the super-admin password verifies against its stored hash',
     await bcrypt.compare(expected, su.passwordHash),
     'seed/migration did not set the expected password');

  // ── 2. A client ADMIN cannot see it ──────────────────────────────────────
  const temp = await prisma.user.create({
    data: {
      email: `isolation-probe-${Date.now()}@local`,
      passwordHash: await bcrypt.hash('probe-account-1', 12),
      fullName: 'Isolation Probe', role: 'ADMIN',
    },
    select: { id: true },
  });
  tempAdminId = temp.id;

  const asAdmin = await usersService.list({ page: 1, pageSize: 100 }, false);
  const rows = asAdmin.data ?? asAdmin.users ?? [];
  ok('the user list hides every super-admin from an ADMIN',
     !rows.some((u) => u.role === 'SUPER_ADMIN'),
     rows.filter((u) => u.role === 'SUPER_ADMIN').map((u) => u.email).join(', '));
  ok('the probe ADMIN itself is listed — the filter is not just empty',
     rows.some((u) => u.id === tempAdminId));

  const asSuper = await usersService.list({ page: 1, pageSize: 100 }, true);
  const superRows = asSuper.data ?? asSuper.users ?? [];
  ok('a super-admin still sees them',
     superRows.some((u) => u.role === 'SUPER_ADMIN'));

  // ── 3. Nor reach it directly by id ───────────────────────────────────────
  //
  // 404, not 403: a "forbidden" confirms the id exists, which is the one bit
  // this design is trying not to leak.
  let status = null;
  try { await usersService.getOne(su.id, false); } catch (e) { status = e.status ?? e.statusCode; }
  ok('fetching it by id returns 404, not 403', status === 404, `got ${status}`);

  // ── 4. The counts must not give it away either ───────────────────────────
  const statsAdmin = await usersService.stats(false);
  const statsSuper = await usersService.stats(true);
  const total = (s) => s.total ?? s.totalUsers ?? s.count ?? null;
  if (total(statsAdmin) !== null && total(statsSuper) !== null) {
    ok('the user count excludes super-admins for an ADMIN',
       total(statsAdmin) === total(statsSuper) - supers.length,
       `admin sees ${total(statsAdmin)}, super sees ${total(statsSuper)}, ${supers.length} hidden`);
  } else {
    ok('user count shape understood', true, '(no total field to compare)');
  }

  // ── 5. A forgotten argument must hide, not expose ────────────────────────
  //
  // These default to false so the NEXT endpoint someone writes fails closed.
  const defaulted = await usersService.list({ page: 1, pageSize: 100 });
  const defaultRows = defaulted.data ?? defaulted.users ?? [];
  ok('calling list() with no viewer argument still hides super-admins',
     !defaultRows.some((u) => u.role === 'SUPER_ADMIN'),
     'the default is fail-open');

  // ── 6. The client's own top role cannot reach the vendor controls ────────
  const adminPerms = resolvePermissions('ADMIN', null);
  const leaked = SUPER_ADMIN_PERMISSIONS.filter((p) => adminPerms.includes(p));
  ok('ADMIN does not carry any super-admin-only permission',
     leaked.length === 0, leaked.join(', '));
  ok('SUPER_ADMIN does carry them',
     SUPER_ADMIN_PERMISSIONS.every((p) => ROLE_DEFAULTS.SUPER_ADMIN.includes(p)));

  // Module licensing is the point of the whole arrangement.
  ok('no client role can switch modules on',
     ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF']
       .every((r) => !resolvePermissions(r, null).includes('manage_modules')));

  report();
};

const cleanup = async () => {
  if (tempAdminId) {
    await prisma.user.delete({ where: { id: tempAdminId } }).catch(() => {});
    const left = await prisma.user.count({ where: { id: tempAdminId } });
    console.log(`\ncleanup: probe admin removed (${left} left behind)`);
  }
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
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(code); });
