import { Card } from '@/app/components/ui/card';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { TONE_CLASSES, type FinancialTone } from '@features/tenants/utils/financialColors';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

export type FinancialSectionId =
  | 'fin-summary'
  | 'fin-actions'
  | 'fin-obligations'
  | 'fin-activity'
  | 'fin-ledger'
  | 'fin-documents';

interface CompactFinancialStripProps {
  outstandingAmount: number;
  overdueDays: number;
  futureCredit: number;
  depositPaid: number;
  overdueAmount: number;
  nextRentDate?: string | null;
  nextRentAmount?: number | null;
  agreementMonthsElapsed?: number | null;
  agreementMonthsTotal?: number | null;
  onNavigate?: (section: FinancialSectionId) => void;
}

interface MetricCard {
  label: string;
  value: string;
  subtext: string;
  tone: FinancialTone | null;
  target: FinancialSectionId;
  wide?: boolean;
}

export function CompactFinancialStrip({
  outstandingAmount,
  overdueDays,
  futureCredit,
  depositPaid,
  overdueAmount,
  nextRentDate,
  nextRentAmount,
  agreementMonthsElapsed,
  agreementMonthsTotal,
  onNavigate,
}: CompactFinancialStripProps) {
  const metrics: MetricCard[] = [
    {
      label: 'Outstanding',
      value: fmt(outstandingAmount),
      subtext: overdueDays > 0 ? `${fmt(overdueAmount)} overdue` : 'No immediate dues',
      tone: outstandingAmount > 0 ? (overdueDays > 0 ? 'red' : 'amber') : null,
      target: 'fin-obligations',
      wide: true,
    },
    {
      label: 'Overdue',
      value: overdueDays > 0 ? `${overdueDays} day${overdueDays === 1 ? '' : 's'}` : '0 days',
      subtext: overdueDays > 0 ? 'Since oldest due date' : 'Paid on time',
      tone: overdueDays > 0 ? 'red' : null,
      target: 'fin-obligations',
    },
    {
      label: 'Future Credit',
      value: fmt(futureCredit),
      subtext: 'Advance rent paid',
      tone: futureCredit > 0 ? 'blue' : null,
      target: 'fin-ledger',
    },
    {
      label: 'Security Deposit',
      value: fmt(depositPaid),
      subtext: 'Refundable security',
      tone: null,
      target: 'fin-ledger',
    },
    {
      label: 'Next Rent',
      value: nextRentDate
        ? new Date(nextRentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
        : '—',
      subtext: nextRentAmount ? fmt(nextRentAmount) : 'Not scheduled',
      tone: 'orange',
      target: 'fin-obligations',
    },
    {
      label: 'Agreement',
      value:
        agreementMonthsElapsed != null && agreementMonthsTotal
          ? `${agreementMonthsElapsed} / ${agreementMonthsTotal} mo`
          : '—',
      subtext:
        agreementMonthsElapsed != null && agreementMonthsTotal
          ? `${Math.round((agreementMonthsElapsed / agreementMonthsTotal) * 100)}% complete`
          : 'No active agreement',
      tone: null,
      target: 'fin-documents',
    },
  ];

  const isMobile = useIsMobile();

  return (
    <div
      id="fin-summary"
      className={
        isMobile
          ? 'flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-1 scroll-mt-20'
          : 'grid grid-cols-2 md:grid-cols-6 gap-3 scroll-mt-20'
      }
    >
      {metrics.map((metric) => (
        <Card
          key={metric.label}
          onClick={() => onNavigate?.(metric.target)}
          className={`p-3.5 flex flex-col justify-between gap-2 rounded-2xl border transition-all hover:shadow-md cursor-pointer active:scale-[0.98] ${
            metric.tone ? TONE_CLASSES[metric.tone] : 'border-border bg-card'
          } ${isMobile ? 'snap-start shrink-0 w-[42vw]' : metric.wide ? 'col-span-2 md:col-span-1' : ''}`}
        >
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              {metric.label}
            </span>
            <span className="text-lg font-extrabold tracking-tight block text-foreground">
              {metric.value}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground block font-medium">{metric.subtext}</span>
        </Card>
      ))}
    </div>
  );
}
