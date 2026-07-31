import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FilterSelectProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

/**
 * Compact, click-to-open dropdown used by the landing-page hostel-finder
 * demo (HostelDiscoveryDemo). Styled to the marketing theme so it drops into
 * the existing search card without changing its look — it just makes the
 * previously-static filter fields live. Closes on outside click / Escape.
 */
export function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-[130px] flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-2xl px-4.5 py-3.5 text-left transition-colors hover:bg-muted"
      >
        <div className="mb-1 flex items-center justify-between gap-2 font-display text-[11px] font-bold tracking-wide text-primary">
          {label}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.4} />
        </div>
        <div className="truncate text-[15px] font-semibold text-foreground">{value}</div>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-64 w-full min-w-[190px] overflow-auto rounded-xl border border-border bg-card py-1.5 shadow-[0_20px_50px_-20px_rgba(47,47,47,0.35)] animate-in fade-in slide-in-from-top-1 duration-150">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`block w-full px-4 py-2.5 text-left text-[14px] font-semibold transition-colors hover:bg-muted ${
                opt === value ? 'text-primary' : 'text-foreground'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
