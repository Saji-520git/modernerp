import { useState, useRef, useEffect } from 'react';
import { Barcode } from 'lucide-react';

export interface BarcodeInputProps {
  onScan: (barcode: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** When true: brief blue highlight animation for 300 ms after a scan */
  showScanning?: boolean;
}

export default function BarcodeInput({
  onScan,
  placeholder = 'Scan barcode…',
  autoFocus = false,
  disabled = false,
  className = '',
  showScanning = false,
}: BarcodeInputProps) {
  const [value, setValue]       = useState('');
  const [scanning, setScanning] = useState(false);
  const inputRef                = useRef<HTMLInputElement>(null);

  // autoFocus on mount
  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // stop form submission

    const code = value.trim();
    if (!code) return;

    // Visual flash feedback
    if (showScanning) {
      setScanning(true);
      setTimeout(() => setScanning(false), 300);
    }

    onScan(code);
    setValue('');
    // Re-focus so the next scan lands here immediately
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const ringClass = scanning
    ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-400'
    : 'border-slate-200 bg-slate-50 focus:ring-2 focus:ring-indigo-400 focus:bg-white focus:border-indigo-300';

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full pl-3 pr-8 py-2 text-sm border rounded-lg outline-none transition ${ringClass} disabled:opacity-50 disabled:cursor-not-allowed`}
      />
      <Barcode
        size={14}
        className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
          scanning ? 'text-blue-500' : 'text-slate-300'
        }`}
      />
    </div>
  );
}
