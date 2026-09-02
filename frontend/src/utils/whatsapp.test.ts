import { describe, it, expect, vi } from 'vitest';
import {
  formatWAPhone, buildWALink, buildWADesktopLink,
  fillTemplate, buildItemsList,
} from './whatsapp';

describe('formatWAPhone', () => {
  it('converts a Sri Lankan local number to country format', () => {
    expect(formatWAPhone('0771234567')).toBe('94771234567');
    expect(formatWAPhone('077 123 4567')).toBe('94771234567');
    expect(formatWAPhone('077-123-4567')).toBe('94771234567');
  });

  it('leaves an already-normalised number alone', () => {
    expect(formatWAPhone('94771234567')).toBe('94771234567');
  });

  it('accepts international input', () => {
    expect(formatWAPhone('+94771234567')).toBe('94771234567');
    expect(formatWAPhone('+44 7700 900123')).toBe('447700900123');
    expect(formatWAPhone('0094771234567')).toBe('94771234567');
  });

  it('returns empty for anything unusable, so the caller can warn', () => {
    // Empty means "no link" — the UI shows a toast naming the bad number
    // instead of opening WhatsApp on a wrong contact.
    expect(formatWAPhone('')).toBe('');
    expect(formatWAPhone(null)).toBe('');
    expect(formatWAPhone(undefined)).toBe('');
    expect(formatWAPhone('123')).toBe('');
    expect(formatWAPhone('abc')).toBe('');
    expect(formatWAPhone('+123')).toBe('');
  });
});

describe('buildWALink', () => {
  it('builds a wa.me link with the message encoded', () => {
    const link = buildWALink('0771234567', 'Hello Saji');
    expect(link).toBe('https://wa.me/94771234567?text=Hello%20Saji');
  });

  it('returns empty when the phone cannot be used', () => {
    expect(buildWALink('123', 'x')).toBe('');
    expect(buildWALink(null, 'x')).toBe('');
  });

  it('truncates a very long message rather than producing a broken URL', () => {
    const link = buildWALink('0771234567', 'x'.repeat(5000));
    expect(link.length).toBeLessThan(2100);
    expect(decodeURIComponent(link.split('text=')[1])).toContain('(truncated)');
  });

  it('encodes newlines and Rs. amounts safely', () => {
    const link = buildWALink('0771234567', 'Total Rs.1,250.00\nThanks & bye');
    expect(link).toContain('%0A');       // newline
    expect(link).toContain('%26');       // &
    expect(link).not.toContain(' ');
  });
});

describe('buildWADesktopLink', () => {
  it('uses the whatsapp:// scheme so the desktop app opens directly', () => {
    const link = buildWADesktopLink('0771234567', 'Hi');
    expect(link.startsWith('whatsapp://send?phone=94771234567')).toBe(true);
    expect(link).toContain('text=Hi');
  });

  it('returns empty for an unusable phone', () => {
    expect(buildWADesktopLink('nope', 'Hi')).toBe('');
  });
});

describe('fillTemplate', () => {
  it('substitutes placeholders', () => {
    expect(fillTemplate('Hi {name}, you owe {amount}', { name: 'Saji', amount: 'Rs.50' }))
      .toBe('Hi Saji, you owe Rs.50');
  });

  it('replaces every occurrence of the same placeholder', () => {
    expect(fillTemplate('{a} and {a}', { a: 'x' })).toBe('x and x');
  });

  it('treats null and undefined as empty', () => {
    expect(fillTemplate('[{a}][{b}]', { a: null, b: undefined })).toBe('[][]');
  });

  it('leaves an unknown placeholder visible instead of blanking it', () => {
    // A silently blanked placeholder reads as a bug in the message the customer
    // receives; leaving it shows the template needs fixing.
    expect(fillTemplate('Hi {name}, ref {unknown}', { name: 'Saji' }))
      .toBe('Hi Saji, ref {unknown}');
  });

  it('never re-substitutes a value as a placeholder', () => {
    // A customer literally named "{total}" must not have their name rewritten
    // into the bill amount.
    expect(fillTemplate('Dear {name}, total {total}', { name: '{total}', total: 'Rs.900' }))
      .toBe('Dear {total}, total Rs.900');
  });

  it('is unaffected by the order keys are declared in', () => {
    const a = fillTemplate('{x}{y}', { x: '{y}', y: 'B' });
    const b = fillTemplate('{x}{y}', { y: 'B', x: '{y}' });
    expect(a).toBe(b);
    expect(a).toBe('{y}B');
  });
});

describe('buildItemsList', () => {
  const line = (name: string, qty: number, lineTotalCents: number) => ({ name, qty, lineTotalCents });

  it('formats each line with money in rupees, not cents', () => {
    expect(buildItemsList([line('Mango', 2, 25000)])).toBe('- Mango x2 Rs.250.00');
  });

  it('lists several items one per line', () => {
    expect(buildItemsList([line('A', 1, 100), line('B', 3, 4550)]))
      .toBe('- A x1 Rs.1.00\n- B x3 Rs.45.50');
  });

  it('truncates a very long product name', () => {
    const out = buildItemsList([line('X'.repeat(60), 1, 100)]);
    expect(out).toContain('X'.repeat(30));
    expect(out).not.toContain('X'.repeat(31));
  });

  it('caps the list and says how many were left out', () => {
    const many = Array.from({ length: 25 }, (_, i) => line(`P${i}`, 1, 100));
    const out = buildItemsList(many);
    expect(out.split('\n')).toHaveLength(21);          // 20 rows + the summary
    expect(out).toContain('...and 5 more items');
  });

  it('handles an empty cart without producing junk', () => {
    expect(buildItemsList([])).toBe('');
  });
});

// ─── openWhatsApp: which window does it open? ────────────────────────────────
//
// Regression guard. This used to use target="_blank", so a shop messaging
// twenty customers finished the morning with twenty abandoned WhatsApp Web
// tabs. A named target makes the browser reuse the same one.

describe('openWhatsApp window reuse', () => {
  function captureAnchor(run: () => void) {
    const created: Record<string, string>[] = [];
    // vi.stubGlobal, not direct assignment: navigator is a getter-only
    // property on globalThis in Node and cannot be overwritten.
    vi.stubGlobal('document', {
      createElement: () => {
        const a: Record<string, unknown> = { style: {}, click: () => {}, remove: () => {} };
        created.push(a as Record<string, string>);
        return a;
      },
      body: { appendChild: () => {} },
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome' });
    // The failure path emits a toast, which dispatches on window.
    vi.stubGlobal('window', { dispatchEvent: () => true });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} });
    try { run(); } finally { vi.unstubAllGlobals(); }
    return created[0];
  }

  it('opens a NAMED window, never _blank', async () => {
    const { openWhatsApp } = await import('./whatsapp');
    const a = captureAnchor(() => openWhatsApp('0771234567', 'Hi'));
    expect(a.target).toBeTruthy();
    expect(a.target).not.toBe('_blank');
  });

  it('uses the same window name every time, so sends reuse one tab', async () => {
    const { openWhatsApp } = await import('./whatsapp');
    const first  = captureAnchor(() => openWhatsApp('0771234567', 'One'));
    const second = captureAnchor(() => openWhatsApp('0779999999', 'Two'));
    expect(second.target).toBe(first.target);
  });

  it('outside Electron it uses the https wa.me link, which a browser can honour', async () => {
    const { openWhatsApp } = await import('./whatsapp');
    const a = captureAnchor(() => openWhatsApp('0771234567', 'Hi'));
    expect(a.href.startsWith('https://wa.me/')).toBe(true);
  });

  it('returns false and opens nothing when the number is unusable', async () => {
    const { openWhatsApp } = await import('./whatsapp');
    let result = true;
    const a = captureAnchor(() => { result = openWhatsApp('nope', 'Hi'); });
    expect(result).toBe(false);
    expect(a).toBeUndefined();
  });
});
