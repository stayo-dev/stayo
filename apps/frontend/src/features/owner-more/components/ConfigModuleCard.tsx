import { ChevronRight } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';

interface ConfigModuleCardProps {
  glyph: string;
  title: string;
  desc: string;
  status: 'ok' | 'warn';
  statusLabel: string;
  meta: string;
  tint: string;
  iconColor: string;
  onClick: () => void;
}

/** One "Configuration modules" tile — icon square, title/desc, status pill + meta. */
export function ConfigModuleCard({ glyph, title, desc, status, statusLabel, meta, tint, iconColor, onClick }: ConfigModuleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-[13px] rounded-[18px] border border-border bg-card px-[15px] py-[15px] text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      <span
        className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl font-display text-[17px] font-bold"
        style={{ background: tint, color: iconColor }}
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[14.5px] font-bold tracking-tight text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
        <div className="mt-1 flex items-center gap-2">
          <StatusPill tone={status === 'ok' ? 'success' : 'warning'} variant="filter">{statusLabel}</StatusPill>
          <span className="text-[11px] text-muted-foreground/70">{meta}</span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 flex-none self-center text-muted-foreground/50" />
    </button>
  );
}
