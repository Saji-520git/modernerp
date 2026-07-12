/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Dark theme is driven by [data-theme="dark"] on <html> (set by ThemeProvider
  // + the anti-FOUC script). There are currently 0 `dark:` variants in the app,
  // so enabling this changes nothing until pages opt into the semantic tokens.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Legacy brand ramp (blue) — used by the .btn-primary CSS class. Kept
        // UNCHANGED so no existing page shifts; superseded by `accent` (indigo)
        // and slated for removal when .btn-primary is converted in Phase 2.
        brand: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        // ── Design-system semantic tokens → CSS vars (index.css) ──────────────
        app:     'var(--bg-app)',
        surface: {
          DEFAULT: 'var(--surface)',
          raised:  'var(--surface-2)',
          inset:   'var(--surface-inset)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong:  'var(--line-strong)',
        },
        content: {
          DEFAULT:   'var(--content)',
          secondary: 'var(--content-secondary)',
          muted:     'var(--content-muted)',
          inverse:   'var(--content-inverse)',
        },
        accent: {
          DEFAULT: 'var(--brand)',
          hover:   'var(--brand-hover)',
          subtle:  'var(--brand-subtle)',
          fg:      'var(--brand-fg)',
        },
        success: { DEFAULT: 'var(--success)', subtle: 'var(--success-subtle)' },
        danger:  { DEFAULT: 'var(--danger)',  subtle: 'var(--danger-subtle)'  },
        warning: { DEFAULT: 'var(--warning)', subtle: 'var(--warning-subtle)' },
        info:    { DEFAULT: 'var(--info)',    subtle: 'var(--info-subtle)'    },
      },
      boxShadow: {
        'token-sm': 'var(--shadow-sm)',
        'token-md': 'var(--shadow-md)',
        'token-lg': 'var(--shadow-lg)',
      },
      borderRadius: {
        'token-sm':  'var(--radius-sm)',
        'token-md':  'var(--radius-md)',
        'token-lg':  'var(--radius-lg)',
        'token-xl':  'var(--radius-xl)',
        'token-2xl': 'var(--radius-2xl)',
      },
    },
  },
  plugins: [],
};
