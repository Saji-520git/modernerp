import { describe, it, expect } from 'vitest';
import { cell, toCsv } from './import';

// The error report is the one file whose entire job is telling you what went
// wrong with an import. It quoted its fields but never escaped a quote inside
// one, so the message it most often carries —
//
//   Barcode "4791010001434" already belongs to product PRD-0126
//
// — closed its own field three characters in. Excel and every conforming
// parser mis-split the line, which is how a 73-row error report arrived
// unreadable.
describe('cell', () => {
  it('doubles a quote inside a value', () => {
    expect(cell('Barcode "479" already belongs'))
      .toBe('"Barcode ""479"" already belongs"');
  });

  it('wraps a value containing a comma', () => {
    expect(cell('Rani Rose Petal, Saffron')).toBe('"Rani Rose Petal, Saffron"');
  });

  it('renders null and undefined as empty, not as the word', () => {
    expect(cell(null)).toBe('""');
    expect(cell(undefined)).toBe('""');
  });

  it('keeps a number a number', () => {
    expect(cell(404)).toBe('"404"');
  });
});

describe('toCsv', () => {
  const real = 'Barcode "4791010001434" already belongs to product PRD-0126';

  it('produces a row a parser can split back correctly', () => {
    const csv = toCsv([['Row', 'Field', 'Error'], [404, 'barcode', real]]);
    const dataLine = csv.replace(/^\uFEFF/, '').split('\r\n')[1];

    // Split the way a conforming reader does: quoted fields, doubled quotes.
    const fields = (dataLine.match(/"(?:[^"]|"")*"/g) ?? [])
      .map((f) => f.slice(1, -1).replace(/""/g, '"'));

    expect(fields).toHaveLength(3);
    expect(fields[0]).toBe('404');
    expect(fields[1]).toBe('barcode');
    expect(fields[2]).toBe(real);          // the message survives intact
  });

  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(toCsv([['a']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('separates rows with CRLF', () => {
    expect(toCsv([['a'], ['b']]).replace(/^\uFEFF/, '')).toBe('"a"\r\n"b"\r\n');
  });
});
