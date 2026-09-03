/**
 * Audit trail — what gets recorded and how it reads. Pure, no DB.
 *
 * These are the decisions the trail's usefulness rests on, and the ones least
 * visible by inspection:
 *
 *   * a password reaching the table would turn an audit record into a
 *     credential leak that outlives the account
 *   * recording POST /sales/:id/confirm as CREATE would make the trail describe
 *     a sale that never happened
 *   * recording reads would bury the entries that matter under GET traffic
 *   * dropping 5xx would lose exactly the requests that may have half-landed
 */
import {
  redact, entityOf, entityIdOf, actionOf, shouldRecord, routePathOf,
} from '../src/middleware/audit-rules';

describe('redact', () => {
  it('removes a password at the top level', () => {
    expect(redact({ email: 'a@b.c', password: 'hunter2' }))
      .toEqual({ email: 'a@b.c', password: '[redacted]' });
  });

  it('removes credentials nested inside an object', () => {
    const out = redact({ user: { name: 'Sajith', passwordHash: '$2a$12$abc' } }) as any;
    expect(out.user.passwordHash).toBe('[redacted]');
    expect(out.user.name).toBe('Sajith');
  });

  it('removes credentials nested inside an array', () => {
    const out = redact({ users: [{ name: 'A', password: 'x' }, { name: 'B', token: 'y' }] }) as any;
    expect(out.users[0].password).toBe('[redacted]');
    expect(out.users[1].token).toBe('[redacted]');
  });

  it('covers every credential-shaped field name', () => {
    const body: Record<string, string> = {};
    for (const k of ['password', 'currentPassword', 'newPassword', 'confirmPassword',
                     'passwordHash', 'token', 'accessToken', 'refreshToken', 'secret', 'apiKey']) {
      body[k] = 'sensitive';
    }
    const out = redact(body) as Record<string, string>;
    expect(Object.values(out).every((v) => v === '[redacted]')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('sensitive');
  });

  it('keeps ordinary values untouched', () => {
    expect(redact({ qty: 5, name: 'Cement', paid: true, note: null }))
      .toEqual({ qty: 5, name: 'Cement', paid: true, note: null });
  });

  it('summarises a long array instead of storing all of it', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ productId: `p${i}`, qty: 1 }));
    const out = redact({ lines }) as any;
    expect(out.lines).toHaveLength(21);
    expect(out.lines[20]).toBe('…and 30 more');
  });

  it('stops recursing rather than looping forever on a cycle', () => {
    const a: any = { name: 'a' };
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
  });

  it('passes primitives through', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(7)).toBe(7);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('entityOf', () => {
  it.each([
    ['/sales',                    'sales'],
    ['/sales/abc/payments',       'sales'],
    ['/settings',                 'settings'],
    ['/inventory/write-off',      'inventory'],
    ['/',                         'unknown'],
  ])('%s -> %s', (path, expected) => {
    expect(entityOf(path)).toBe(expected);
  });
});

describe('entityIdOf', () => {
  it('finds a cuid anywhere in the path', () => {
    expect(entityIdOf('/sales/cmt1vpeqx00131dmb3y3ld5yr/confirm'))
      .toBe('cmt1vpeqx00131dmb3y3ld5yr');
  });

  it('finds a uuid', () => {
    expect(entityIdOf('/purchases/3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
      .toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('does not mistake route words for an id', () => {
    expect(entityIdOf('/inventory/adjustments')).toBeNull();
    expect(entityIdOf('/settings')).toBeNull();
    expect(entityIdOf('/purchases/from-alerts')).toBeNull();
  });
});

describe('actionOf', () => {
  it('reads the verb from the route tail, not the method', () => {
    expect(actionOf('POST', '/sales/abc/confirm')).toBe('CONFIRM');
    expect(actionOf('POST', '/sales/abc/cancel')).toBe('CANCEL');
    expect(actionOf('POST', '/pos/shift/close')).toBe('CLOSE');
    expect(actionOf('POST', '/inventory/write-off')).toBe('WRITE_OFF');
    expect(actionOf('POST', '/inventory/transfers')).toBe('TRANSFER');
    expect(actionOf('PATCH', '/users/abc/permissions')).toBe('PERMISSIONS');
    expect(actionOf('POST', '/auth/login')).toBe('LOGIN');
  });

  it('falls back to the method when the tail carries no verb', () => {
    expect(actionOf('POST',   '/products')).toBe('CREATE');
    expect(actionOf('DELETE', '/products/abc')).toBe('DELETE');
    expect(actionOf('PATCH',  '/products/abc')).toBe('UPDATE');
    expect(actionOf('PUT',    '/products/abc')).toBe('UPDATE');
  });
});

describe('shouldRecord', () => {
  it('ignores reads', () => {
    expect(shouldRecord('GET',     '/sales', 200)).toBe(false);
    expect(shouldRecord('HEAD',    '/sales', 200)).toBe(false);
    expect(shouldRecord('OPTIONS', '/sales', 204)).toBe(false);
  });

  it('records a successful write', () => {
    expect(shouldRecord('POST',   '/sales', 201)).toBe(true);
    expect(shouldRecord('PATCH',  '/settings', 200)).toBe(true);
    expect(shouldRecord('DELETE', '/products/abc', 204)).toBe(true);
  });

  it('ignores a rejected write, which changed nothing', () => {
    expect(shouldRecord('POST', '/sales', 400)).toBe(false);
    expect(shouldRecord('POST', '/sales', 401)).toBe(false);
    expect(shouldRecord('POST', '/sales', 409)).toBe(false);
  });

  it('KEEPS a server error — the write may have partly landed', () => {
    expect(shouldRecord('POST', '/sales', 500)).toBe(true);
  });

  it('ignores routine noise that changes state but means nothing', () => {
    expect(shouldRecord('POST',  '/auth/refresh', 200)).toBe(false);
    expect(shouldRecord('PATCH', '/alerts/abc/read', 200)).toBe(false);
    expect(shouldRecord('POST',  '/alerts/read-all', 200)).toBe(false);
  });
});

// ─── routePathOf — the bug that made every entity wrong ───────────────────────
//
// The trail derived entity and entityId from `req.path`, read inside
// res.on('finish'). Express rewrites req.url/req.path as a request descends
// into nested routers, so by then only the innermost remainder is left. Every
// row recorded a last path segment, the word "unknown", or a raw cuid — and the
// entity filter is the main way the trail is read.
//
// These pin the real observed values from the live trail.
describe('routePathOf — derive the route from originalUrl, never req.path', () => {
  it('strips the api version prefix', () => {
    expect(routePathOf('/api/v1/customers')).toBe('/customers');
    expect(routePathOf('/api/v2/sales/abc')).toBe('/sales/abc');
  });

  it('strips the query string', () => {
    expect(routePathOf('/api/v1/sales?from=2026-09-01&to=2026-09-03')).toBe('/sales');
  });

  it('leaves an already-clean path alone', () => {
    expect(routePathOf('/customers')).toBe('/customers');
  });

  it('never returns empty', () => {
    expect(routePathOf('/api/v1')).toBe('/');
    expect(routePathOf('/api/v1/')).toBe('/');
  });

  it('yields the right entity for the routes that were recorded wrong', () => {
    // left: what the trail actually stored. right: what it should have.
    const cases: [string, string, string][] = [
      ['/api/v1/customers',                   'unknown',                     'customers'],
      ['/api/v1/customers/cmtlrz2kt0001510v', 'cmtlrz2kt0001510v',           'customers'],
      ['/api/v1/customer-payments/lump-sum',  'lump-sum',                    'customer-payments'],
      ['/api/v1/supplier-payments/lump-sum',  'lump-sum',                    'supplier-payments'],
      ['/api/v1/auth/login',                  'login',                       'auth'],
      ['/api/v1/pos/checkout',                'checkout',                    'pos'],
      ['/api/v1/sales/returns',               'returns',                     'sales'],
    ];
    for (const [url, wrong, right] of cases) {
      expect(entityOf(routePathOf(url))).toBe(right);
      expect(entityOf(routePathOf(url))).not.toBe(wrong);
    }
  });

  it('still finds the record id in a nested route', () => {
    // req.path at finish would have been '/payments' here, losing the id
    // entirely — the "everything that happened to this invoice" view.
    expect(entityIdOf(routePathOf('/api/v1/sales/cmtjd4upu005ec19omuixiz7f/payments')))
      .toBe('cmtjd4upu005ec19omuixiz7f');
    expect(entityOf(routePathOf('/api/v1/sales/cmtjd4upu005ec19omuixiz7f/payments')))
      .toBe('sales');
  });

  it('keeps the action verb readable through the prefix', () => {
    expect(actionOf('POST', routePathOf('/api/v1/sales/cmtjd4upu005ec19omuixiz7f/confirm'))).toBe('CONFIRM');
    expect(actionOf('POST', routePathOf('/api/v1/pos/shifts/close'))).toBe('CLOSE');
  });

  it('the skip list still matches once the prefix is gone', () => {
    // SKIP patterns are anchored at /auth/refresh, so they only work against a
    // prefix-stripped path — another reason this must not be raw originalUrl.
    expect(shouldRecord('POST', routePathOf('/api/v1/auth/refresh'), 200)).toBe(false);
    expect(shouldRecord('POST', routePathOf('/api/v1/auth/login'), 200)).toBe(true);
  });
});
