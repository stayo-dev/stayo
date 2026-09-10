import { StatusPill } from '@shared/ui-patterns/StatusPill';
import type { PaymentSchedule, PaymentScheduleItem } from './paymentSchedule';

/**
 * The owner tenant profile's payment schedule — Overdue / Upcoming / Paid,
 * each row carrying billing period, due date, actual paid date, method and
 * status. Fed from the same `billingTimelineService` read model the tenant
 * portal uses, so the two never disagree.
 */

const money = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATE_TONE: Record<string, 'destructive' | 'warning' | 'success' | 'neutral'> = {
  overdue: 'destructive',
  partial: 'warning',
  due_soon: 'warning',
  pending: 'warning',
  upcoming: 'neutral',
  paid: 'success',
  waived: 'neutral',
};

const STATE_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  partial: 'Part paid',
  due_soon: 'Due soon',
  pending: 'Pending',
  upcoming: 'Upcoming',
  paid: 'Paid',
  waived: 'Waived',
};

function Row({ item }: { item: PaymentScheduleItem }) {
  const isPaid = item.state === 'paid' || item.state === 'partial' || item.state === 'waived';
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] border border-border bg-muted/50 p-3">
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] font-extrabold tabular-nums text-foreground">
          {money(item.amount)}
          {item.state === 'partial' && item.outstanding > 0 && (
            <span className="ml-1.5 text-[11px] font-semibold text-warning">
              {money(item.outstanding)} left
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {item.type !== 'RENT' ? `${item.type.replace(/_/g, ' ')} · ` : ''}
          {item.billingPeriodLabel ? `Period: ${item.billingPeriodLabel} · ` : ''}
          Due: {fmtDate(item.dueDate)}
          {isPaid && item.paidDate ? ` · Paid: ${fmtDate(item.paidDate)}` : ''}
          {isPaid && item.method ? ` · via ${item.method.replace(/_/g, ' ')}` : ''}
          {isPaid && item.referenceNumber ? ` · Ref: ${item.referenceNumber}` : ''}
        </div>
      </div>
      <StatusPill tone={STATE_TONE[item.state] ?? 'neutral'}>
        {STATE_LABEL[item.state] ?? item.state}
      </StatusPill>
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: PaymentScheduleItem[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className={`text-[10.5px] font-bold uppercase tracking-wide ${tone}`}>
        {title} · {items.length}
      </div>
      {items.map((item) => (
        <Row key={item.id} item={item} />
      ))}
    </div>
  );
}

interface PaymentScheduleListProps {
  schedule: PaymentSchedule;
  onAddCharge: () => void;
}

export function PaymentScheduleList({ schedule, onAddCharge }: PaymentScheduleListProps) {
  const empty = schedule.overdue.length === 0 && schedule.upcoming.length === 0 && schedule.paid.length === 0;

  return (
    <div className="rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="flex-1 font-display text-[15px] font-bold text-foreground">Payments</span>
        <button
          type="button"
          onClick={onAddCharge}
          className="rounded-lg bg-secondary px-3 py-1.5 font-display text-[11.5px] font-bold text-primary"
        >
          + Add Charge
        </button>
      </div>

      {empty ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">
          No rent charges yet — the monthly schedule appears once the first obligation is generated.
        </p>
      ) : (
        <div className="flex flex-col gap-4 pt-2">
          <Section title="Overdue" items={schedule.overdue} tone="text-destructive" />
          <Section title="Upcoming" items={schedule.upcoming} tone="text-muted-foreground" />
          <Section title="Paid" items={schedule.paid} tone="text-success" />
        </div>
      )}
    </div>
  );
}
