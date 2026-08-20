import animate from 'tailwindcss-animate';

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

        // ── shadcn/ui names ────────────────────────────────────────────────
        // The vars these read are ALIASES of the tokens above (see the bridge
        // block in index.css), not a second palette. Purely additive: no name
        // here collides with an existing one, so every page that predates this
        // renders exactly as it did.
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card:        { DEFAULT: 'hsl(var(--card))',       foreground: 'hsl(var(--card-foreground))' },
        popover:     { DEFAULT: 'hsl(var(--popover))',    foreground: 'hsl(var(--popover-foreground))' },
        primary:     { DEFAULT: 'hsl(var(--primary))',    foreground: 'hsl(var(--primary-foreground))' },
        secondary:   { DEFAULT: 'hsl(var(--secondary))',  foreground: 'hsl(var(--secondary-foreground))' },
        muted:       { DEFAULT: 'hsl(var(--muted))',      foreground: 'hsl(var(--muted-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
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
  plugins: [animate],
};
