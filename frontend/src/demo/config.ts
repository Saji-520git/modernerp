// ─── Demo mode configuration ──────────────────────────────────────────────────
//
// This whole directory exists ONLY for the hosted, frontend-only demo. It is
// compiled in when VITE_DEMO_MODE=true (see `.env.demo`) and tree-shaken out of
// every other build, so the Electron/production bundle is byte-identical to
// what it was before this branch. Nothing here talks to a real server.

/**
 * True only in a demo build. Read from an env var rather than a runtime check so
 * Rollup can statically eliminate the entire demo layer from a normal build:
 * `import.meta.env.VITE_DEMO_MODE` is replaced with a literal at build time and
 * `if (false)` branches are dropped.
 */
export const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

/** localStorage key holding the whole mutable demo database. */
export const DEMO_DB_KEY = 'modernerp-demo-db';

/** Bump when the seed shape changes so stale saved data is re-seeded, not merged. */
export const DEMO_DB_VERSION = 4;

/**
 * Demo sign-in accounts.
 *
 * Deliberately NOT the production seed credentials (`modernerp@gmail.com` /
 * `superadmin123`) — those must never appear on a public URL. These are
 * fictional, demo-only, and shown on the login screen on purpose.
 *
 * Neither account is SUPER_ADMIN: that role bypasses every module and role gate
 * (AppShell.isVisible), which would put vendor-only tooling in a client's demo.
 */
export const DEMO_ACCOUNTS = [
  {
    id: 'usr_demo_admin',
    email: 'demo@akeel-hardware.lk',
    password: 'Demo@2026',
    fullName: 'A. Akeel',
    role: 'ADMIN' as const,
    label: 'Owner / Admin',
    blurb: 'Full access — every module, every report.',
  },
  {
    id: 'usr_demo_cashier',
    email: 'cashier@akeel-hardware.lk',
    password: 'Counter@2026',
    fullName: 'Nadeesha Perera',
    role: 'CASHIER' as const,
    label: 'Counter staff',
    blurb: 'Till and stock only — no reports, no settings.',
  },
];

export type DemoAccount = (typeof DEMO_ACCOUNTS)[number];
