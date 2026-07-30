import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { Card } from '@/app/components/ui/card';
import {
  HEALTH_STATUS_DISPLAY,
  TONE_CLASSES,
  TONE_ICON_CLASSES,
  type FinancialHealthStatus,
} from '@features/tenants/utils/financialColors';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

const STATUS_ICON: Record<FinancialHealthStatus, typeof AlertTriangle> = {
  OVERDUE: AlertTriangle,
  PARTIAL_PENDING: Clock3,
  GOOD_STANDING: CheckCircle2,
};

interface FinancialHealthBannerProps {
  overdueAmount: number;
  overdueDays: number;
  pendingAmount: number;
  futureCredit: number;
  nextRentLabel?: string | null;
  onCollect?: (prefillAmount: number) => void;
}

export function FinancialHealthBanner({
  overdueAmount,
  overdueDays,
  pendingAmount,
  futureCredit,
  nextRentLabel,
  onCollect,
}: FinancialHealthBannerProps) {
  const status: FinancialHealthStatus =
    overdueAmount > 0 ? 'OVERDUE' : pendingAmount > 0 ? 'PARTIAL_PENDING' : 'GOOD_STANDING';
  const { label, tone } = HEALTH_STATUS_DISPLAY[status];
  const Icon = STATUS_ICON[status];

  let description: string;
  let cta: { text: string; amount: number } | null = null;

  if (status === 'OVERDUE') {
    description = `${fmt(overdueAmount)} outstanding, ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue.`;
    cta = { text: 'Collect Now', amount: overdueAmount };
  } else if (status === 'PARTIAL_PENDING') {
    description = `${fmt(pendingAmount)} pending — not yet overdue.`;
    cta = { text: 'Collect Now', amount: pendingAmount };
  } else if (futureCredit > 0 && nextRentLabel) {
    description = `${fmt(futureCredit)} future credit available for ${nextRentLabel}. No action needed.`;
  } else {
    description = 'No action needed — tenant is fully settled.';
  }

  return (
    <Card className={`p-4 rounded-2xl border flex items-center justify-between gap-4 flex-wrap ${TONE_CLASSES[tone]}`}>
      <div className="flex items-start gap-3 min-w-0">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${TONE_ICON_CLASSES[tone]}`} />
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {cta && (
        <button
          type="button"
          onClick={() => onCollect?.(cta!.amount)}
          className="shrink-0 rounded-xl bg-accent text-accent-foreground text-xs font-bold px-4 py-2 hover:bg-accent/90 active:scale-95 transition-transform"
        >
          {cta.text} →
        </button>
      )}
    </Card>
  );
}
