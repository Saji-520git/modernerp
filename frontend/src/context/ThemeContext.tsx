import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

// ─── Theme system (Phase 1 foundation) ────────────────────────────────────────
// Single source of truth for the active theme. The user's choice is one of
// 'light' | 'dark' | 'system'; 'system' follows the OS preference live. The
// resolved value is stamped onto <html data-theme> (same attribute the
// anti-FOUC script in index.html sets before first paint), which drives the
// CSS-variable token palette defined in styles/index.css.

type ThemeChoice   = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'erp_theme';

interface ThemeContextValue {
  theme:         ThemeChoice;    // the user's explicit choice
  resolvedTheme: ResolvedTheme;  // what is actually applied right now
  setTheme:      (t: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
}

function applyToDom(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch { /* ignore */ }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState]       = useState<ThemeChoice>(readStoredChoice);
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>(() => resolve(theme));

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    const r = resolve(next);
    setResolved(r);
    applyToDom(r);
  }, []);

  // Keep the DOM in sync on mount and, while in 'system' mode, follow live OS changes.
  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    applyToDom(r);

    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const rr = resolve('system');
      setResolved(rr);
      applyToDom(rr);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
