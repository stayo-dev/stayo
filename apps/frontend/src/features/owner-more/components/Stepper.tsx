import { Minus, Plus } from 'lucide-react';

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}

/** −/+ number stepper used across Configuration sub-screens (tenant defaults, late-fee grace period). */
export function Stepper({ value, onChange, min, max }: StepperProps) {
  return (
    <div className="flex items-center gap-3.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-secondary text-muted-foreground"
      >
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="min-w-[24px] text-center font-display text-base font-extrabold tabular-nums text-foreground">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-secondary text-muted-foreground"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}
