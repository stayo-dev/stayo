import { Check, Smartphone } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { PayStage } from '../hooks/useTenantFinancials';
import { StayoLoader } from '@shared/ui/brand';

interface PaySheetProps {
  stage: PayStage;
  amount: number;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * 3-stage pay sheet (form → paying → paid), shared by Home's "Pay Rent" quick
 * action and Money's own Pay buttons. Real flow: `POST /payments/create-intent`
 * then redirect to the Razorpay checkout URL, which handles method selection
 * on its hosted page.
 *
 * There is deliberately NO method picker here. Stayo collects by UPI only, and
 * the old picker was cosmetic — it was never sent anywhere, because this API
 * does not accept a pre-chosen method. Showing Card and Net banking implied a
 * choice the tenant did not have and that Stayo does not offer.
 * There is no in-app "paid" step for the real provider (`paying` is shown
 * until the redirect happens; `paid` only for the rare no-redirect edge case).
 */
export function PaySheet({ stage, amount, error, onClose, onConfirm }: PaySheetProps) {
  return (
    <BottomSheet open={stage !== 'closed'} onOpenChange={(open) => !open && onClose()} title="Pay rent" hideHeader>
      {stage === 'form' && (
        <div className="flex flex-col pb-2">
          <div className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-foreground">Pay rent</div>
          <div className="rounded-2xl border border-[#EFE6DA] bg-card p-4 mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-muted-foreground">Amount</span>
              <span className="font-display text-[26px] font-extrabold tabular-nums text-foreground">
                ₹{amount.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">{error}</div>
          )}
          <div className="mt-[18px] flex items-center gap-3 rounded-[14px] border border-[#EAE1D8] bg-card px-[15px] py-3.5">
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px]" style={{ background: '#EAF0FB', color: '#3B5B9E' }}>
              <Smartphone className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-foreground">Pay by UPI</span>
              <span className="block text-[11px] text-[#9A8F84]">GPay, PhonePe, Paytm and more</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onConfirm}
            className="mt-5 w-full rounded-[14px] bg-[#A45D44] py-4 text-center font-display text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(164,93,68,0.3)]"
          >
            Pay ₹{amount.toLocaleString('en-IN')} securely
          </button>
          <p className="mt-[11px] text-center text-[11px] text-[#B0A597]">Secured by Razorpay · UPI</p>
        </div>
      )}

      {stage === 'paying' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <StayoLoader size="lg" className="text-primary" />
          <div className="font-display text-sm font-bold text-foreground">Processing payment…</div>
          <p className="text-center text-[12px] text-muted-foreground">Securely confirming with your bank</p>
        </div>
      )}

      {stage === 'paid' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="h-7 w-7" strokeWidth={2.5} />
          </span>
          <div className="font-display text-base font-bold text-foreground">Payment successful</div>
          <p className="text-center text-[12.5px] text-muted-foreground">₹{amount.toLocaleString('en-IN')} received</p>
          <button type="button" onClick={onClose} className="mt-2 rounded-xl bg-foreground px-6 py-2.5 font-display text-sm font-bold text-background">
            Done
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
