import { useState } from 'react';
import { Check, X, ExternalLink } from 'lucide-react';
import { usePaymentClaims } from '../../hooks/usePaymentClaims';
import {
  claimsHeading,
  claimSummary,
  formatPaise,
  waitingFor,
  CONFIRM_LABEL,
  REJECT_LABEL,
  CONFIRM_HELP,
  type PaymentClaim,
} from './paymentClaims';

/**
 * Tenants who say they have paid, waiting on the owner.
 *
 * This is the whole reconciliation surface now that the gateway is gone: with
 * no webhook, nothing enters the ledger until the owner acts on a row here
 * (ADR-234). So the card leads with the UPI reference — the one field he can
 * match against his own bank statement — rather than with the screenshot,
 * which proves nothing and would invite a glance-and-confirm.
 *
 * A thin renderer: every wording and formatting decision lives in
 * `paymentClaims.ts`, which is tested directly.
 */
export function PaymentClaimsCard({ hostelId }: { hostelId: string | null }) {
  const { claims, isLoading, confirm, reject, isDeciding } = usePaymentClaims(hostelId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Nothing waiting is the normal state; an empty card would be noise on a
  // screen that already has plenty.
  if (isLoading || claims.length === 0) return null;

  return (
    <div className="rounded-[20px] border border-primary/30 bg-primary/[0.04] shadow-[0_1px_2px_rgba(40,30,20,0.04)]">
      <div className="px-4 pb-2 pt-3.5">
        <span className="font-display text-[13.5px] font-bold text-foreground">
          {claimsHeading(claims.length)}
        </span>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{CONFIRM_HELP}</p>
      </div>

      <div className="px-4 pb-3">
        {claims.map((claim: PaymentClaim) => {
          const open = expandedId === claim.id;
          return (
            <div key={claim.id} className="border-t border-border/60 py-3 first:border-t-0">
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : claim.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {claim.tenant_name}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {claimSummary(claim)} · {waitingFor(claim.created_at)}
                  </span>
                </span>
                <span className="flex-none font-display text-[13.5px] font-bold tabular-nums text-foreground">
                  {formatPaise(claim.claimed_amount)}
                </span>
              </button>

              {open && (
                <div className="mt-2.5">
                  {/* The reference, in full and selectable. Truncating the one
                      field he compares character by character would defeat it. */}
                  <div className="rounded-xl bg-card px-3 py-2.5">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      UPI reference
                    </p>
                    <p className="mt-0.5 select-all font-mono text-[13px] font-semibold text-foreground">
                      {claim.utr}
                    </p>
                  </div>

                  {claim.mismatch_note && (
                    // Routine, not an accusation: most UPI apps let the payer
                    // edit the amount on a person-to-person intent.
                    <p className="mt-2 text-[11.5px] text-muted-foreground">
                      Paid {claim.mismatch_note}
                    </p>
                  )}

                  {claim.proof_url && (
                    <a
                      href={claim.proof_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View screenshot
                    </a>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={isDeciding}
                      onClick={() => confirm.mutate(claim.id)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 font-display text-[12.5px] font-bold text-primary-foreground disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {CONFIRM_LABEL}
                    </button>
                    <button
                      type="button"
                      disabled={isDeciding}
                      onClick={() => reject.mutate({ claimId: claim.id })}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 font-display text-[12.5px] font-bold text-foreground disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {REJECT_LABEL}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
