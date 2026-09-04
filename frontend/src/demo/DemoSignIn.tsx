import { FlaskConical, ChevronRight } from 'lucide-react';
import { DEMO_ACCOUNTS } from './config';

/**
 * The demo's sign-in shortcut, rendered under the login form in demo builds.
 *
 * A prospective client should not have to be told a password over the phone
 * before they can look at the product, so both accounts are offered as one-tap
 * buttons — sized as full-width rows because most of these visits happen on a
 * phone.
 *
 * These credentials are fictional and demo-only. The production seed accounts
 * are deliberately not used here and must never appear on a public URL.
 */
export default function DemoSignIn({
  onPick,
  disabled,
}: {
  onPick: (email: string, password: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-50/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500 text-white">
          <FlaskConical size={13} />
        </span>
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
          Demonstration — pick an account
        </p>
      </div>

      <div className="space-y-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(a.email, a.password)}
            className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-white
                       px-3.5 py-3 text-left transition hover:border-amber-400 hover:bg-amber-50
                       active:scale-[0.99] disabled:opacity-60"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-800">{a.label}</p>
              <p className="truncate text-xs text-slate-500">{a.blurb}</p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-amber-500" />
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-amber-800/70">
        Sample data only. Anything you change is kept in this browser and is never sent anywhere.
      </p>
    </div>
  );
}
