// ─── Demo installation ───────────────────────────────────────────────────────
//
// The single entry point the rest of the app touches. Called from services/api.ts
// behind `import.meta.env.VITE_DEMO_MODE === 'true'`, which Vite replaces with a
// literal at build time — so in a normal build the call is dead code, this
// module has no other importer, and Rollup drops the whole `src/demo` tree.
//
// Verified rather than assumed: `npm run verify:demo` greps both bundles, per
// CLAUDE.md §12.2 ("grep the built bundle before trusting a build").

import type { AxiosInstance } from 'axios';
import { demoAdapter } from './adapter';

export function installDemoAdapter(instance: AxiosInstance): void {
  instance.defaults.adapter = demoAdapter;
  // A visible marker so anyone inspecting a running demo can tell what they are
  // looking at, and so the smoke test has something to assert on.
  (window as unknown as Record<string, unknown>).__MODERNERP_DEMO__ = true;
}
