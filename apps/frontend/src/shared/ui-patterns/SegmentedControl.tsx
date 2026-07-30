import { cn } from '@shared/lib/cn';

interface SegmentedControlOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * The sliding-pill segmented control confirmed 3+ times in the design source
 * (Homepage hero tenant/owner toggle, Homepage search/list toggle, AuthModal
 * login/signup toggle, Money's Overview/Collections/Expenses sub-tabs). A
 * filled pill translates behind flex-1 buttons via CSS grid + transform,
 * matching the extracted `transform: translateX(...)` animation pattern.
 */
export function SegmentedControl({ options, value, onChange, className }: SegmentedControlProps) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      className={cn('relative grid rounded-full bg-muted p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <div
        className="absolute inset-y-1 rounded-full bg-primary shadow-sm transition-transform duration-200 ease-out"
        style={{
          width: `calc(${100 / options.length}% - 0.25rem)`,
          transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 0.25}rem))`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'relative z-10 rounded-full px-3 py-1.5 text-sm font-bold transition-colors',
            option.value === value ? 'text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
