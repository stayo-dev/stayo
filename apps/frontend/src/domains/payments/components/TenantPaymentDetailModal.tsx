import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Calendar, CreditCard, Download, CheckCircle2, Receipt, Hash, Info } from 'lucide-react';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtMonth = (cycle?: string) => {
  if (!cycle) return '';
  const d = new Date(cycle);
  if (Number.isNaN(d.getTime())) return cycle;
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

interface PaymentDetail {
  id: string;
  label: string;
  amount: number;
  date: string;
  method: string;
  isReversal?: boolean;
  receipt_payment_id?: string | null;
  reference_number?: string;
  rent_month?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  payment: PaymentDetail | null;
  onDownloadReceipt?: (paymentId: string) => void;
}

export function TenantPaymentDetailModal({
  open,
  onClose,
  payment,
  onDownloadReceipt,
}: Props) {
  if (!payment) return null;

  const hasReceipt = !!payment.receipt_payment_id;
  const isReversal = Boolean(payment.isReversal);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0 rounded-2xl border border-border shadow-2xl">
        <DialogHeader className="p-5 border-b border-border bg-muted/20">
          <DialogTitle className="text-base font-bold text-foreground">Payment Details</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Transaction record reference and receipt info
          </p>
        </DialogHeader>

        <div className="p-6 space-y-5">
          {/* Status & Amount Hero */}
          <div className={`text-center rounded-2xl p-5 border ${isReversal ? 'bg-rose-500/5 dark:bg-rose-500/10 border-rose-500/20' : 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20'}`}>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-2 ${isReversal ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isReversal ? 'PAYMENT REVERSED' : 'PAID SUCCESS'}
            </div>
            <div className="text-3xl font-extrabold text-foreground tracking-tight">
              {isReversal ? '−' : ''}{fmt(payment.amount)}
            </div>
            {payment.rent_month && (
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mt-1.5">
                For {fmtMonth(payment.rent_month)} rent cycle
              </div>
            )}
          </div>

          {/* Breakdown Section */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Transaction Details
            </h4>
            <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden">
              <div className="flex items-center justify-between p-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Info className="w-4 h-4 text-muted-foreground/80" />
                  Purpose
                </span>
                <span className="font-semibold text-foreground">{payment.label}</span>
              </div>

              <div className="flex items-center justify-between p-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground/80" />
                  Payment Date
                </span>
                <span className="font-semibold text-foreground">{fmtDate(payment.date)}</span>
              </div>

              <div className="flex items-center justify-between p-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground/80" />
                  Payment Method
                </span>
                <span className="font-semibold text-foreground">{payment.method || 'Payment'}</span>
              </div>

              {payment.reference_number && (
                <div className="flex items-center justify-between p-3.5 text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground/80" />
                    Reference ID
                  </span>
                  <span className="font-mono text-xs text-foreground bg-muted px-2 py-0.5 rounded truncate max-w-[180px]" title={payment.reference_number}>
                    {payment.reference_number}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Download Receipt Call To Action */}
          {hasReceipt ? (
            <button
              type="button"
              onClick={() => onDownloadReceipt?.(payment.receipt_payment_id!)}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-accent text-accent-foreground font-bold hover:bg-accent/90 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download Official Receipt
            </button>
          ) : (
            <div className="rounded-xl bg-muted/40 p-3.5 flex gap-2.5 items-start border border-border">
              <Receipt className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-normal">
                This transaction was processed directly via rent credits or offline journal logs. Please contact management if you require a signed printed copy.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
