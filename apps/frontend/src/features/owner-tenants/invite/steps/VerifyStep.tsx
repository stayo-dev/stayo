import { Check } from 'lucide-react';
import type { OwnerSessionHostel } from '@features/owner-session/useOwnerSession';
import { buildPreviewDisplay, type InviteSettlementPreviewResponse } from '../settlementPreview';
import type { InviteWizardData } from '../../types';

interface VerifyStepProps {
  data: InviteWizardData;
  agreed: boolean;
  setAgreed: (v: boolean) => void;
  hostels: OwnerSessionHostel[];
  /** From `useInviteWizard` — undefined while nothing's been entered on the Money step yet. */
  settlementPreview?: InviteSettlementPreviewResponse;
  isLoadingSettlementPreview?: boolean;
  settlementPreviewError?: string | null;
}

const row = 'flex items-center justify-between border-t border-border/60 px-3.5 py-2.5 first:border-t-0';

/** Step 4/4 of the Invite Tenant wizard — review everything before sending. */
export function VerifyStep({
  data,
  agreed,
  setAgreed,
  hostels,
  settlementPreview,
  isLoadingSettlementPreview,
  settlementPreviewError,
}: VerifyStepProps) {
  const rent = Number(data.monthlyRent) || 0;
  const deposit = Number(data.deposit) || 0;
  const maintenance = Number(data.maintenance) || 0;
  const total = rent + deposit + maintenance;
  const hostelName = hostels.find((h) => h.id === data.hostelId)?.name ?? '—';
  const paidAmount = Number(data.paidAmount) || 0;
  const showPaymentSection = data.hasPaidAlready && paidAmount > 0;
  const display = settlementPreview ? buildPreviewDisplay(settlementPreview, { paidAmount, monthlyRent: rent }) : null;

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Review details</span>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Tenant</span>
            <span className="text-sm font-bold text-foreground">{data.tenantName || '—'}</span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Phone</span>
            <span className="text-sm font-bold tabular-nums text-foreground">+91 {data.tenantPhone || '—'}</span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Email</span>
            <span className={`text-sm font-bold ${data.tenantEmail.trim() ? 'text-foreground' : 'text-warning'}`}>
              {data.tenantEmail.trim() || 'None — no fallback'}
            </span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Hostel</span>
            <span className="text-sm font-bold text-foreground">{hostelName}</span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Room</span>
            <span className="text-sm font-bold text-foreground">{data.roomLabel || '—'}</span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Joining date</span>
            <span className="text-sm font-bold text-foreground">{data.joiningDate || '—'}</span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Agreement duration</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{data.agreementMonths} Months</span>
          </div>
          <div className={row}>
            <span className="text-[13.5px] text-muted-foreground">Billing</span>
            <span className="text-sm font-bold text-foreground">{data.billing}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pricing summary</span>
        <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span>Monthly rent</span>
            <span className="font-semibold tabular-nums text-foreground">₹{rent.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span>Security deposit</span>
            <span className="font-semibold tabular-nums text-foreground">₹{deposit.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-border pt-2.5">
            <span className="font-display text-[13.5px] font-bold text-foreground">Total due at move-in</span>
            <span className="font-display text-xl font-extrabold tabular-nums text-foreground">₹{total.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {showPaymentSection && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Already paid</span>
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
            {isLoadingSettlementPreview && !display ? (
              <p className="py-2 text-center text-[12.5px] text-muted-foreground">Calculating…</p>
            ) : settlementPreviewError ? (
              <p className="text-[12.5px] font-semibold text-destructive">{settlementPreviewError}</p>
            ) : display ? (
              <>
                <span className="font-display text-lg font-extrabold tabular-nums text-foreground">{display.headline}</span>
                {display.lines.length > 0 && (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {display.lines.map((line, i) => (
                      <span key={line.key}>
                        {i > 0 && ' · '}
                        {line.label} <span className="font-semibold tabular-nums text-foreground">₹{line.amount.toLocaleString('en-IN')}</span>
                      </span>
                    ))}
                  </p>
                )}
                {display.warning ? (
                  <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive">
                    {display.warning}
                  </p>
                ) : display.outstandingLabel ? (
                  <p className="text-[12.5px] font-bold text-warning">{display.outstandingLabel}</p>
                ) : (
                  <p className="text-[12.5px] font-bold text-success">Fully settled</p>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      <button type="button" onClick={() => setAgreed(!agreed)} className="flex items-start gap-2.5 text-left">
        <span className={`mt-0.5 flex h-4.5 w-4.5 flex-none items-center justify-center rounded-[5px] border-2 ${agreed ? 'border-primary bg-primary' : 'border-border'}`}>
          {agreed && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3.5} />}
        </span>
        <span className="text-[12px] leading-relaxed text-muted-foreground">
          I have verified all tenant, room, agreement and payment details before sending the invitation.
        </span>
      </button>
    </div>
  );
}
