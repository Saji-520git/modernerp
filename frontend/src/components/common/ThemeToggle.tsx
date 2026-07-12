import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// ─── ThemeToggle ───────────────────────────────────────────────────────────────
// Three-state segmented control: Light / System / Dark. Built entirely from the
// design-system semantic tokens so it themes itself in both palettes.

const OPTIONS = [
  { value: 'light',  Icon: Sun,     label: 'Light theme'  },
  { value: 'system', Icon: Monitor, label: 'System theme' },
  { value: 'dark',   Icon: Moon,    label: 'Dark theme'   },
] as const;

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={`inline-flex items-center gap-0.5 rounded-token-lg border border-line bg-surface-raised p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            title={label}
            aria-label={label}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-token-md transition-colors ${
              active
                ? 'bg-accent text-accent-fg shadow-token-sm'
                : 'text-content-muted hover:bg-surface hover:text-content'
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
