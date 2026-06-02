// Small client-side helpers for WhatsApp. Work in both Electron and browser.

/** Opens a wa.me link in a new tab/window (Electron opens the system browser). */
export function openWhatsApp(waLink: string): void {
  if (!waLink) return;
  window.open(waLink, '_blank', 'noopener,noreferrer');
}

/** Copies text to the clipboard; resolves to true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Legacy fallback for non-secure contexts.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Formats a stored phone for display: 077 123 4567.
 * Accepts 07XXXXXXXX / 94XXXXXXXX / +94XXXXXXXX and renders a local 0-prefixed
 * grouping when possible; otherwise returns the trimmed input.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('94')) digits = `0${digits.slice(2)}`;
  // Local mobile numbers are 10 digits (0XX XXX XXXX).
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone.trim();
}
