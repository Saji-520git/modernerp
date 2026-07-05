// Minimal global toast event bus. Used by the QueryClient's default
// mutation error handler (main.tsx) to surface errors from mutation hooks
// that do not define their own onError. Mutations with their own onError
// are unaffected — see main.tsx defaultOptions.mutations.onError comment.
export type ToastPayload = { msg: string; ok: boolean };

export const TOAST_EVENT = 'app:toast';

export function emitToast(msg: string, ok: boolean) {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: { msg, ok } }));
}
