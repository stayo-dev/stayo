import { AlertTriangle, ChevronRight } from 'lucide-react';

interface ConfigAttentionRowProps {
  title: string;
  sub: string;
  onClick: () => void;
}

/** One "Needs attention" row — genuine misconfigurations only, never a deliberately-off toggle. */
export function ConfigAttentionRow({ title, sub, onClick }: ConfigAttentionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-warning/30 bg-card px-[14px] py-[13px] text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-warning/15">
        <AlertTriangle className="h-[15px] w-[15px] text-warning" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div className="text-[11.5px] text-muted-foreground">{sub}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/40" />
    </button>
  );
}
