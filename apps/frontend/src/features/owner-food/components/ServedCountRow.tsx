import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

interface ServedCountRowProps {
  label: string;
  served: number | null;
  busy: boolean;
  onSave: (count: number) => Promise<unknown>;
}

/**
 * "How many did you serve?" — one number, entered by the person who served it.
 * Deliberately blunt: a numeric keypad, a wide tap target and nothing else,
 * because this sits on the kitchen wall screen (ADR-144's audience). Every
 * number entered here is what the forecast learns from (ADR-194).
 */
export function ServedCountRow({ label, served, busy, onSave }: ServedCountRowProps) {
  const [value, setValue] = useState(served === null ? '' : String(served));
  useEffect(() => setValue(served === null ? '' : String(served)), [served]);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== served;

  return (
    <div className="flex items-center gap-2 py-2">
      <span className="flex-1 text-[13px] text-muted-foreground">{label}</span>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        aria-label={`How many were served — ${label}`}
        className="h-11 w-20 rounded-xl border border-border bg-card px-3 text-center text-[17px] font-bold tabular-nums text-foreground"
      />
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => onSave(parsed)}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
        aria-label={`Save served count for ${label}`}
      >
        <Check className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
