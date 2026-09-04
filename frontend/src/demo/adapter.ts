// ─── The demo axios adapter ───────────────────────────────────────────────────
//
// Every API call in this app goes through the single axios instance in
// services/api.ts. Replacing that instance's adapter therefore intercepts 100%
// of API traffic with no service worker, no `public/mockServiceWorker.js`, and
// nothing for a static host to rewrite.
//
// The adapter resolves a real AxiosResponse and rejects with a real AxiosError,
// so `axios.isAxiosError(err)` and `err.response.status` keep working in the
// pages that check them (POSPage, ProductsPage, SalesPage, PurchasesPage,
// InventoryPage all branch on a 404).

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios';
import { DemoHttpError, type DemoHandler } from './http';
import { ROUTES } from './handlers';
import { persist } from './db';

// Defined in http.ts, which imports nothing — see that file for why.
export { DemoHttpError, type DemoCtx, type DemoHandler } from './http';

// ─── Route matching ──────────────────────────────────────────────────────────

interface CompiledRoute {
  method: string;
  keys: string[];
  re: RegExp;
  handler: DemoHandler;
}

function compile(method: string, pattern: string, handler: DemoHandler): CompiledRoute {
  const keys: string[] = [];
  const re = new RegExp(
    '^' +
      pattern
        .replace(/\/:([A-Za-z0-9_]+)/g, (_m, k: string) => {
          keys.push(k);
          return '/([^/]+)';
        })
        .replace(/\*/g, '.*') +
      '/?$',
  );
  return { method: method.toUpperCase(), keys, re, handler };
}

const COMPILED: CompiledRoute[] = Object.entries(ROUTES).map(([sig, handler]) => {
  const idx = sig.indexOf(' ');
  return compile(sig.slice(0, idx), sig.slice(idx + 1), handler as DemoHandler);
});

/** Endpoints a demo build reached but nothing handles — surfaced loudly, once each. */
const unmatched = new Set<string>();

function stripBase(url: string, baseURL?: string): string {
  let p = url;
  if (baseURL && p.startsWith(baseURL)) p = p.slice(baseURL.length);
  // A configured VITE_API_URL such as `/api/v1` may still be glued on the front.
  p = p.replace(/^https?:\/\/[^/]+/, '');
  p = p.replace(/^\/api\/v1/, '');
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  if (!p.startsWith('/')) p = '/' + p;
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── The adapter ─────────────────────────────────────────────────────────────

export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toUpperCase();
  const path = stripBase(config.url ?? '', config.baseURL);

  // A little latency so spinners and optimistic states are visible — a demo
  // that answers in 0ms reads as fake. Kept short enough to feel quick.
  await delay(70 + Math.random() * 90);

  const query: Record<string, string> = {};
  const cp = config.params as Record<string, unknown> | undefined;
  if (cp) {
    for (const [k, v] of Object.entries(cp)) {
      if (v !== undefined && v !== null && v !== '') query[k] = String(v);
    }
  }
  // Anything already on the URL wins nothing — it is merged in the same way.
  const rawUrl = config.url ?? '';
  const qIdx = rawUrl.indexOf('?');
  if (qIdx >= 0) {
    new URLSearchParams(rawUrl.slice(qIdx + 1)).forEach((v, k) => {
      if (!(k in query)) query[k] = v;
    });
  }

  let body: any = config.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* leave as-is */ }
  }

  const ok = (data: unknown, status = 200): AxiosResponse => ({
    data, status,
    statusText: status === 200 ? 'OK' : 'Created',
    headers: {},
    config,
    request: {},
  });

  for (const r of COMPILED) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;

    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

    try {
      const data = r.handler({ params, query, body, method, path });
      // Every handler mutates the same object graph; one save point keeps the
      // persisted copy consistent with what the UI just rendered.
      persist();
      return ok(data, method === 'POST' ? 201 : 200);
    } catch (err) {
      const status = err instanceof DemoHttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Demo error';
      if (status >= 500) console.error('[demo] handler threw', path, err);
      throw new AxiosError(
        message,
        String(status),
        config,
        {},
        { data: { message }, status, statusText: 'Error', headers: {}, config, request: {} } as AxiosResponse,
      );
    }
  }

  const sig = `${method} ${path}`;
  if (!unmatched.has(sig)) {
    unmatched.add(sig);
    console.warn(`[demo] no handler for ${sig} — returning 404`);
  }
  throw new AxiosError(
    'This part of the system is not included in the demo.',
    '404',
    config,
    {},
    {
      data: { message: 'This part of the system is not included in the demo.' },
      status: 404, statusText: 'Not Found', headers: {}, config, request: {},
    } as AxiosResponse,
  );
};

/** Every route the demo build failed to answer — read in the browser console. */
export function unmatchedRoutes(): string[] {
  return [...unmatched];
}
