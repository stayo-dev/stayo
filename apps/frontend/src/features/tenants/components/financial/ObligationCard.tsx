import { Download, Share2, Info, History, CircleDollarSign, ChevronDown, ChevronUp, Ban, XCircle, Pencil, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { paymentService } from '@features/payments/api';
import { hmsToast } from '@lib/toast';
import { sharePaymentLink } from '@lib/share';
import { TONE_CLASSES, obligationStatusTone } from '@features/tenants/utils/financialColors';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const fmtMonth = (value?: string) => {
  if (!value) return 'Unknown';
  if (!Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  return value;
};

export interface Obligation {
  id?: string;
  obligation_id?: string;
  rent_month?: string;
  billing_period_start?: string;
  billing_period_end?: string;
  installment_label?: string;
  type?: string;
  obligation_type?: string;
  amount?: number;
  late_fee?: number;
  total_payable?: number;
  paid_amount?: number;
  paid?: number;
  outstanding?: number;
  status?: string;
  due_date?: string;
  description?: string;
  payments?: { id: string; amount_paid: number; payment_date: string; method: string; transaction_id: string }[];
}

interface ObligationCardProps {
  obligation: Obligation;
  tenantPhone?: string;
  isExpanded: boolean;
  onToggle: () => void;
  onRecordPayment?: (obligationId: string) => void;
  onWaiveObligation?: (obligation: Obligation) => void;
  onCancelObligation?: (obligation: Obligation) => void;
  onEditObligation?: (obligation: Obligation) => void;
  onDuplicateObligation?: (obligation: Obligation) => void;
  onViewHistory?: (obligation: Obligation) => void;
  onDownloadReceipt?: (paymentId: string) => void;
}

const ACTIONABLE_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE'];

export function ObligationCard({
  obligation: o,
  tenantPhone,
  isExpanded,
  onToggle,
  onRecordPayment,
  onWaiveObligation,
  onCancelObligation,
  onEditObligation,
  onDuplicateObligation,
  onViewHistory,
  onDownloadReceipt,
}: ObligationCardProps) {
  const status = String(o.status ?? 'PENDING').toUpperCase();
  const id = (o.id ?? o.obligation_id ?? '') as string;
  const isActionable = ACTIONABLE_STATUSES.includes(status);
  const isEditable = status === 'PENDING' || status === 'UPCOMING';
  // Cancel (void, no ledger trace) and Waive (write-off, ledger-corrected) are mutually
  // exclusive by the same "has money moved?" test the backend enforces — never show both.
  // Not every surface that renders this card fetches the full `payments[]` array (e.g. the
  // owner Tenant Profile's Charges tab sources from getTenantDues()'s TenantDueItem, which
  // only carries an aggregate `paid` amount) — fall back to that so `hasPayments` doesn't
  // silently read false (and wrongly offer Cancel on a PARTIAL/already-paid obligation)
  // just because this particular list didn't include the raw payments array.
  const hasPayments = Boolean(o.payments && o.payments.length > 0) || Number(o.paid_amount ?? o.paid ?? 0) > 0;
  // UPCOMING charges can't have payments yet (they haven't activated), but the
  // frontend's own isActionable list excludes UPCOMING — without this, an
  // owner had no way to remove a charge created by mistake before it's due.
  // The backend guard (cancelObligationInTx) already allows UPCOMING.
  const canCancel = (isActionable || status === 'UPCOMING') && !hasPayments;
  const canWaive = isActionable && hasPayments;

  const billedAmount = Number(o.total_payable ?? o.amount ?? 0);
  const rawPaidAmount = Number(o.paid_amount ?? o.paid ?? 0);
  const paidAmount = status === 'PAID' && rawPaidAmount <= 0 ? billedAmount : rawPaidAmount;
  const displayAmount = Number(o.outstanding ?? o.amount ?? 0);
  const tone = obligationStatusTone(status);

  const handleSharePaymentLink = async () => {
    try {
      const res = await paymentService.generatePayLink({ obligationId: id });
      const paymentLink = res.url;
      const amount = Number(o.outstanding ?? o.amount ?? 0);
      const monthLabel = fmtMonth(o.billing_period_start ?? o.rent_month);
      const message = `Hi, your rent of ${fmt(amount)} for ${monthLabel} is due. Please make payment via this link: ${paymentLink}`;
      const copied = await sharePaymentLink(message, paymentLink, tenantPhone);
      toast.success(copied ? 'Link copied — opening WhatsApp' : 'Opening WhatsApp');
    } catch (e: any) {
      hmsToast.error(e, 'Generate payment link');
    }
  };

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 ${
        status === 'CANCELLED'
          ? 'border-border/50 bg-muted/30 opacity-60'
          : isExpanded
            ? 'border-accent bg-accent/5 dark:bg-accent/10 shadow-sm'
            : 'border-border bg-card hover:bg-muted/10'
      }`}
    >
      {/* Primary Row */}
      <div onClick={onToggle} className="flex items-center justify-between gap-3 p-3.5 cursor-pointer">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <span>{fmt(displayAmount)}</span>
            {Number(o.late_fee ?? 0) > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-500 font-semibold">
                +{fmt(Number(o.late_fee))} late fee
              </span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Due: {o.due_date ? new Date(o.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'} · Type:{' '}
            {(o.obligation_type || o.type) ? String(o.obligation_type || o.type).replaceAll('_', ' ') : 'Rent'}
            {o.description && <span className="ml-1">· {o.description}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${TONE_CLASSES[tone]}`}>{status}</span>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded Actions & History */}
      {isExpanded && (
        <div className="px-3.5 pb-3.5 pt-1.5 border-t border-border/60 space-y-3.5 animate-in slide-in-from-top-1 duration-150">
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {onRecordPayment && isActionable && (
              <button
                type="button"
                onClick={() => onRecordPayment(id)}
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-accent text-accent-foreground text-xs font-semibold hover:bg-accent/90 active:scale-95 transition-transform flex items-center justify-center gap-1"
              >
                <CircleDollarSign className="w-3.5 h-3.5" />
                <span>Collect</span>
              </button>
            )}
            {isActionable && (
              <button
                type="button"
                onClick={handleSharePaymentLink}
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-950/30 active:scale-95 transition-transform flex items-center justify-center gap-1"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share Link</span>
              </button>
            )}
            {onEditObligation && isEditable && (
              <button
                type="button"
                onClick={() => onEditObligation(o)}
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 active:scale-95 transition-transform flex items-center justify-center gap-1 border border-border"
              >
                <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Edit</span>
              </button>
            )}
            {onDuplicateObligation && (
              <button
                type="button"
                onClick={() => onDuplicateObligation(o)}
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 active:scale-95 transition-transform flex items-center justify-center gap-1 border border-border"
              >
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Duplicate</span>
              </button>
            )}
            {onWaiveObligation && canWaive && (
              <button
                type="button"
                onClick={() => onWaiveObligation(o)}
                title="Write off the remaining balance. A payment has already been made, so this records a ledger correction."
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-950/30 active:scale-95 transition-transform flex items-center justify-center gap-1"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Waive Balance</span>
              </button>
            )}
            {onCancelObligation && canCancel && (
              <button
                type="button"
                onClick={() => onCancelObligation(o)}
                title="Void this charge. No payment has been made against it, so nothing needs correcting."
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-950/30 active:scale-95 transition-transform flex items-center justify-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancel Charge</span>
              </button>
            )}
            {onViewHistory && (
              <button
                type="button"
                onClick={() => onViewHistory(o)}
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 active:scale-95 transition-transform flex items-center justify-center gap-1 border border-border"
              >
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <span>History</span>
              </button>
            )}
            {status === 'PAID' && o.payments && o.payments.length > 0 && onDownloadReceipt && (
              <button
                type="button"
                onClick={() => {
                  const pId = o.payments?.[0]?.id;
                  if (pId) onDownloadReceipt(pId);
                }}
                className="flex-1 min-w-[110px] py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 active:scale-95 transition-transform flex items-center justify-center gap-1 border border-border"
              >
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Receipt</span>
              </button>
            )}
          </div>

          {/* Detailed Breakdown */}
          <div className="bg-secondary/50 rounded-xl p-3 border border-border/40 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider pb-1 border-b border-border/40">
              <Info className="w-3.5 h-3.5" />
              <span>Detailed Breakdown</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Original Amount:</span>
              <span className="font-semibold text-foreground">{fmt(billedAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Late Fees Charged:</span>
              <span className="font-semibold text-foreground">{fmt(Number(o.late_fee ?? 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount Already Paid:</span>
              <span className="font-semibold text-emerald-600">{fmt(paidAmount)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border/40 font-bold">
              <span className="text-foreground">Remaining Outstanding:</span>
              <span className="text-rose-600">{fmt(displayAmount)}</span>
            </div>
          </div>

          {/* Payment attempts / reminders logs */}
          {o.payments && o.payments.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                <History className="w-3.5 h-3.5" />
                <span>Transaction History</span>
              </div>
              <div className="space-y-1 max-h-[100px] overflow-y-auto">
                {o.payments.map((p, pIdx) => (
                  <div key={p.id || pIdx} className="flex justify-between items-center text-[11px] text-muted-foreground py-1 border-b border-border/20 last:border-0">
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">
                        {fmt(p.amount_paid)} paid via {p.method}
                      </span>
                      {p.transaction_id && <span className="text-[10px] text-muted-foreground">Ref: {p.transaction_id}</span>}
                    </div>
                    <span className="text-[10px]">
                      {new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
