import { ChevronRight } from 'lucide-react';
import { isRowInteractive, type ConfigRow } from '../config/configRows';

/**
 * One setting row on a configuration module screen: status dot, title,
 * sub-line, and a chevron when it leads somewhere.
 *
 * The `unavailable` state renders muted and is deliberately **not** a button —
 * a row that looks tappable but does nothing is how the owner sign-out bug
 * happened (see docs/obsidian/Bugs.md). `isRowInteractive` is the single place
 * that decision is made, and it is unit-tested.
 */
const DOT_CLASS: Record<ConfigRow['state'], string> = {
  configured: 'bg-[color:var(--success)]',
  attention: 'bg-[color:var(--warning)]',
  off: 'bg-muted-foreground/40',
  unavailable: 'bg-muted-foreground/25',
};

export function ConfigSettingRow({
  row,
  onNavigate,
  className = '',
}: {
  row: ConfigRow;
  onNavigate: (route: string) => void;
  className?: string;
}) {
  const interactive = isRowInteractive(row);

  const body = (
    <>
      <span
        aria-hidden="true"
        className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${DOT_CLASS[row.state]}`}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[14px] font-semibold ${
            row.state === 'unavailable' ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {row.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{row.detail}</span>
      </span>
      {interactive && (
        <ChevronRight className="mt-1 h-3.5 w-3.5 flex-none text-muted-foreground/50" strokeWidth={2} />
      )}
    </>
  );

  if (!interactive) {
    return (
      <div
        aria-disabled="true"
        className={`flex items-start gap-3 px-4 py-3.5 opacity-60 ${className}`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate(row.route!)}
      className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 ${className}`}
    >
      {body}
    </button>
  );
}
