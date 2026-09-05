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
import { blobUrlFor } from './handlers/attachments';

export function installDemoAdapter(instance: AxiosInstance): void {
  instance.defaults.adapter = demoAdapter;
  interceptUploadFetches();
  // A visible marker so anyone inspecting a running demo can tell what they are
  // looking at, and so the smoke test has something to assert on.
  (window as unknown as Record<string, unknown>).__MODERNERP_DEMO__ = true;
}

/**
 * Serve `/uploads/<storedName>` from the in-memory attachment store.
 *
 * The adapter covers axios, which is every API call — but attachments and logos
 * are fetched with bare `fetch()` against a file server this demo does not
 * have, so a "view" would resolve to nothing. Only `/uploads/` paths are
 * touched; every other fetch goes to the original implementation untouched.
 */
function interceptUploadFetches(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = /\/uploads\/([^/?#]+)/.exec(url ?? '');
    if (match) {
      const blobUrl = blobUrlFor(decodeURIComponent(match[1]));
      // Nothing stored under that name — answer 404 rather than reaching out to
      // a server that is not there and failing with a network error.
      if (!blobUrl) return new Response(null, { status: 404, statusText: 'Not Found' });
      return original(blobUrl);
    }
    return original(input as RequestInfo, init);
  };
}
