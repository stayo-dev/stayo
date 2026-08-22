import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Check, Clock, AlertTriangle } from 'lucide-react';
import type { OwnerPayout } from '@features/owner-payouts/api';
import { formatInr, formatPastDate, formatPromiseDate } from '../../payouts/payoutState';
import { useOwnerPayoutBreakdown } from '../../hooks/useOwnerPayouts';

/**
 * One payout, expandable into the tenants who paid it.
 *
 * The expansion is not a detail view — it IS the feature. A payout an owner
 * cannot open into names is a number Stayo asserts; opened, it is a claim he
 * can check by phoning someone. Verifiability is what earns trust here, since
 * accuracy is not something he has any way to audit.
 *
 * The breakdown is fetched lazily so a long history costs one query, not fifty.
 */

function statusFace(payout: OwnerPayout) {
  if (payout.status === 'PAID') {
    return {
      Icon: Check,
      colour: 'text-success',
      label: 'In your bank',
      when: formatPastDate(payout.paidAt),
    };
  }
  if (payout.status === 'FAILED') {
    return { Icon: AlertTriangle, colour: 'text-destructive', label: "Didn't go through", when: null };
  }
  // PENDING and PROCESSING read the same to an owner: Stayo has it and hasn't
  // sent it yet. Exposing the difference would be describing our workflow to
  // someone who only wants to know when the money lands.
  return {
    Icon: Clock,
    colour: 'text-warning',
    label: 'With Stayo',
    when: formatPromiseDate(payout.expectedPayoutDate),
  };
}

export function PayoutRow({ payout }: { payout: OwnerPayout }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { breakdown, isLoading } = useOwnerPayoutBreakdown(open ? payout.id : null);
  const { Icon, colour, label, when } = statusFace(payout);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <Icon className={`h-4 w-4 flex-none ${colour}`} strokeWidth={2.5} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[15px] font-extrabold tabular-nums text-foreground">
              {formatInr(payout.amount)}
            </span>
            <span className={`text-[11px] font-semibold ${colour}`}>{label}</span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {payout.status === 'PAID'
              ? [when, payout.reference ? `UTR ${payout.reference}` : null].filter(Boolean).join(' · ')
              : payout.status === 'FAILED'
                ? payout.failureReason || 'The transfer was rejected'
                : when
                  ? `In your bank by ${when}`
                  : 'Being transferred'}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 flex-none text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-border/60 px-3.5 py-3">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
          ) : !breakdown ? (
            <p className="text-[11.5px] text-muted-foreground">Couldn't load this payout's details.</p>
          ) : (
            <>
              {/* The fee line is always rendered, always zero. Omitting it
                  because there is nothing to declare is how an owner comes to
                  assume there was. */}
              <div className="mb-2.5 rounded-xl bg-muted/50 px-3 py-2">
                {[
                  ['Collected', formatInr(breakdown.collected)],
                  ['Stayo fee', '₹0'],
                  ['You received', formatInr(breakdown.collected)],
                ].map(([label_, value], i) => (
                  <div key={label_} className={`flex items-baseline justify-between ${i === 2 ? 'mt-1 border-t border-border/60 pt-1' : 'py-[2px]'}`}>
                    <span className={`text-[11.5px] ${i === 2 ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                      {label_}
                    </span>
                    <span className={`tabular-nums ${i === 2 ? 'font-display text-[13px] font-extrabold text-foreground' : 'text-[12px] font-semibold text-foreground'}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                From {breakdown.tenants.length} tenant{breakdown.tenants.length === 1 ? '' : 's'}
              </div>

              {breakdown.tenants.length === 0 ? (
                <p className="py-2 text-[11.5px] text-muted-foreground">
                  We can't name the tenants behind this payout yet. The amount is unaffected.
                </p>
              ) : (
                breakdown.tenants.map((t, i) => (
                  <button
                    key={`${t.tenantId ?? t.name}-${i}`}
                    type="button"
                    // Payout → person → their charges. The reverse lookup an
                    // owner reaches for the moment a credit appears in his
                    // passbook: "which boys does this cover?"
                    onClick={() => t.tenantId && navigate(`/owner/tenants/${t.tenantId}`)}
                    disabled={!t.tenantId}
                    className="flex w-full items-center gap-2 border-t border-border/60 py-2 text-left first:border-t-0 disabled:cursor-default"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold text-foreground">{t.name}</div>
                      <div className="truncate text-[10.5px] text-muted-foreground">
                        {[t.room && `Room ${t.room}`, t.hostelName].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span className="flex-none font-display text-[12.5px] font-bold tabular-nums text-foreground">
                      {formatInr(t.amount)}
                    </span>
                    <span className="w-[48px] flex-none text-right text-[10.5px] tabular-nums text-muted-foreground">
                      {formatPastDate(t.capturedAt)}
                    </span>
                  </button>
                ))
              )}

              {/* Only for owners who actually have more than one property —
                  a single-hostel owner does not need to be told which. */}
              {breakdown.byHostel.length > 1 && (
                <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                  {breakdown.byHostel
                    .map((h) => `${h.hostelName || 'Unassigned'} ${formatInr(h.amount)}`)
                    .join(' · ')}
                </div>
              )}

              {payout.status === 'PAID' && (
                <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                  {[
                    payout.method ? payout.method.replace(/_/g, ' ').toLowerCase() : null,
                    formatPastDate(payout.paidAt),
                    breakdown.bank?.masked ? `${breakdown.bank.name ?? 'Bank'} ${breakdown.bank.masked}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
