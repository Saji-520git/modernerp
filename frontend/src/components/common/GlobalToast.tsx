import { useEffect, useState } from 'react';
import { TOAST_EVENT, type ToastPayload } from '../../lib/toast-bus';

export default function GlobalToast() {
  const [toast, setToast] = useState<ToastPayload | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastPayload>).detail;
      setToast(detail);
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (!toast) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-[9999] transition-all ${
        toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {toast.msg}
    </div>
  );
}
