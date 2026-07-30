import { ChevronDown, ChevronUp, Receipt, FileCheck2, Undo2 } from 'lucide-react';
import { getEventDisplay, TONE_CLASSES, TONE_DOT_CLASSES, TONE_ICON_CLASSES } from '@features/tenants/utils/financialColors';
import type { FinancialActivityEntry } from '@features/tenants/utils/groupFinancialActivity';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

interface FinancialActivityCardProps {
  entry: FinancialActivityEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onDownloadReceipt?: (paymentId: string) => void;
  onViewObligation?: (obligationId: string) => void;
  onCorrectPayment?: (paymentId: string) => void;
  balanceAfter?: number | null;
}

export function FinancialActivityCard({
  entry,
  isExpanded,
  onToggle,
  onDownloadReceipt,
  onViewObligation,
  onCorrectPayment,
  balanceAfter,
}: FinancialActivityCardProps) {
  const { primary, payments, credits, receiptPaymentId } = entry;
  const { label, icon: Icon, tone } = getEventDisplay(primary);
  const isReversal = !!primary.metadata?.is_reversal;
  const amount = primary.amount != null ? Math.abs(primary.amount) : null;
  const isGrouped = payments.length > 0 || credits.length > 0;
  const obligationId = primary.references.obligation_id;
  // A PAYMENT_GROUP_SETTLED card can fold >1 distinct `payments` rows (one
  // FIFO settlement split across obligations) into a single card, but
  // `receiptPaymentId` only ever points at one of them (payments[0] —
  // see groupFinancialActivity.ts). Reversing that single payment id would
  // only undo a fraction of the amount shown on the card, so "Correct
  // Payment" must stay hidden whenever more than one payment is folded in.
  // "View Receipt" is unaffected — a receipt for any one payment id in the
  // group is still a valid receipt to view.
  const canCorrectPayment = payments.length <= 1;

  const allocations = (primary.metadata?.settlement_breakdown?.allocations ?? []) as {
    obligation_id: string;
    label: string;
    allocated: number;
    result: string;
  }[];

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 ${
        isExpanded ? 'border-accent bg-accent/5 dark:bg-accent/10 shadow-sm' : 'border-border bg-card hover:bg-muted/10'
      }`}
    >
      <div onClick={onToggle} className="flex items-center gap-3 p-3.5 cursor-pointer">
        <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT_CLASSES[tone]}`} />
        <div className={`p-1.5 rounded-lg shrink-0 ${TONE_CLASSES[tone]}`}>
          <Icon className={`w-3.5 h-3.5 ${TONE_ICON_CLASSES[tone]}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground truncate">{label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {new Date(primary.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            {', '}
            {new Date(primary.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {amount != null && (
            <span className={`text-sm font-extrabold ${isReversal ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
              {isReversal ? `-${fmt(amount)}` : fmt(amount)}
            </span>
          )}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {isExpanded && (
        <div className="px-3.5 pb-3.5 pt-1.5 border-t border-border/60 space-y-3 text-xs animate-in slide-in-from-top-1 duration-150">
          <p className="text-muted-foreground">{primary.summary}</p>

          {balanceAfter != null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Balance after this entry</span>
              <span className="font-semibold text-foreground">{fmt(balanceAfter)}</span>
            </div>
          )}

          {isGrouped && payments.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Payments in this transaction</p>
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{p.summary}</span>
                </div>
              ))}
            </div>
          )}

          {allocations.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Affected charges</p>
              {allocations.map((a) => (
                <button
                  key={a.obligation_id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewObligation?.(a.obligation_id);
                  }}
                  className="flex w-full justify-between text-[11px] text-left hover:text-accent transition-colors"
                >
                  <span className="text-muted-foreground">{a.label}</span>
                  <span className="font-semibold text-foreground">
                    {fmt(a.allocated)} → {a.result}
                  </span>
                </button>
              ))}
            </div>
          )}

          {isGrouped && credits.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Future credit</p>
              {credits.map((c) => (
                <div key={c.id} className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{c.summary}</span>
                </div>
              ))}
            </div>
          )}

          {obligationId && !isGrouped && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewObligation?.(obligationId);
              }}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              View Charge
            </button>
          )}

          <p className="text-[10px] text-muted-foreground/80 font-mono">Audit ref: {primary.id}</p>

          {receiptPaymentId && onDownloadReceipt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDownloadReceipt(receiptPaymentId);
              }}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
            >
              <Receipt className="w-3.5 h-3.5" />
              View Receipt
            </button>
          )}

          {receiptPaymentId && onCorrectPayment && canCorrectPayment && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCorrectPayment(receiptPaymentId);
              }}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Correct Payment
            </button>
          )}
        </div>
      )}
    </div>
  );
}
