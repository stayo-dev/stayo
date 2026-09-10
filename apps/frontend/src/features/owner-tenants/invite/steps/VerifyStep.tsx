import { Check } from 'lucide-react';
import type { OwnerSessionHostel } from '@features/owner-session/useOwnerSession';
import { buildPreviewDisplay, describePreviewBlockers, type InviteSettlementPreviewResponse } from '../settlementPreview';
import type { InviteWizardData } from '../../types';

interface VerifyStepProps {
  data: InviteWizardData;
  agreed: boolean;
  setAgreed: (v: boolean) => void;
  hostels: OwnerSessionHostel[];
  /**
   * The settlement panel's three inputs, from `useInviteWizard`.
   *
   * Required, not optional — and that is the fix, not an opinion about style.
   * They were optional, `InviteTenantWizard` never passed any of them, and
   * TypeScript had no complaint: the request fired, the answer arrived, and it
   * died at this prop boundary, leaving the panel stuck on its last-resort
   * "working this out" line forever. Required props make the same omission a
   * build failure.
   *
   * `settlementPreview` is still `undefined` when nothing has been entered on
   * the Money step, which is how a caller tells "not applicable" from "loading".
   */
  settlementPreview: InviteSettlementPreviewResponse | undefined;
  isLoadingSettlementPreview: boolean;
  settlementPreviewError: string | null;
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
  /**
   * Why there is no settlement to show yet. The branch below used to render
   * `null` here, so an owner who switched the toggle on and typed an amount
   * got a headed box with nothing inside it.
   */
  const blockers = describePreviewBlockers(data);

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
            ) : blockers ? (
              <p className="text-[12.5px] leading-[1.5] text-muted-foreground">{blockers}</p>
            ) : display ? (
              <>
                <span className="font-display text-lg font-extrabold tabular-nums text-foreground">{display.headline}</span>

                {/*
                  What the money actually buys, installment by installment. An
                  owner recording cash they have already taken is checking this
                  against a notebook, so it has to name the same things the
                  notebook does — the deposit, and which months are covered.
                */}
                {display.lines.length > 0 && (
                  <ul className="flex flex-col gap-1 border-t border-border pt-2">
                    {display.lines.map((line) => (
                      <li key={line.key} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                        <span className="text-muted-foreground">{line.label}</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          ₹{line.amount.toLocaleString('en-IN')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/*
                  The balance, as a figure. This panel used to end on a month
                  name — "Nov onwards outstanding" — which answers when the
                  tenant falls behind but never how much, and how much is the
                  number the owner is verifying before they commit.
                */}
                {display.warning ? (
                  <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive">
                    {display.warning}
                  </p>
                ) : display.remainingOutstanding > 0 ? (
                  <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2">
                    <span className="text-[12.5px] font-bold text-foreground">
                      Still due
                      {display.outstandingLabel && (
                        <span className="ml-1 font-medium text-muted-foreground">
                          from {display.outstandingLabel}
                        </span>
                      )}
                    </span>
                    <span className="font-display text-[15px] font-extrabold tabular-nums text-warning">
                      ₹{display.remainingOutstanding.toLocaleString('en-IN')}
                    </span>
                  </div>
                ) : (
                  <p className="border-t border-border pt-2 text-[12.5px] font-bold text-success">
                    Fully settled — nothing outstanding
                  </p>
                )}
              </>
            ) : (
              /* Reached only while the request is in flight for the first time
                 with nothing cached — never an empty panel. */
              <p className="text-[12.5px] text-muted-foreground">Working this out…</p>
            )}
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
