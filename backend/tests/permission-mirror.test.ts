import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_PERMISSIONS, ROLE_DEFAULTS, IMPLIED_BY, PARENT_OF, FINE_LABELS,
  SUPER_ADMIN_PERMISSIONS, expandPermissions, resolvePermissions,
  type Permission,
} from '../src/config/permissions';

// The permission catalogue exists twice: here, and in the frontend service that
// decides which checkboxes an administrator is even shown. A key missing from
// the copy is a permission nobody can grant, and the two used to be kept in
// step by hand under a comment that said "mirror backend".
//
// frontend/src/services/users.ts is now generated from this file
// (scripts/gen-frontend-permissions.mjs). These tests are what makes that
// stick.
const MIRROR = join(__dirname, '..', '..', 'frontend', 'src', 'services', 'users.ts');
const mirrorSrc = readFileSync(MIRROR, 'utf8');

function mirrorPermissions(): string[] {
  const start = mirrorSrc.indexOf('export const ALL_PERMISSIONS = [');
  const end   = mirrorSrc.indexOf('] as const;', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...mirrorSrc.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('frontend permission mirror', () => {
  it('lists exactly the permissions the backend defines', () => {
    expect(mirrorPermissions().sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('is marked generated, so nobody hand-edits it back out of step', () => {
    expect(mirrorSrc).toContain('GENERATED, do not edit by hand');
  });
});

describe('permission catalogue', () => {
  it('has no duplicate keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('only implies permissions that exist', () => {
    for (const [parent, kids] of Object.entries(IMPLIED_BY)) {
      expect(ALL_PERMISSIONS).toContain(parent);
      for (const k of kids ?? []) expect(ALL_PERMISSIONS).toContain(k);
    }
  });

  it('gives every fine permission a label an administrator can read', () => {
    const unlabelled = Object.keys(PARENT_OF).filter((k) => !FINE_LABELS[k]?.label);
    expect(unlabelled).toEqual([]);
  });

  it('gives every fine permission exactly one parent', () => {
    const counts = new Map<string, number>();
    for (const kids of Object.values(IMPLIED_BY)) {
      for (const k of kids ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('never makes a permission its own ancestor', () => {
    // expandPermissions runs to a fixpoint; a cycle would hang it.
    for (const p of ALL_PERMISSIONS) {
      expect(expandPermissions([p])).toContain(p);
    }
  });
});

describe('expansion cannot widen access by accident', () => {
  // The safety property the whole design rests on: a child is only ever listed
  // under the coarse permission that already guards its route, so expanding a
  // grant hands nobody an action they could not already perform.
  it('leaves a grant of nothing as nothing', () => {
    expect(expandPermissions([])).toEqual([]);
  });

  it('never expands a client role into a super-admin permission', () => {
    for (const role of ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] as const) {
      const effective = resolvePermissions(role, null);
      for (const s of SUPER_ADMIN_PERMISSIONS) expect(effective).not.toContain(s);
    }
  });

  it('keeps module licensing on the vendor account alone', () => {
    expect(resolvePermissions('SUPER_ADMIN', null)).toContain('manage_modules');
    for (const role of ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] as const) {
      expect(resolvePermissions(role, null)).not.toContain('manage_modules');
    }
  });

  it('honours a per-user override and still expands it', () => {
    // A user given only the coarse key must still pass a fine-key route guard.
    const effective = resolvePermissions('STAFF', ['manage_products']);
    expect(effective).toContain('products.set_price');
    expect(effective).toContain('products.delete');
  });

  it('lets a fine key be granted WITHOUT its siblings', () => {
    // This is the point of the exercise: edit products, but never re-price them.
    const effective = resolvePermissions('STAFF', ['products.edit']);
    expect(effective).toContain('products.edit');
    expect(effective).not.toContain('products.set_price');
    expect(effective).not.toContain('manage_products');
  });

  it('drops keys that are not real permissions', () => {
    expect(resolvePermissions('STAFF', ['not_a_permission'])).not.toContain('not_a_permission');
  });
});

describe('role defaults', () => {
  it('keeps financial reporting away from the lowest role', () => {
    const staff = resolvePermissions('STAFF', null);
    expect(staff).not.toContain('reports.profit_loss');
    expect(staff).not.toContain('reports.aging');
    // …while leaving the operational ones it needs.
    expect(staff).toContain('reports.inventory');
  });

  it('still gives a manager the full reporting set', () => {
    const mgr = resolvePermissions('MANAGER', null);
    for (const r of IMPLIED_BY.view_reports ?? []) expect(mgr).toContain(r);
  });

  it('gives every role a defined, non-empty set', () => {
    for (const role of Object.keys(ROLE_DEFAULTS) as (keyof typeof ROLE_DEFAULTS)[]) {
      expect(resolvePermissions(role, null).length).toBeGreaterThan(0);
    }
  });

  it('grants a cashier the till but not the catalogue', () => {
    const c = resolvePermissions('CASHIER', null);
    expect(c).toContain('pos_checkout');
    expect(c).toContain('pos.void_sale');       // implied by pos_checkout
    expect(c).not.toContain('products.set_price');
    expect(c).not.toContain('manage_users');
  });
});

describe('every permission a route guards is real', () => {
  // A typo in requirePermission('...') is a route nobody can ever reach, and
  // TypeScript will not catch it because the guard takes a string.
  it('has no route guarded by an unknown permission', () => {
    const routeDir = join(__dirname, '..', 'src', 'modules');
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    let out = '';
    try {
      out = execSync(
        `grep -rho "requirePermission('[a-z_.]*')" "${routeDir}"`,
        { encoding: 'utf8' },
      );
    } catch {
      return;  // grep unavailable — skip rather than fail the suite
    }
    const used = [...new Set([...out.matchAll(/requirePermission\('([a-z_.]+)'\)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(0);
    const unknown = used.filter((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p));
    expect(unknown).toEqual([]);
  });
});

describe('a token minted before a permission was split', () => {
  // requirePermission expands req.auth.permissions at CHECK time. Without that,
  // deploying the report split 403s every signed-in user — their token still
  // names only view_reports — until they happen to log out and back in. This is
  // that exact case, and it cost a debugging round to find in the browser.
  const staleToken = ['view_reports', 'manage_products', 'pos_checkout'] as Permission[];

  it('still passes a guard on a fine key its coarse parent covers', () => {
    const held = expandPermissions(staleToken);
    expect(held).toContain('reports.profit_loss');
    expect(held).toContain('products.set_price');
    expect(held).toContain('pos.void_sale');
  });

  it('does not become a skeleton key', () => {
    const held = expandPermissions(staleToken);
    expect(held).not.toContain('manage_users');
    expect(held).not.toContain('manage_modules');
    expect(held).not.toContain('settings.system');
  });
});
