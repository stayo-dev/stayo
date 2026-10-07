import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  coverLines,
  coversSummary,
  dayLabel,
  formatRupees,
  initials,
  methodLabel,
  recordedLine,
  recordedTime,
  type ReceivedPayment,
} from './received';

interface ReceivedRowProps {
  payment: ReceivedPayment;
  /** Show which hostel — only when the list spans more than one. */
  showHostel: boolean;
  open: boolean;
  onToggle: () => void;
}

/**
 * One collection: who, for what, how much, how. Tapping opens the detail an
 * owner checks against his own books — the reference, when it was entered, and
 * how the amount was split across months. Wording lives in `received.ts`.
 */
export function ReceivedRow({ payment: p, showHostel, open, onToggle }: ReceivedRowProps) {
  const navigate = useNavigate();
  const fullyReversed = p.amount === 0 && p.reversedAmount > 0;
  const covers = coversSummary(p.covers, p.paidOn);
  const sub = [p.room ? `Room ${p.room}` : null, covers || null, showHostel ? p.hostelName : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-full font-display text-[12px] font-bold ${
            fullyReversed ? 'bg-muted text-muted-foreground' : 'bg-success/10 text-success'
          }`}
          aria-hidden
        >
          {initials(p.tenantName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground">{p.tenantName}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{sub}</span>
        </span>
        <span className="flex flex-none flex-col items-end">
          <span
            className={`font-display text-[13.5px] font-bold tabular-nums ${
              fullyReversed ? 'text-muted-foreground line-through' : 'text-success'
            }`}
          >
            {fullyReversed ? formatRupees(p.reversedAmount) : `+${formatRupees(p.amount)}`}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
            {fullyReversed ? (
              <span className="rounded bg-destructive/10 px-1 py-px text-destructive">Reversed</span>
            ) : (
              <span className="rounded bg-muted px-1 py-px">{methodLabel(p.method)}</span>
            )}
            {recordedTime(p.recordedAt)}
          </span>
        </span>
      </button>

      {open && (
        <div className="mb-3 rounded-xl bg-muted/60 px-3 py-2.5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <dt className="text-muted-foreground">Paid on</dt>
            <dd className="text-right font-semibold text-foreground">{dayLabel(p.paidOn)}</dd>
            <dt className="text-muted-foreground">Recorded</dt>
            <dd className="text-right font-semibold text-foreground">{recordedLine(p)}</dd>
            <dt className="text-muted-foreground">Method</dt>
            <dd className="text-right font-semibold text-foreground">{methodLabel(p.method)}</dd>
            {p.reference && (
              <>
                <dt className="text-muted-foreground">Reference</dt>
                {/* Selectable in full: he matches it character by character. */}
                <dd className="select-all break-all text-right font-mono font-semibold text-foreground">{p.reference}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Hostel</dt>
            <dd className="truncate text-right font-semibold text-foreground">{p.hostelName}</dd>
          </dl>

          {p.covers.length > 0 && (
            <div className="mt-2.5 border-t border-border/60 pt-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Paid for</p>
              <ul className="mt-1 flex flex-col gap-1">
                {coverLines(p.covers, p.paidOn).map((c, i) => (
                  <li key={i} className="flex justify-between text-[12px]">
                    <span className={c.reversed ? 'text-muted-foreground line-through' : 'text-foreground'}>
                      {c.label}
                      {c.reversed && <span className="ml-1.5 no-underline text-destructive">reversed</span>}
                    </span>
                    <span className={`tabular-nums ${c.reversed ? 'text-muted-foreground line-through' : 'font-semibold text-foreground'}`}>
                      {formatRupees(c.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate(`/owner/tenants/${p.tenantId}`)}
            className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border border-border bg-card py-2 font-display text-[12px] font-bold text-foreground"
          >
            Open {p.tenantName.split(' ')[0]}'s profile
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
