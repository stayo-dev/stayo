import { Search, X } from 'lucide-react';

interface AlertSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

/** Search box shared by the four Alerts category pages — scoped to whichever one renders it. */
export function AlertSearchBox({ value, onChange, placeholder, ariaLabel }: AlertSearchBoxProps) {
  return (
    <label className="flex items-center gap-2 rounded-[12px] border border-field-border bg-input-background px-3 py-2.5">
      <Search className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      )}
    </label>
  );
}
