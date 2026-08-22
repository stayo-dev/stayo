import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { MonthBlock } from '../components/payouts/MonthBlock';
import { PayoutRow } from '../components/payouts/PayoutRow';
import { useOwnerPayoutSummary, useOwnerPayouts } from '../hooks/useOwnerPayouts';

/**
 * "Money in" — every payout Stayo has made or owes this owner.
 *
 * A route rather than a sheet, matching `/owner/money/collect`: a searchable
 * history needs the room, and it needs to be linkable from a notification.
 *
 * The word "settlement" appears nowhere an owner can read. Owners do not use
 * it — the same reason Obligations were renamed to Charges.
 */
export function MoneyInPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const { summary, promise, isLoading: summaryLoading } = useOwnerPayoutSummary();
  const { payouts, isLoading } = useOwnerPayouts(search.trim() || undefined);

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/owner/money')}
          className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Back to Money"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Money in</h1>
      </div>

      {/* He reads his bank statement first and the app second, so the search
          has to accept what the statement gives him: a UTR, or an amount. */}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <Search className="h-4 w-4 flex-none text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="UTR, amount, or tenant name"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="flex-none text-[11px] font-semibold text-muted-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {summaryLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      ) : (
        summary && !search && (
          <>
            <MonthBlock month={summary.month} />
            <div className="flex flex-wrap items-center gap-x-2 px-0.5">
              <span className="text-[11.5px] font-semibold text-muted-foreground">
                Stayo passes rent through in full — no commission, ever.
              </span>
              {promise && (
                <span className={`text-[11.5px] font-semibold ${summary.promise.allOnTime ? 'text-success' : 'text-muted-foreground'}`}>
                  {promise}
                </span>
              )}
            </div>
          </>
        )
      )}

      <div className="flex flex-col gap-2">
        <span className="px-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {search ? `Matching · ${payouts.length}` : 'Payouts'}
        </span>

        {isLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        ) : payouts.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-3.5 py-6 text-center">
            {search ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing matches "{search}". Try the amount, or the last few digits of the UTR.
              </p>
            ) : (
              <>
                {/* The state most owners will see first, so it explains rather
                    than apologises. A bare "no data" here would read as
                    something being broken. */}
                <p className="text-[13px] font-semibold text-foreground">No payouts yet</p>
                <p className="mx-auto mt-1 max-w-[280px] text-[11.5px] leading-relaxed text-muted-foreground">
                  When a tenant pays online, the money reaches Stayo first and we pass it to your
                  bank in full. Rent they hand you directly never comes through here — that stays
                  with you.
                </p>
              </>
            )}
          </div>
        ) : (
          payouts.map((payout) => <PayoutRow key={payout.id} payout={payout} />)
        )}
      </div>
    </div>
  );
}
