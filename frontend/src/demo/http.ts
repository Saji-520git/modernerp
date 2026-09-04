// ─── The demo layer's HTTP vocabulary ────────────────────────────────────────
//
// A leaf module: it imports nothing, deliberately.
//
// These types and the error class started out in adapter.ts, which created a
// cycle — adapter imports the handlers, and every handler imports the error
// class back from adapter. That only worked because `DemoHttpError` is used
// inside function bodies rather than at module-evaluation time; the first
// handler to build a lookup table at module scope would have hit a TDZ error
// with no obvious cause. The same shape already cost this branch one debugging
// session (see the header of permissions.ts), so it is untangled here rather
// than left as a trap.

export interface DemoCtx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  method: string;
  path: string;
}

export type DemoHandler = (ctx: DemoCtx) => unknown;

/** Thrown by a handler to produce a real HTTP-shaped failure. */
export class DemoHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DemoHttpError';
  }
}
