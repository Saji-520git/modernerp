import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// ─── DiscountInput ─────────────────────────────────────────────────────────────
// Fixes the "sticking" bug: internal state is always a STRING.
// We only convert to number on blur or Enter — never on every keystroke.
// This prevents React's controlled-input cursor-reset on each character.
//
// Supports forwardRef so parent components (CartLine, totals panel) can
// imperatively focus this input for keyboard-driven cashier workflows.

interface DiscountInputProps {
  mode:         'percent' | 'amount';
  value:        number;          // committed value (% or display-currency amount)
  maxAmount?:   number;          // cart/line subtotal in cents, used to cap amount mode
  onChange:     (value: number) => void;
  onEnter?:     () => void;      // called after commit when Enter pressed (e.g. navigate to barcode)
  placeholder?: string;
  disabled?:    boolean;
}

export interface DiscountInputHandle {
  focus: () => void;
  select: () => void;
}

const DiscountInput = forwardRef<DiscountInputHandle, DiscountInputProps>(function DiscountInput({
  mode,
  value,
  maxAmount,
  onChange,
  onEnter,
  placeholder = '0',
  disabled    = false,
}, ref) {
  // String — never a number while typing
  const [draft,   setDraft]   = useState(() => value > 0 ? String(value) : '');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus:  () => { inputRef.current?.focus();  },
    select: () => { inputRef.current?.select(); },
  }));

  // Sync display when external value changes (e.g. mode switch resets parent to 0)
  useEffect(() => {
    if (!focused) {
      setDraft(value > 0 ? String(value) : '');
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const parsed = parseFloat(raw);

    // Guard: NaN, negative, or empty → zero
    if (isNaN(parsed) || parsed < 0) {
      onChange(0);
      setDraft('');
      return;
    }

    let clamped = parsed;

    if (mode === 'percent') {
      // Percent: 0–100
      clamped = Math.min(100, Math.max(0, parsed));
    } else {
      // Amount: 0 – maxAmount (display currency)
      const maxDisplay = maxAmount !== undefined ? maxAmount / 100 : Infinity;
      clamped = Math.min(maxDisplay, Math.max(0, parsed));
    }

    // Round to 2 dp so stored value is clean
    const rounded = Math.round(clamped * 100) / 100;
    onChange(rounded);
    setDraft(rounded > 0 ? String(rounded) : '');
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      disabled={disabled}
      // While focused: show raw draft string (don't interfere with typing)
      // While blurred:  show committed value (or empty if zero)
      value={focused ? draft : (value > 0 ? String(value) : '')}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => {
        setFocused(true);
        setDraft(value > 0 ? String(value) : '');
        setTimeout(() => inputRef.current?.select(), 0);
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(draft);
          inputRef.current?.blur();
          onEnter?.();
        }
        if (e.key === 'Escape') {
          // Revert to last committed value
          setDraft(value > 0 ? String(value) : '');
          setFocused(false);
          inputRef.current?.blur();
        }
      }}
      style={{
        width:           68,
        padding:         '2px 6px',
        fontSize:        12,
        textAlign:       'right',
        border:          focused ? '1.5px solid #818cf8' : '0.5px solid #cbd5e1',
        borderRadius:    5,
        outline:         'none',
        background:      focused ? '#f0f4ff' : 'white',
        transition:      'border-color 0.15s, background 0.15s',
        opacity:         disabled ? 0.5 : 1,
        cursor:          disabled ? 'not-allowed' : 'text',
        boxSizing:       'border-box',
      }}
    />
  );
});

export default DiscountInput;
