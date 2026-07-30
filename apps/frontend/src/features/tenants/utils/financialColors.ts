import {
  CalendarPlus,
  ReceiptText,
  Banknote,
  SplitSquareHorizontal,
  CreditCard,
  ShieldCheck,
  HandCoins,
  Ban,
  SlidersHorizontal,
  FileCheck2,
  Wallet,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';

/**
 * Semantic financial colors, shared across Summary, Health Banner, Financial
 * Activity, Obligations, and Ledger — see plan §6.
 *   green = received/good · blue = credit · orange = upcoming/pending
 *   red = overdue/rejected · gray = historical/closed
 */
export type FinancialTone = 'green' | 'blue' | 'orange' | 'red' | 'gray' | 'amber';

export const TONE_CLASSES: Record<FinancialTone, string> = {
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
  red: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  gray: 'bg-secondary text-muted-foreground border-border',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
};

export const TONE_DOT_CLASSES: Record<FinancialTone, string> = {
  green: 'bg-emerald-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  red: 'bg-rose-500',
  gray: 'bg-muted-foreground/50',
  amber: 'bg-amber-500',
};

export const TONE_ICON_CLASSES: Record<FinancialTone, string> = {
  green: 'text-emerald-600 dark:text-emerald-400',
  blue: 'text-blue-600 dark:text-blue-400',
  orange: 'text-orange-600 dark:text-orange-400',
  red: 'text-rose-600 dark:text-rose-400',
  gray: 'text-muted-foreground',
  amber: 'text-amber-600 dark:text-amber-400',
};

export type TimelineEventType =
  | 'OBLIGATION_CREATED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_GROUP_SETTLED'
  | 'OBLIGATION_WAIVED'
  | 'OBLIGATION_CANCELLED'
  | 'LEDGER_CREDIT'
  | 'LEDGER_DEBIT'
  | 'STATUS_CHANGE'
  | 'CHANGE_REQUEST';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: TimelineEventType;
  summary: string;
  amount: number | null;
  source: { table: string; id: string };
  references: {
    obligation_id?: string;
    payment_id?: string;
    payment_group_id?: string;
    ledger_entry_id?: string;
  };
  actor_id: string | null;
  metadata: Record<string, any>;
}

interface EventDisplay {
  label: string;
  icon: LucideIcon;
  tone: FinancialTone;
}

/**
 * Maps a raw TimelineEvent to its display label/icon/tone per plan §4's
 * TimelineEvent → UI mapping table. Grouped "Financial Activity" entries
 * (see groupFinancialActivity.ts) reuse this for their primary event.
 */
export function getEventDisplay(event: Pick<TimelineEvent, 'type' | 'metadata'>): EventDisplay {
  const reason = event.metadata?.reason as string | undefined;
  const obligationType = event.metadata?.obligation_type as string | undefined;

  switch (event.type) {
    case 'OBLIGATION_CREATED':
      if (obligationType === 'RENT') {
        return { label: 'Rent Generated', icon: CalendarPlus, tone: 'orange' };
      }
      return { label: 'Charge Created', icon: ReceiptText, tone: 'orange' };
    case 'PAYMENT_RECORDED':
      // A reversal is a negative-amount payment row (see financial-timeline-service.ts);
      // it must read as its own event, not as an incoming payment.
      if (event.metadata?.is_reversal) {
        return { label: 'Payment Reversed', icon: RotateCcw, tone: 'red' };
      }
      return { label: 'Payment Received', icon: Banknote, tone: 'green' };
    case 'PAYMENT_GROUP_SETTLED':
      return { label: 'Payment Received & Settled', icon: SplitSquareHorizontal, tone: 'green' };
    case 'OBLIGATION_WAIVED':
      return { label: 'Waiver', icon: HandCoins, tone: 'gray' };
    case 'OBLIGATION_CANCELLED':
      return { label: 'Cancellation', icon: Ban, tone: 'gray' };
    case 'LEDGER_CREDIT':
      // Real FinancialLedgerReason enum (backend-next/prisma/schema.prisma) — NOT the
      // simplified DEPOSIT/TOPUP set the manual ledger POST route validates against.
      if (reason === 'SECURITY_DEPOSIT_COLLECTED' || reason === 'SECURITY_DEPOSIT_TOPUP') {
        return { label: 'Security Deposit Collected', icon: ShieldCheck, tone: 'blue' };
      }
      if (reason === 'FUTURE_RENT_CREDIT_TOPUP') {
        // Excess payment credited as future rent — credit being *created*, not spent.
        return { label: 'Future Credit Created', icon: Wallet, tone: 'blue' };
      }
      if (reason === 'FUTURE_RENT_CREDIT_ADJUSTMENT') {
        return { label: 'Future Credit Adjusted', icon: SlidersHorizontal, tone: 'gray' };
      }
      return { label: 'Manual Adjustment', icon: SlidersHorizontal, tone: 'gray' };
    case 'LEDGER_DEBIT':
      if (reason === 'FUTURE_CREDIT_APPLIED') {
        // Existing future-credit balance drawn down against new dues during settlement —
        // this is the actual "Future Credit Applied" event from the spec.
        return { label: 'Future Credit Applied', icon: CreditCard, tone: 'blue' };
      }
      if (reason === 'SECURITY_DEPOSIT_REFUNDED') {
        return { label: 'Security Deposit Refunded', icon: ShieldCheck, tone: 'gray' };
      }
      if (reason === 'SECURITY_DEPOSIT_DEDUCTION') {
        return { label: 'Security Deposit Deducted', icon: ShieldCheck, tone: 'gray' };
      }
      if (reason === 'OBLIGATION_WAIVER') {
        return { label: 'Waiver', icon: HandCoins, tone: 'gray' };
      }
      if (reason === 'OBLIGATION_CANCELLATION') {
        return { label: 'Cancellation', icon: Ban, tone: 'gray' };
      }
      return { label: 'Manual Adjustment', icon: SlidersHorizontal, tone: 'gray' };
    case 'CHANGE_REQUEST': {
      const status = event.metadata?.status as string | undefined;
      const tone: FinancialTone = status === 'APPLIED' ? 'green' : status === 'REJECTED' ? 'red' : 'orange';
      const label =
        status === 'APPLIED' ? 'Change Request Approved' : status === 'REJECTED' ? 'Change Request Rejected' : 'Agreement Change Requested';
      return { label, icon: FileCheck2, tone };
    }
    default:
      return { label: 'Activity', icon: ReceiptText, tone: 'gray' };
  }
}

export function obligationStatusTone(status?: string): FinancialTone {
  switch (String(status ?? '').toUpperCase()) {
    case 'OVERDUE':
      return 'red';
    case 'PARTIAL':
      return 'amber';
    case 'PAID':
      return 'green';
    case 'WAIVED':
    case 'CANCELLED':
      return 'gray';
    case 'UPCOMING':
    case 'PENDING':
    case 'DRAFT':
      return 'orange';
    default:
      return 'gray';
  }
}

export type FinancialHealthStatus = 'GOOD_STANDING' | 'PARTIAL_PENDING' | 'OVERDUE';

export const HEALTH_STATUS_DISPLAY: Record<FinancialHealthStatus, { label: string; tone: FinancialTone }> = {
  GOOD_STANDING: { label: 'Good Standing', tone: 'green' },
  PARTIAL_PENDING: { label: 'Partial Payments Pending', tone: 'amber' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
};
