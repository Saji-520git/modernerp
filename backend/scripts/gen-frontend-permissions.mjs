// Regenerates the permission catalogue inside frontend/src/services/users.ts
// from the backend, which is the single source of truth.
//
// That file used to carry a hand-kept copy under a "mirror backend" comment.
// Hand-kept mirrors drift silently, and this one governs which checkboxes an
// administrator is even offered — a missing key is a permission nobody can
// grant. tests/permission-mirror.test.ts fails if the two ever disagree, and
// this script is how you put them back in step.
import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_PERMISSIONS, ROLE_DEFAULTS, permissionCatalogue } from '../dist/config/permissions.js';

const TARGET = '../frontend/src/services/users.ts';
const START  = 'export const ALL_PERMISSIONS = [';
// Stop before the hand-written user types: UserRole is declared there, and it
// is not part of the generated catalogue.
const END    = '\n// ─── User types';

const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const block = `export const ALL_PERMISSIONS = [
${ALL_PERMISSIONS.map((p) => `  ${q(p)},`).join('\n')}
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface PermissionChild {
  key:         Permission;
  label:       string;
  description: string;
}

export interface PermissionItem {
  key:         Permission;
  label:       string;
  description: string;
  /** Finer actions this permission contains. Granting the parent grants all. */
  children:    PermissionChild[];
}

export interface PermissionGroup {
  label:       string;
  icon:        string;
  permissions: PermissionItem[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
${permissionCatalogue().map((g) => `  {
    label: ${q(g.label)},
    icon: ${q(g.icon)},
    permissions: [
${g.permissions.map((p) => `      {
        key: ${q(p.key)}, label: ${q(p.label)},
        description: ${q(p.description)},
        children: [${p.children.length === 0 ? ']' : `
${p.children.map((c) => `          { key: ${q(c.key)}, label: ${q(c.label)}, description: ${q(c.description)} },`).join('\n')}
        ]`},
      },`).join('\n')}
    ],
  },`).join('\n')}
];

export const ROLE_DEFAULTS: Record<UserRole, Permission[]> = {
${Object.entries(ROLE_DEFAULTS).map(([role, perms]) =>
  `  ${role}: [\n${perms.map((p) => `    ${q(p)},`).join('\n')}\n  ],`).join('\n')}
};
`;

const src = readFileSync(TARGET, 'utf8');
const nl  = src.includes('\r\n') ? '\r\n' : '\n';
const flat = src.replace(/\r\n/g, '\n');

const from = flat.indexOf(START);
const to   = flat.indexOf(END);
if (from === -1 || to === -1 || to < from) {
  console.error('ABORT: could not locate the generated block in ' + TARGET);
  process.exit(1);
}

const header =
`// ─── Permission catalogue — GENERATED, do not edit by hand ───────────────────
//
// Source of truth: backend/src/config/permissions.ts
// Regenerate:      node scripts/gen-frontend-permissions.mjs   (from backend/)
// Guarded by:      backend/tests/permission-mirror.test.ts
`;

const next = flat.slice(0, from) + header + block + flat.slice(to);
writeFileSync(TARGET, nl === '\r\n' ? next.replace(/\n/g, '\r\n') : next);

console.log(`regenerated ${TARGET}`);
console.log(`  ${ALL_PERMISSIONS.length} permissions, ${permissionCatalogue().length} groups`);
