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
  redact, entityOf, entityIdOf, actionOf, shouldRecord,
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
