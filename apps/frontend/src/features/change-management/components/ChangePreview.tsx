import { ArrowDown } from 'lucide-react';

export interface ChangeField {
  label: string;
  current: string | null;
  proposed: string | null;
}

interface ChangePreviewProps {
  changes: ChangeField[];
  className?: string;
}

/**
 * Change Preview — shows current → proposed values for each changed field.
 * Designed for owners and tenants to quickly understand what will change.
 */
export function ChangePreview({ changes, className = '' }: ChangePreviewProps) {
  if (changes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No changes to preview.
      </p>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {changes.map((field) => (
        <div
          key={field.label}
          className="rounded-xl border border-border bg-secondary/20 p-3.5"
        >
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
            {field.label}
          </p>
          <div className="flex items-center gap-3">
            {/* Current value */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground line-through decoration-rose-400/60">
                {field.current || '—'}
              </p>
            </div>

            <ArrowDown className="w-3.5 h-3.5 text-accent shrink-0 rotate-[-90deg]" />

            {/* Proposed value */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-foreground bg-accent/10 border border-accent/20 rounded-lg px-2 py-1">
                {field.proposed || '—'}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
