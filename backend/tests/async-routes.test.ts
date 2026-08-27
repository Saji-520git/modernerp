import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { asyncHandler } from '../src/middleware/async-handler';

// Express 4 does not catch a promise rejected inside a route handler. It does
// not 500, and it does not log — the request simply never gets a response, and
// the browser sits there until it gives up.
//
// That is what a scan of an unknown barcode did: getByBarcode threw
// HttpError(404), the route was registered without asyncHandler, and the till
// showed a spinner for thirty seconds instead of "no such product". It looked
// like a slow database. The database answered in five milliseconds.
//
// Seventy-odd routes were registered the same way. These tests pin down both
// halves: that the wrapper forwards a rejection, and that no route is left
// without one.

describe('asyncHandler', () => {
  it('forwards a rejected promise to next()', async () => {
    const boom = new Error('boom');
    const next = jest.fn();
    await asyncHandler(async () => { throw boom; })({} as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('does not call next() when the handler resolves', async () => {
    const next = jest.fn();
    await asyncHandler(async () => { /* responds itself */ })({} as never, {} as never, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a rejection even when it is not an Error', async () => {
    const next = jest.fn();
    await asyncHandler(async () => { throw 'a string'; })({} as never, {} as never, next);
    expect(next).toHaveBeenCalledWith('a string');
  });
});

describe('every route is wrapped', () => {
  const MODULES = join(__dirname, '..', 'src', 'modules');

  // A handler referenced as `ctrl.something` or `somethingController.method` is
  // a function this codebase owns, and every one of them is async. Bare
  // identifiers are excluded: those are imported directly and several wrap
  // themselves at the point of definition (settings, warehouses).
  const HANDLER = /(?:^|[\s,(])(?:[a-zA-Z]*[Cc]ontroller|ctrl)\.[A-Za-z0-9_]+/;

  const routeFiles = readdirSync(MODULES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(MODULES, d.name))
      .filter((f) => f.endsWith('.routes.ts'))
      .map((f) => join(MODULES, d.name, f)));

  it('finds the route files', () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  it.each(routeFiles.map((f) => [f.split(/[\\/]/).slice(-1)[0], f]))(
    '%s registers no unwrapped handler',
    (_name, file) => {
      const offenders = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) =>
          /^router\.(get|post|put|patch|delete|all)\(/.test(line)   // a registration
          && HANDLER.test(line)                                      // naming a controller fn
          && !/\bh\(|asyncHandler\(/.test(line))                     // but not wrapped
        .map(({ line, n }) => `line ${n}: ${line.slice(0, 100)}`);

      // A failure here is not a style nit. Each one is a request that hangs
      // forever the first time its handler throws.
      expect(offenders).toEqual([]);
    },
  );
});
