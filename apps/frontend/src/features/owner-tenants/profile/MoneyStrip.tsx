import type { RealTenantDetail } from '../hooks/useTenantDetail';
import { toOverdueDisplay } from './overdueDisplay';

/**
 * The money tiles.
 *
 * Two changes from what this used to show. The OVERDUE tile now reports real
 * days since the oldest unpaid obligation fell due instead of
 * `overdue_amount > 0 ? 1 : 0` rendered under the word "days". And FUTURE
 * CREDIT appears at all — `advance_balance` is computed by
 * FinancialReadModelService, arrives on every response, and was being dropped,
 * so rent paid ahead was invisible to the owner collecting it.
 */

const money = (value: number) => `₹${Number(value ?? 0).toLocaleString('en-IN')}`;

const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

function Tile({
  label,
  value,
  caption,
  captionTone,
  emphasis,
}: {
  label: string;
  value: string;
  caption: string;
  captionTone?: keyof typeof TONE_TEXT;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`min-w-[150px] flex-none rounded-2xl p-3.5 ${
        emphasis
          ? 'border border-primary/20 bg-secondary/40'
          : 'border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]'
      }`}
    >
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 font-display text-xl font-extrabold tabular-nums ${
          emphasis ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </div>
      <div className={`mt-0.5 text-[11px] ${captionTone ? TONE_TEXT[captionTone] : 'text-muted-foreground'}`}>
        {caption}
      </div>
    </div>
  );
}

export function MoneyStrip({ tenant }: { tenant: RealTenantDetail }) {
  const overdue = toOverdueDisplay({
    overdueAmount: tenant.overdueAmount,
    outstanding: tenant.outstanding,
    obligations: tenant.obligationDueDates,
    today: new Date(),
  });

  return (
    <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
      <Tile
        label="Outstanding"
        value={money(tenant.outstanding)}
        caption={tenant.outstanding > 0 ? 'Due now' : 'No immediate dues'}
        emphasis
      />
      <Tile
        label="Overdue"
        // No number when days can't be known — better a bare label than a
        // fabricated duration, which is the bug this replaces.
        value={overdue.days === null ? '—' : `${overdue.days} ${overdue.unit}`}
        caption={overdue.label}
        captionTone={overdue.tone}
      />
      <Tile label="Deposit" value={money(tenant.stay.deposit)} caption="Held on file" />
      {tenant.futureCredit > 0 && (
        <Tile
          label="Future credit"
          value={money(tenant.futureCredit)}
          caption="Rent paid ahead"
          captionTone="success"
        />
      )}
    </div>
  );
}
