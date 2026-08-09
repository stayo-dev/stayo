import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileCheck2,
  MessageSquare,
  ShieldAlert,
} from 'lucide-react';
import { tenantPortalApi } from '@features/tenant-portal/api';
import { useTenantRenewal } from '@features/tenant-portal/hooks/useTenantRenewal';
import { SignaturePad } from '@shared/ui/inputs';
import { StayoLoader } from '@shared/ui/brand';

const fmt = (n: unknown) => {
  const num = Number(n);
  return `₹${(Number.isFinite(num) ? num : 0).toLocaleString('en-IN')}`;
};

const fmtDate = (value: unknown) => {
  if (!value) return 'Not set';
  return new Date(String(value)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

type Stage = 'loading' | 'error' | 'current' | 'move_out' | 'awaiting_offer' | 'offer_pending' | 'awaiting_signature' | 'signed';

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <Link to="/tenant/profile" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Profile
      </Link>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Stay Agreement</p>
        <h1 className="text-xl font-bold text-foreground">Agreement Renewal</h1>
      </div>
      {children}
    </div>
  );
}

export function TenantRenewalPage() {
  const { agreementRenewal, renewalOffer, isLoading, isError, refetch, invalidate } = useTenantRenewal();

  const stage: Stage = useMemo(() => {
    if (isLoading) return 'loading';
    if (isError) return 'error';
    const draft = agreementRenewal?.renewal_draft as Record<string, any> | null | undefined;
    if (agreementRenewal?.decision_state === 'MOVE_OUT_IN_PROGRESS') return 'move_out';
    if (draft) return draft.status === 'SIGNED' ? 'signed' : 'awaiting_signature';
    if (renewalOffer && (renewalOffer.status === 'SENT' || renewalOffer.status === 'DRAFT')) return 'offer_pending';
    if (agreementRenewal && agreementRenewal.decision_state !== 'CURRENT') return 'awaiting_offer';
    return 'current';
  }, [isLoading, isError, agreementRenewal, renewalOffer]);

  if (stage === 'loading') {
    return (
      <PageShell>
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-16 text-sm text-muted-foreground">
          <StayoLoader size="sm" className="text-accent" label={null} />
          Loading your renewal status...
        </div>
      </PageShell>
    );
  }

  if (stage === 'error') {
    return (
      <PageShell>
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-sm font-semibold text-foreground">Could not load your renewal status</p>
          <button type="button" onClick={() => refetch()} className="mt-2 text-xs font-bold text-accent">Retry</button>
        </div>
      </PageShell>
    );
  }

  if (stage === 'current') {
    return (
      <PageShell>
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="mt-3 text-sm font-bold text-foreground">Your agreement is active</p>
          <p className="mt-1 text-xs text-muted-foreground">There's nothing to review right now. We'll notify you here as soon as a renewal offer is ready.</p>
        </div>
      </PageShell>
    );
  }

  if (stage === 'move_out') {
    return (
      <PageShell>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Move-out in progress</p>
              <p className="mt-1 text-xs text-muted-foreground">Renewal is paused while your move-out request is active.</p>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  if (stage === 'signed') {
    return <SignedConfirmation draft={agreementRenewal?.renewal_draft} />;
  }

  if (stage === 'awaiting_signature') {
    return <SignAgreementSection draft={agreementRenewal?.renewal_draft} currentAgreement={agreementRenewal?.current_agreement} onSigned={invalidate} />;
  }

  if (stage === 'offer_pending') {
    return <OfferReviewSection offer={renewalOffer} onDecided={invalidate} />;
  }

  return <AwaitingOfferSection renewal={agreementRenewal} />;
}

function AwaitingOfferSection({ renewal }: { renewal?: Record<string, any> }) {
  const state = String(renewal?.decision_state || '');
  const daysUntilExpiry = renewal?.days_until_expiry != null ? Number(renewal.days_until_expiry) : null;
  const daysOverdue = Number(renewal?.days_overdue || 0);
  const isCritical = state === 'RENEWAL_OVERDUE_CRITICAL' || state === 'EXPIRED_AND_RENT_OVERDUE';
  const isExpiringSoon = Array.isArray(renewal?.states) && renewal.states.includes('EXPIRING_SOON');

  const title = isExpiringSoon
    ? `Agreement expires in ${daysUntilExpiry ?? 0} days`
    : isCritical
      ? 'Agreement renewal is overdue'
      : 'Agreement expired';
  const message = isExpiringSoon
    ? 'Hostel management is preparing your stay extension offer. We will notify you here as soon as it is ready.'
    : `Your agreement has expired. Please contact management to receive your renewal offer, or request to move out${daysOverdue ? ` (${daysOverdue} days overdue)` : ''}.`;

  return (
    <PageShell>
      <div className={`rounded-2xl border p-6 shadow-sm ${isCritical ? 'border-destructive/30 bg-destructive/[0.04]' : 'border-warning/30 bg-warning/[0.06]'}`}>
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isCritical ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
            {isCritical ? <ShieldAlert className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{message}</p>
          </div>
        </div>
        <Link
          to="/tenant/move-out"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          Plan Move-out
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </PageShell>
  );
}

function OfferReviewSection({ offer, onDecided }: { offer: Record<string, any>; onDecided: () => void }) {
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const acceptMutation = useMutation({
    mutationFn: (offerId: string) => tenantPortalApi.acceptRenewalOffer(offerId),
    onSuccess: () => {
      toast.success('Offer accepted! Your renewed agreement is being prepared for signature.');
      onDecided();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Unable to accept renewal offer'),
  });

  const declineMutation = useMutation({
    mutationFn: ({ offerId, reason }: { offerId: string; reason: string }) => tenantPortalApi.declineRenewalOffer(offerId, reason),
    onSuccess: () => {
      toast.success('Renewal offer declined.');
      onDecided();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Unable to decline renewal offer'),
  });

  const discussMutation = useMutation({
    mutationFn: (offerId: string) => tenantPortalApi.discussRenewalOffer(offerId, 'Let us discuss the renewal offer options.'),
    onSuccess: () => toast.success('Discussion request sent to your hostel owner.'),
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Unable to send discussion request'),
  });

  const currentRent = Number(offer.current_rent ?? offer.agreement?.contract_rent ?? 0);
  const proposedRent = Number(offer.proposed_rent ?? 0);
  const rentDelta = proposedRent - currentRent;
  const currentDeposit = Number(offer.current_security_deposit ?? offer.agreement?.contract_security_deposit ?? 0);
  const depositHeld = Number(offer.deposit_held ?? currentDeposit);
  const additionalDeposit = Number(offer.additional_deposit_required ?? 0);
  const startDateFmt = offer.effective_from ? fmtDate(offer.effective_from) : 'Next Period';
  const expiryDateFmt = offer.offer_expires_at ? fmtDate(offer.offer_expires_at) : 'N/A';
  const busy = acceptMutation.isPending || declineMutation.isPending || discussMutation.isPending;

  return (
    <PageShell>
      <div className="rounded-2xl border border-accent/30 bg-accent/[0.04] p-5 shadow-sm">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
          Stay Renewal Offer
        </span>
        <h2 className="mt-2 text-sm font-bold text-foreground">Proposed Extension Terms</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Review the proposed terms for your upcoming contract period starting {startDateFmt}.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Current Rent</p>
            <p className="mt-0.5 text-base font-extrabold text-foreground">{fmt(currentRent)}</p>
          </div>
          <div className="rounded-xl border border-accent/20 bg-card p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent">New Rent</p>
            <p className="mt-0.5 text-base font-extrabold text-foreground">{fmt(proposedRent)}</p>
            {rentDelta !== 0 && (
              <p className={`mt-0.5 text-[10px] font-semibold ${rentDelta > 0 ? 'text-warning' : 'text-emerald-600'}`}>
                {rentDelta > 0 ? `+${fmt(rentDelta)}` : fmt(rentDelta)} change
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Deposit Held</p>
            <p className="mt-0.5 text-base font-extrabold text-foreground">{fmt(depositHeld)}</p>
          </div>
          <div className="rounded-xl border border-accent/20 bg-card p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent">Additional Deposit</p>
            <p className="mt-0.5 text-base font-extrabold text-foreground">{fmt(additionalDeposit)}</p>
            <p className={`mt-0.5 text-[10px] font-semibold ${additionalDeposit > 0 ? 'text-warning' : 'text-emerald-600'}`}>
              {additionalDeposit > 0 ? 'Top-up required' : 'No top-up due'}
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-1 rounded-xl border border-border bg-card/60 p-3 text-xs text-muted-foreground">
          <p>Duration: <strong className="text-foreground">{offer.proposed_duration_months} Months</strong></p>
          <p>Offer Expires: <strong className="text-foreground">{expiryDateFmt}</strong></p>
          {offer.owner_notes && (
            <div className="mt-2 rounded-r-lg border-l-2 border-accent/40 bg-accent/[0.06] p-2.5 text-xs italic text-foreground">
              &ldquo;{offer.owner_notes}&rdquo;
            </div>
          )}
        </div>

        {offer.revisions && offer.revisions.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Offer Revision History</p>
            <div className="space-y-2 border-l-2 border-border pl-2">
              {offer.revisions.map((rev: any, index: number) => (
                <div key={rev.id} className="text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <span>v{offer.revisions.length - index}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider">{rev.status}</span>
                  </div>
                  <div className="mt-0.5">
                    Rent: <span className="font-medium text-foreground">{fmt(rev.proposed_rent)}</span>, Deposit: <span className="font-medium text-foreground">{fmt(rev.proposed_security_deposit)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!showDeclineForm ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => acceptMutation.mutate(offer.id)}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-bold text-accent-foreground shadow-sm transition-colors disabled:opacity-50"
            >
              {acceptMutation.isPending ? <StayoLoader size="sm" label={null} /> : <CheckCircle2 className="h-4 w-4" />}
              Accept Offer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => discussMutation.mutate(offer.id)}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 text-xs font-bold text-foreground transition-colors disabled:opacity-50"
            >
              {discussMutation.isPending ? <StayoLoader size="sm" label={null} /> : <MessageSquare className="h-4 w-4" />}
              Request Discussion
            </button>
            <Link
              to="/tenant/move-out"
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 text-xs font-bold text-foreground transition-colors"
            >
              Plan Move-out
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowDeclineForm(true)}
              className="ml-1 mt-1 text-xs font-bold text-destructive underline underline-offset-4"
            >
              Decline Offer
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold text-foreground">Why are you declining this offer?</p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="E.g., rent increase is too high, plan to vacate, room category change needed..."
              className="min-h-[70px] w-full rounded-xl border border-border bg-card p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setShowDeclineForm(false); setDeclineReason(''); }} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground">
                Cancel
              </button>
              <button
                type="button"
                disabled={!declineReason.trim() || declineMutation.isPending}
                onClick={() => declineMutation.mutate({ offerId: offer.id, reason: declineReason })}
                className="rounded-lg bg-destructive px-3 py-2 text-xs font-bold text-destructive-foreground transition-colors disabled:opacity-50"
              >
                {declineMutation.isPending ? <StayoLoader size="xs" className="mr-1 inline" label={null} /> : null}
                Confirm Decline
              </button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function SignAgreementSection({
  draft,
  currentAgreement,
  onSigned,
}: {
  draft?: Record<string, any>;
  currentAgreement?: Record<string, any>;
  onSigned: () => void;
}) {
  const [tenantSigBlob, setTenantSigBlob] = useState<Blob | null>(null);
  const [tenantSigName, setTenantSigName] = useState('');
  const [showGuardian, setShowGuardian] = useState(false);
  const [guardianSigBlob, setGuardianSigBlob] = useState<Blob | null>(null);
  const [guardianSigName, setGuardianSigName] = useState('');
  const [guardianRelation, setGuardianRelation] = useState('');

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!tenantSigBlob || !tenantSigName.trim()) {
        throw new Error('Please draw your signature and enter your name.');
      }
      const tenantFile = new File([tenantSigBlob], 'tenant_signature.png', { type: 'image/png' });
      const tenantUpload = await tenantPortalApi.uploadRenewalSignature(tenantFile, 'tenant');

      let guardianSignature: Record<string, string> | undefined;
      if (showGuardian && guardianSigBlob && guardianSigName.trim() && guardianRelation.trim()) {
        const guardianFile = new File([guardianSigBlob], 'guardian_signature.png', { type: 'image/png' });
        const guardianUpload = await tenantPortalApi.uploadRenewalSignature(guardianFile, 'guardian');
        guardianSignature = {
          signature_url: guardianUpload.url,
          signature_name: guardianSigName.trim(),
          relation: guardianRelation.trim(),
        };
      }

      return tenantPortalApi.signRenewalAgreement(draft!.id, {
        tenant_signature_url: tenantUpload.url,
        tenant_signature_name: tenantSigName.trim(),
        guardianSignature,
      });
    },
    onSuccess: () => {
      toast.success('Your renewed agreement has been signed!');
      onSigned();
    },
    onError: (err: any) => toast.error(err?.message || err?.response?.data?.error?.message || 'Unable to sign renewal agreement'),
  });

  const currentRent = Number(currentAgreement?.contract?.rent ?? 0);
  const newRent = Number(draft?.contract?.rent ?? 0);
  const newDeposit = Number(draft?.contract?.security_deposit ?? 0);
  const canSubmit = Boolean(tenantSigBlob && tenantSigName.trim());

  return (
    <PageShell>
      <div className="rounded-2xl border border-accent/30 bg-accent/[0.04] p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-bold text-foreground">Sign Your Renewed Agreement</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          You've accepted the renewal offer — sign below to finalize your new agreement. It takes effect on {fmtDate(draft?.agreement_start_date)}.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">New Rent</p>
            <p className="mt-0.5 text-base font-extrabold text-foreground">{fmt(newRent)}{currentRent ? <span className="ml-1 text-[10px] font-semibold text-muted-foreground">(was {fmt(currentRent)})</span> : null}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Deposit</p>
            <p className="mt-0.5 text-base font-extrabold text-foreground">{fmt(newDeposit)}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <label className="text-xs font-bold text-foreground">Your Signature *</label>
          <SignaturePad onSave={setTenantSigBlob} placeholder="Draw your signature here" />
          <div>
            <label className="text-xs font-bold text-foreground">Your Full Name *</label>
            <input
              type="text"
              value={tenantSigName}
              onChange={(e) => setTenantSigName(e.target.value)}
              placeholder="As it should appear on the agreement"
              className="mt-1 h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        {!showGuardian ? (
          <button type="button" onClick={() => setShowGuardian(true)} className="mt-3 text-xs font-bold text-accent hover:underline">
            + Add Guardian Signature (optional)
          </button>
        ) : (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">Guardian Signature</label>
              <button type="button" onClick={() => setShowGuardian(false)} className="text-xs font-bold text-muted-foreground hover:text-foreground">
                Remove
              </button>
            </div>
            <SignaturePad onSave={setGuardianSigBlob} placeholder="Guardian signs here" />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={guardianSigName}
                onChange={(e) => setGuardianSigName(e.target.value)}
                placeholder="Guardian's full name"
                className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <input
                type="text"
                value={guardianRelation}
                onChange={(e) => setGuardianRelation(e.target.value)}
                placeholder="Relation (e.g. Father)"
                className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!canSubmit || signMutation.isPending}
          onClick={() => signMutation.mutate()}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold text-accent-foreground shadow-sm transition-colors disabled:opacity-50"
        >
          {signMutation.isPending ? <StayoLoader size="sm" label={null} /> : <CheckCircle2 className="h-4 w-4" />}
          Sign & Finalize Renewal
        </button>
      </div>
    </PageShell>
  );
}

function SignedConfirmation({ draft }: { draft?: Record<string, any> }) {
  return (
    <PageShell>
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-6 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <p className="mt-3 text-base font-bold text-foreground">Your agreement has been renewed!</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your new stay agreement starts on {fmtDate(draft?.agreement_start_date)} at {draft?.contract ? `₹${Number(draft.contract.rent).toLocaleString('en-IN')}/mo` : 'the agreed rent'}.
        </p>
        {draft?.pdf_url && (
          <a
            href={String(draft.pdf_url)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground shadow-sm hover:bg-muted"
          >
            View Signed Agreement
          </a>
        )}
      </div>
    </PageShell>
  );
}
