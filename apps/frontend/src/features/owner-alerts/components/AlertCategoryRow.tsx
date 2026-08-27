import { ChevronRight } from 'lucide-react';

interface AlertCategoryRowProps {
  label: string;
  description: string;
  count: number;
  onClick: () => void;
}

/** One category on the Alerts menu — a full-width card-button, same convention as `TenantRow`. */
export function AlertCategoryRow({ label, description, count, onClick }: AlertCategoryRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-3.5 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      <div className="min-w-0 flex-1">
        <div className="font-display text-[14px] font-bold text-foreground">{label}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{description}</div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{count}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
      </div>
    </button>
  );
}
