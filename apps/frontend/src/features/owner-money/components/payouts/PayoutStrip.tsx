import { useNavigate } from 'react-router-dom';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { formatInr, formatPastDate, type StripTone } from '../../payouts/payoutState';
import { useOwnerPayoutSummary } from '../../hooks/useOwnerPayouts';

/**
 * The payout strip at the top of Collections.
 *
 * An EVENT line, not a status line. "3 tenants paid today · ₹18,500" carries
 * the people, the amount and the promise in one sentence; "Pending settlement"
 * carries a process nobody asked about.
 *
 * It also stitches the tab together: a tenant the owner is chasing in the list
 * below moves up into this strip when they pay, so the two halves of the screen
 * are one story rather than two stacked ones.
 *
 * All copy comes from `stripVoice` — the priority rule (failure outranks good
 * news) is tested there, not decided by the order of JSX below.
 */

const TONE: Record<StripTone, { card: string; headline: string; accent: string }> = {
  // Failure gets the only coloured card. Everything else stays calm, so that
  // when this one appears it is unmistakable rather than one alert among many.
  alert: {
    card: 'border-destructive/30 bg-destructive/[0.06]',
    headline: 'text-destructive',
    accent: 'text-destructive',
  },
  incoming: { card: 'border-border bg-card', headline: 'text-foreground', accent: 'text-success' },
  settled: { card: 'border-border bg-card', headline: 'text-foreground', accent: 'text-success' },
  quiet: { card: 'border-border bg-card', headline: 'text-foreground', accent: 'text-muted-foreground' },
};

export function PayoutStrip() {
  const navigate = useNavigate();
  const { summary, voice, promise, isLoading, isError } = useOwnerPayoutSummary();

  if (isLoading) {
    return <div className="h-[104px] animate-pulse rounded-2xl bg-muted" />;
  }

  // A money screen that fails to load must say so. Rendering ₹0 because a
  // request errored is the one failure mode that would be indistinguishable
  // from Stayo having lost the money.
  if (isError || !summary) {
    return (
      <div className="rounded-2xl border border-border bg-card px-3.5 py-3">
        <div className="text-[13px] font-semibold text-foreground">Couldn't load your payouts</div>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          Your money is unaffected — this screen just couldn't reach us. Pull to refresh.
        </p>
      </div>
    );
  }

  const tone = TONE[voice.tone];
  const today = summary.paidToday.tenants;

  return (
    <div className={`rounded-2xl border px-3.5 py-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)] ${tone.card}`}>
      <button
        type="button"
        onClick={() => navigate('/owner/money/payouts')}
        className="flex w-full items-start gap-2 text-left"
      >
        {voice.tone === 'alert' && (
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" strokeWidth={2.5} />
        )}
        <div className="min-w-0 flex-1">
          <div className={`font-display text-[15px] font-extrabold tracking-tight ${tone.headline}`}>
            {voice.headline}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{voice.detail}</div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 flex-none text-muted-foreground" />
      </button>

      {/* Names, not a count. "3 tenants paid" is a statistic; "Kiran S. ₹6,000
          at 11:42 AM" is the receipt he used to get by hand. */}
      {today.length > 0 && (
        <div className="mt-2.5 border-t border-border/60 pt-2">
          {today.slice(0, 3).map((t, i) => (
            <div key={`${t.tenantId ?? t.name}-${i}`} className="flex items-center gap-2 py-[3px]">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{t.name}</span>
              <span className="flex-none font-display text-[12px] font-bold tabular-nums text-success">
                {formatInr(t.amount)}
              </span>
              <span className="w-[62px] flex-none text-right text-[10.5px] tabular-nums text-muted-foreground">
                {new Date(t.at).toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })}
              </span>
            </div>
          ))}
          {today.length > 3 && (
            <button
              type="button"
              onClick={() => navigate('/owner/money/payouts')}
              className="mt-1 text-[11px] font-semibold text-primary"
            >
              +{today.length - 3} more today
            </button>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-2">
        {/* Stated even though it is zero, and especially because it is zero.
            An unstated ₹0 reads as a fee somebody chose not to mention. */}
        <span className="text-[11px] font-semibold text-muted-foreground">Stayo takes ₹0</span>
        {promise && (
          <>
            <span className="text-[11px] text-border">·</span>
            <span className={`text-[11px] font-semibold ${summary.promise.allOnTime ? 'text-success' : 'text-muted-foreground'}`}>
              {promise}
            </span>
          </>
        )}
        {voice.action ? (
          <button
            type="button"
            onClick={() => navigate(voice.action!.to)}
            className="ml-auto rounded-lg bg-destructive px-3 py-1.5 font-display text-[11.5px] font-bold text-white"
          >
            {voice.action.label}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/owner/money/payouts')}
            className="ml-auto text-[11.5px] font-bold text-primary"
          >
            See all money in ›
          </button>
        )}
      </div>

      {summary.lastPaid && voice.tone === 'incoming' && (
        <div className="mt-1.5 text-[10.5px] text-muted-foreground">
          Last payout {formatInr(summary.lastPaid.total)} on {formatPastDate(summary.lastPaid.paidAt)}
        </div>
      )}
    </div>
  );
}
