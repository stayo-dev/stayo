import { useState } from 'react';
import { Check, CreditCard, Landmark, Smartphone } from 'lucide-react';
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

type Method = 'upi' | 'card' | 'net';

const METHODS: Array<{ key: Method; title: string; sub: string; icon: typeof Smartphone; tint: string; ic: string }> = [
  { key: 'upi', title: 'UPI', sub: 'GPay, PhonePe, Paytm', icon: Smartphone, tint: '#EAF0FB', ic: '#3B5B9E' },
  { key: 'card', title: 'Card', sub: 'Debit or credit', icon: CreditCard, tint: '#F5E9E3', ic: '#B46A55' },
  { key: 'net', title: 'Net banking', sub: 'All major banks', icon: Landmark, tint: '#EAF3EE', ic: '#1F7A52' },
];

/**
 * 3-stage pay sheet (form → paying → paid), shared by Home's "Pay Rent" quick
 * action and Money's own Pay buttons. Real flow: `POST /payments/create-intent`
 * then redirect to the Razorpay checkout URL, which handles its own method
 * selection on its hosted page — the "Pay with" picker here (per the mockup)
 * is a visual pre-selection only and isn't sent anywhere, since the real
 * checkout provider doesn't accept a pre-chosen method through this API.
 * There is no in-app "paid" step for the real provider (`paying` is shown
 * until the redirect happens; `paid` only for the rare no-redirect edge case).
 */
export function PaySheet({ stage, amount, error, onClose, onConfirm }: PaySheetProps) {
  const [method, setMethod] = useState<Method>('upi');

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
          <div className="mt-[18px] text-[11px] font-bold uppercase tracking-[0.08em] text-[#A2978B]">Pay with</div>
          <div className="mt-2.5 flex flex-col gap-[9px]">
            {METHODS.map((m) => {
              const active = method === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  className={`flex items-center gap-3 rounded-[14px] border bg-card px-[15px] py-3.5 text-left ${
                    active ? 'border-[1.5px] border-primary' : 'border-[#EAE1D8]'
                  }`}
                >
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px]" style={{ background: m.tint, color: m.ic }}>
                    <m.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-foreground">{m.title}</span>
                    <span className="block text-[11px] text-[#9A8F84]">{m.sub}</span>
                  </span>
                  <span
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-full ${active ? '' : 'border-2 border-[#DCD1C4]'}`}
                    style={active ? { background: '#A45D44' } : undefined}
                  >
                    {active && <span className="h-[10px] w-[10px] rounded-full bg-white" />}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            className="mt-5 w-full rounded-[14px] bg-[#A45D44] py-4 text-center font-display text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(164,93,68,0.3)]"
          >
            Pay ₹{amount.toLocaleString('en-IN')} securely
          </button>
          <p className="mt-[11px] text-center text-[11px] text-[#B0A597]">Secured by Razorpay · UPI &amp; cards</p>
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
