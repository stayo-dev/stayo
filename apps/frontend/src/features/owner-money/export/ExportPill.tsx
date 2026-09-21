import { Download } from 'lucide-react';

/**
 * The export button, shared by the Expenses and Collections tabs.
 *
 * Extracted so the two are one button rather than two copies that drift. Both
 * sit at the end of a row that scrolls horizontally, so it must not shrink.
 */
export function ExportPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Export"
      className="flex h-10.5 flex-none items-center gap-1.5 rounded-[14px] border border-border bg-card px-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      <Download className="h-3.5 w-3.5 text-foreground/80" strokeWidth={1.8} />
      <span className="font-display text-[12.5px] font-bold text-foreground">Export</span>
    </button>
  );
}
