import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Keep `src/demo` out of every build that is not the demo.
 *
 * The call sites are already guarded by `import.meta.env.VITE_DEMO_MODE`, which
 * Vite folds to a literal, so the branches ARE eliminated — the components and
 * the adapter drop out cleanly. The seed data did not: `npm run verify:demo`
 * found `demo@akeel-hardware.lk`, `modernerp-demo-db` and the whole fictional
 * catalogue sitting in `dist/`, because without a `sideEffects` declaration
 * Rollup keeps an imported module whose exports are all unused.
 *
 * Relying on that heuristic to keep demo credentials and invented trading
 * figures out of a client's installer is not a safe bet, so the import is
 * severed instead: any relative import into `src/demo/` resolves to a stub, and
 * the real files never enter the graph. The dead branches then reference
 * harmless no-ops that nothing ever calls.
 *
 * CLAUDE.md §12.2 applies — `npm run verify:demo` greps both bundles rather
 * than trusting this.
 */
function stripDemoLayer(): Plugin {
  const VIRTUAL_ID = '\0modernerp:demo-stub';
  return {
    name: 'modernerp:strip-demo-layer',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || importer.startsWith('\0')) return null;
      // Relative imports only: `./demo/x`, `../demo/x`, `../../demo/x`.
      if (!source.startsWith('.')) return null;
      if (!/(^|\/)demo\//.test(source)) return null;
      return VIRTUAL_ID;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null;
      // Every shape the guarded call sites reference, all inert.
      return [
        'export default function DemoStub() { return null; }',
        'export function installDemoAdapter() {}',
        'export function resetDb() {}',
        'export const DEMO_ACCOUNTS = [];',
        'export const IS_DEMO = false;',
      ].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  return {
    plugins: [react(), ...(isDemo ? [] : [stripDemoLayer()])],
    base: './',
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: { port: 5173 },
  };
});
