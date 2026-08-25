import { FormEvent, useEffect, useState } from 'react';
import type { ActivationContext, ActivationStep } from '../activationTypes';
import { CommitmentSheet, TheWordCard } from './CommitmentCeremony';
import { hasStatableTerm, type AgreementTerm, type CommitmentChecks } from './commitmentTerm';
import { SignatureSheet } from './SignatureSheet';
import { BackButton, PrimaryActionButton, StepActionBar } from './shared';
import { useSky } from '../skyContext';

/**
 * Step 3 — "Review & Sign Agreement" (moved after Identity, ADR-070).
 * Rebuilt 2026-08-13 to match `Stayo Onboarding.dc.html` exactly (colors/
 * copy/layout read directly from the source, not approximated via semantic
 * tokens) — the previous version used a 2-column grid of centered cards and
 * a separate "accept rules" screen before the agreement; the design has
 * neither: one screen, and two horizontal signature rows (icon left, text
 * middle, action right).
 *
 * The backend keeps `RULES` and `AGREEMENT` as two distinct steps and
 * requires 5 named acknowledgements the design shows no UI for — both are
 * folded into this single screen, and submitting signs both backend steps in
 * sequence behind one "Submit & sign contract" tap.
 *
 * **Why the acknowledgements survive an "exact design" pass.** They are not
 * decoration: `acceptRules()` validates all five server-side and, on success,
 * writes a `tenant_policy_acceptances` row stamped with the tenant's IP,
 * user agent and typed name — a consent record. Dropping the UI would not
 * drop the requirement, it would post `{all: true}` on behalf of someone who
 * was never shown the statements. So instead of a second card sitting beside
 * the design's document (which is what this used to be, and what read as
 * bolted on), they are now a closing numbered section *inside* the document
 * box — the design's own box already elides sections 2–5, so a final "7."
 * belongs there. One cream box, as designed, with the consent intact.
 *
 * 2026-08-15: re-synced against the approved design — the unsigned tenant
 * row is a solid terracotta card that pulses (`sigGlow`) with a nudging
 * arrow until something is signed rather than a flat dashed one, the signed
 * states use the design's mint fills, the guardian row is offered to every
 * tenant (not only students), and tapping either row now opens
 * `SignatureSheet` — the design's full-screen pad — instead of the generic
 * dialog that used to wrap the owner-side `SignaturePad`.
 */

const REQUIRED_ACKS: { key: string; label: string }[] = [
  { key: 'fee_refund_rules', label: 'I understand hostel fee and refund rules' },
  { key: 'discipline_policies', label: 'I understand discipline policies' },
  { key: 'late_fee_obligations', label: 'I understand late fee and payment obligations' },
  { key: 'damage_liabilities', label: 'I understand hostel property damage liabilities' },
  { key: 'hostel_rules', label: 'I agree to comply with hostel rules' },
];

interface AgreementStepProps {
  ctx: ActivationContext;
  completedSteps: Set<string>;
  submitting: boolean;
  guardianName: string;
  guardianRelation: string;
  onGuardianSigned: (name: string, relation: string) => void;
  onAcceptRules: (data: { acknowledgements: Record<string, boolean>; typed_signature_name: string }) => Promise<boolean>;
  onSubmitAgreement: (data: {
    tenant_signature_url: string | null;
    tenant_signature_name: string | null;
    guardian_signature_url: string | null;
    guardian_signature_name: string | null;
    guardian_relation: string | null;
  }) => Promise<boolean>;
  uploadSignature: (file: File, type: 'tenant' | 'guardian') => Promise<{ url: string }>;
  goToStep: (step: ActivationStep) => void;
  onError: (message: string) => void;
}

export function AgreementStep({
  ctx,
  completedSteps,
  submitting,
  guardianName,
  guardianRelation,
  onGuardianSigned,
  onAcceptRules,
  onSubmitAgreement,
  uploadSignature,
  goToStep,
  onError,
}: AgreementStepProps) {
  const agreement = ctx.agreement;
  const rulesAccepted = completedSteps.has('RULES') || Boolean(ctx.activation_state?.rules_accepted);
  const agreementSigned = completedSteps.has('AGREEMENT') || Boolean(ctx.activation_state?.agreement_signed);

  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [activeSigType, setActiveSigType] = useState<'tenant' | 'guardian' | null>(null);
  const [tenantSigBlob, setTenantSigBlob] = useState<Blob | null>(null);
  const [tenantSigName, setTenantSigName] = useState('');
  const [guardianSigBlob, setGuardianSigBlob] = useState<Blob | null>(null);
  const sky = useSky();
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [commitmentGiven, setCommitmentGiven] = useState(false);
  // The term the owner set, finally sent to the client (ADR-112). Null for an
  // agreement with no stateable duration, which skips the ceremony.
  const rawTerm = (agreement as any)?.term as AgreementTerm | undefined;
  const commitmentTerm = hasStatableTerm(rawTerm) ? (rawTerm as AgreementTerm) : null;

  useEffect(() => {
    if (rulesAccepted) {
      setAcks(Object.fromEntries(REQUIRED_ACKS.map((a) => [a.key, true])));
    }
  }, [rulesAccepted]);

  useEffect(() => {
    if (agreement?.tenant_signature_name) setTenantSigName(agreement.tenant_signature_name);
  }, [agreement?.tenant_signature_name]);

  if (!agreement) return null;

  const allAcksChecked = REQUIRED_ACKS.every((a) => acks[a.key] === true);
  const snapshot = agreement.content_snapshot || {};
  const facts = [
    { k: 'Room', v: snapshot.room_number ?? '—' },
    { k: 'Joining', v: snapshot.joining_date ?? '—' },
    { k: 'Monthly Rent', v: `₹${snapshot.monthly_rent ?? 0}` },
    { k: 'Deposit', v: `₹${snapshot.advance_deposit ?? 0}` },
    { k: 'Maintenance', v: snapshot.maintenance_charge ? `₹${snapshot.maintenance_charge}/mo` : '—' },
    { k: 'Cycle', v: snapshot.payment_frequency ?? 'Monthly' },
  ];

  const existingTenantSigUrl = agreement.tenant_signature_url || '';
  const existingGuardianSigUrl = agreement.guardian_signature_url || '';
  const tenantHasSignature = Boolean(tenantSigBlob || existingTenantSigUrl);
  const guardianHasSignature = Boolean(guardianSigBlob || existingGuardianSigUrl);
  const tenantSignatureName = tenantSigName || agreement.tenant_signature_name || '';
  const guardianSignatureName = guardianName || agreement.guardian_signature_name || '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (agreementSigned) {
      goToStep('ACTIVATE');
      return;
    }
    if (!allAcksChecked) return onError('Please confirm you understand the rules above.');

    // Everything below this point is validation of what was filled in. Once it
    // passes, the commitment sheet is the last step — the term is put to the
    // tenant in words before anything is signed, rather than discovered later
    // in a PDF. A hostel with no stateable duration skips it entirely and signs
    // exactly as it did before.
    if (commitmentTerm && !commitmentGiven) {
      const problem = validateSignatures();
      if (problem) return onError(problem);
      setSheetOpen(true);
      return;
    }

    await performSubmit(null);
  };

  const validateSignatures = (): string | null => {
    const tenantSignatureComplete = Boolean(tenantHasSignature && tenantSignatureName);
    const guardianSignatureComplete = Boolean(guardianHasSignature && guardianSignatureName && (guardianRelation || agreement.guardian_relation));
    if (tenantHasSignature && !tenantSignatureName) return 'Your typed full name signature is required';
    if (guardianHasSignature && !guardianSignatureName) return 'Parent/Guardian typed full name signature is required';
    if (guardianHasSignature && !(guardianRelation || agreement.guardian_relation)) return 'Please select parent/guardian relationship';
    if (!tenantSignatureComplete && !guardianSignatureComplete) return 'Add at least one signature: tenant or parent/guardian.';
    return null;
  };

  const performSubmit = async (checks: CommitmentChecks | null) => {

    const tenantSignatureComplete = Boolean(tenantHasSignature && tenantSignatureName);
    const guardianSignatureComplete = Boolean(guardianHasSignature && guardianSignatureName && (guardianRelation || agreement.guardian_relation));
    const problem = validateSignatures();
    if (problem) return onError(problem);

    setBusy(true);
    try {
      if (!rulesAccepted) {
        const accepted = await onAcceptRules({ acknowledgements: acks, typed_signature_name: ctx.profile.name || '' });
        if (!accepted) return;
      }

      let tenantSigUrl = existingTenantSigUrl;
      if (tenantSignatureComplete && tenantSigBlob) {
        const file = new File([tenantSigBlob], 'tenant_signature.png', { type: 'image/png' });
        tenantSigUrl = (await uploadSignature(file, 'tenant')).url;
      }
      let guardianSigUrl = existingGuardianSigUrl;
      if (guardianSignatureComplete && guardianSigBlob) {
        const file = new File([guardianSigBlob], 'guardian_signature.png', { type: 'image/png' });
        guardianSigUrl = (await uploadSignature(file, 'guardian')).url;
      }

      const saved = await onSubmitAgreement({
        tenant_signature_url: tenantSignatureComplete ? tenantSigUrl : null,
        tenant_signature_name: tenantSignatureComplete ? tenantSignatureName : null,
        guardian_signature_url: guardianSignatureComplete ? guardianSigUrl : null,
        guardian_signature_name: guardianSignatureComplete ? guardianSignatureName : null,
        guardian_relation: guardianSignatureComplete ? guardianRelation || agreement.guardian_relation || null : null,
        // Recorded against the agreement with the exact sentence shown — an
        // acknowledgement the system does not keep gives the owner nothing.
        ...(checks ? { commitment: { read_agreement: checks.readAgreement, accept_term: checks.acceptTerm } } : {}),
      });
      if (saved) {
        setTenantSigBlob(null);
        setGuardianSigBlob(null);
        if (checks) setCommitmentGiven(true);
      }
    } catch (err: any) {
      onError(err?.message || 'Failed to submit agreement signature');
    } finally {
      setBusy(false);
    }
  };

  const isBusy = busy || submitting;

  return (
    <form onSubmit={handleSubmit} style={{ animation: 'obFade .25s ease' }}>
      {/* The term, stated before anything is signed rather than discovered in
          the PDF afterwards. */}
      {commitmentTerm && !agreementSigned && (
        <TheWordCard
          hostelName={String(ctx.room_summary?.hostel_name || '')}
          roomNumber={ctx.room_summary?.room_number != null ? String(ctx.room_summary.room_number) : null}
          term={commitmentTerm}
        />
      )}

      {commitmentTerm && sheetOpen && (
        <CommitmentSheet
          hostelName={String(ctx.room_summary?.hostel_name || '')}
          term={commitmentTerm}
          busy={busy}
          given={commitmentGiven}
          tenantName={ctx.profile?.name || ''}
          ownerName={(ctx as any)?.template?.owner_name || ''}
          onCancel={() => setSheetOpen(false)}
          onConfirm={(checks) => { void performSubmit(checks); }}
          onDone={() => { setSheetOpen(false); goToStep('ACTIVATE'); }}
        />
      )}

      <div className="flex items-start gap-[11px]">
        <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]" style={{ background: '#F3E7E0', color: '#B46A55' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3h7l4 4v14H7z" />
            <path d="M14 3v4h4M10 12h6M10 16h6" />
          </svg>
        </div>
        <div>
          <div
            className="font-display text-[18px] font-extrabold tracking-tight"
            style={{ color: sky.onSkyTitle, textShadow: sky.onSkyShadow }}
          >
            Review &amp; Sign Agreement
          </div>
          <div className="mt-1 text-xs leading-relaxed" style={{ color: sky.onSkyBody }}>
            Review your stay terms and sign electronically below.
          </div>
        </div>
      </div>

      <div className="mt-[15px] rounded-[13px] p-[14px_16px]" style={{ background: '#F6F1EA', padding: '16px 14px' }}>
        <div className="text-center">
          <div className="font-display text-sm font-extrabold" style={{ color: '#221E1A', letterSpacing: '.01em' }}>
            HOSTEL RESIDENCY AGREEMENT
          </div>
          <div className="mt-1 text-[11.5px]" style={{ color: '#8A7F75' }}>
            Hostel: {snapshot.hostel_name || ctx.hostel.name}
          </div>
        </div>
        <div className="my-3.5 h-px" style={{ background: '#E4DACB' }} />
        <div className="text-[12.5px] leading-relaxed" style={{ color: '#3A342E' }}>
          This agreement is made between the Management of <b>{snapshot.hostel_name || ctx.hostel.name}</b> (represented by{' '}
          <b>{snapshot.owner_name || 'the hostel owner'}</b>) and the Tenant <b>{snapshot.tenant_name || ctx.profile.name}</b>.
        </div>

        <div className="mt-4 text-[11.5px] font-extrabold uppercase" style={{ color: '#221E1A', letterSpacing: '.04em' }}>
          1. Room &amp; Financial Summary
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 rounded-[10px] p-3" style={{ background: '#EFE7DA' }}>
          {facts.map((f) => (
            <div key={f.k} className="text-xs leading-snug" style={{ color: '#5A5147' }}>
              {f.k}: <b style={{ color: '#1A1A1A' }}>{f.v}</b>
            </div>
          ))}
        </div>

        <div className="mt-4 text-[11.5px] font-extrabold uppercase" style={{ color: '#221E1A', letterSpacing: '.04em' }}>
          6. Management Rights
        </div>
        <ul className="mt-2 flex flex-col gap-1.5 pl-4">
          <li className="text-xs italic leading-relaxed" style={{ color: '#3A342E', fontWeight: 600 }}>
            Decisions on hostel administration, discipline, and accommodation shall be final and binding.
          </li>
          <li className="text-xs leading-relaxed" style={{ color: '#5A5147' }}>
            Management reserves the right to discontinue accommodation for misconduct, indiscipline, or rule violations.
          </li>
        </ul>

        {!rulesAccepted && (
          <>
            <div className="mt-4 text-[11.5px] font-extrabold uppercase" style={{ color: '#221E1A', letterSpacing: '.04em' }}>
              7. Acknowledgements
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {REQUIRED_ACKS.map((a) => (
                <label key={a.key} className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: '#3A342E' }}>
                  <input
                    type="checkbox"
                    checked={acks[a.key] === true}
                    onChange={(e) => setAcks({ ...acks, [a.key]: e.target.checked })}
                    className="mt-0.5 h-3.5 w-3.5 flex-none accent-primary"
                  />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="mt-3.5 border-t border-dashed pt-2.5 text-[11px] leading-relaxed" style={{ borderColor: '#D3C8B8', color: '#7A6F63' }}>
          Valid under the IT Act. Digital signatures and IP details collected during onboarding are legally binding.
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-2.5 rounded-[11px] px-3 py-2.5" style={{ background: '#E4F3EB', border: '1px solid #BFE3CE' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F7A52" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        <span className="text-xs font-bold leading-tight" style={{ color: '#1F7A52' }}>
          One signature is required to continue — sign as tenant, guardian, or both.
        </span>
      </div>

      <div className="mb-2 mt-[15px] text-[10px] font-extrabold uppercase" style={{ color: '#9A8F84', letterSpacing: '.08em' }}>
        Choose who signs
      </div>

      <button
        type="button"
        onClick={() => setActiveSigType('tenant')}
        className={`flex w-full items-center gap-3 rounded-[14px] p-[12px_13px] text-left transition-colors ${
          !tenantHasSignature && !guardianHasSignature ? 'ob-sig-glow' : ''
        }`}
        style={{
          background: tenantHasSignature ? '#F1FAF4' : '#fff',
          border: tenantHasSignature ? '1.5px solid #1F9D57' : '1.5px solid #B46A55',
          boxShadow: tenantHasSignature ? 'none' : '0 4px 14px rgba(180,106,85,.15)',
        }}
      >
        <div
          className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
          style={{ background: tenantHasSignature ? '#DCEFE4' : '#F3E7E0', color: tenantHasSignature ? '#1F7A52' : '#B46A55' }}
        >
          {tenantHasSignature ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 6" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 20c0-4 3.8-6 7.5-6s7.5 2 7.5 6" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-sm font-extrabold" style={{ color: '#1A1A1A' }}>
              Sign as Tenant
            </span>
            <span className="flex-none rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase" style={{ color: '#A45D44', background: '#F3E7E0', letterSpacing: '.06em' }}>
              Required
            </span>
          </div>
          <div className="mt-0.5 text-xs font-medium" style={{ color: tenantHasSignature ? '#1F7A52' : '#8A7F75' }}>
            {tenantHasSignature ? `Signed as "${tenantSignatureName}"` : 'Tap to open the signature pad'}
          </div>
        </div>
        <div className="flex-none">
          {tenantHasSignature ? (
            <div className="flex items-center gap-1.5 font-display text-xs font-extrabold" style={{ color: '#1F7A52' }}>
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: '#1F9D57' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 6" />
                </svg>
              </span>
              Edit
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full px-3.5 py-2 font-display text-xs font-extrabold text-white" style={{ background: '#B46A55', boxShadow: '0 4px 11px rgba(180,106,85,.3)' }}>
              Sign
              <svg className="ob-nudge-x" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>
          )}
        </div>
      </button>

      {/*
       * Shown to every tenant, not just students: the design marks this row
       * "Optional" and offers it unconditionally, and a co-signature is
       * legitimately useful for a working professional too. Only the guardian
       * *contact* fields on Identity are student-mandatory.
       */}
      <button
        type="button"
        onClick={() => setActiveSigType('guardian')}
        className="mt-2.5 flex w-full items-center gap-3 rounded-[14px] p-[12px_13px] text-left transition-colors"
        style={{
          background: guardianHasSignature ? '#F1FAF4' : '#FBF8F3',
          border: guardianHasSignature ? '1.5px solid #1F9D57' : '1.5px solid #E4DACB',
        }}
      >
        <div
          className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
          style={{ background: guardianHasSignature ? '#DCEFE4' : '#F1EAE0', color: guardianHasSignature ? '#1F7A52' : '#9A8578' }}
        >
          {guardianHasSignature ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 6" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4-3 6.5-7 9-4-2.5-7-5-7-9V6l7-3z" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-sm font-extrabold" style={{ color: '#1A1A1A' }}>
              Parent / Guardian
            </span>
            <span className="flex-none rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase" style={{ color: '#8A7F75', background: '#EFE7DA', letterSpacing: '.06em' }}>
              Optional
            </span>
          </div>
          <div className="mt-0.5 text-xs font-medium" style={{ color: guardianHasSignature ? '#1F7A52' : '#8A7F75' }}>
            {guardianHasSignature ? 'Guardian signature applied' : 'Add a co-signature if needed'}
          </div>
        </div>
        <div className="flex-none">
          {guardianHasSignature ? (
            <div className="flex items-center gap-1.5 font-display text-xs font-extrabold" style={{ color: '#1F7A52' }}>
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full" style={{ background: '#1F9D57' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 6" />
                </svg>
              </span>
              Edit
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-full font-display text-xs font-extrabold" style={{ background: '#fff', border: '1.5px solid #D9CFC3', color: '#3A342E', padding: '7px 13px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add
            </div>
          )}
        </div>
      </button>

      {activeSigType === 'tenant' && (
        <SignatureSheet
          mode="tenant"
          name={tenantSigName}
          existingSignatureUrl={agreement.tenant_signature_url}
          onApply={(name, _relation, blob) => {
            setTenantSigName(name);
            if (blob) setTenantSigBlob(blob);
            setActiveSigType(null);
          }}
          onCancel={() => setActiveSigType(null)}
        />
      )}
      {activeSigType === 'guardian' && (
        <SignatureSheet
          mode="guardian"
          name={guardianName}
          relation={guardianRelation}
          existingSignatureUrl={agreement.guardian_signature_url}
          onApply={(name, relation, blob) => {
            onGuardianSigned(name, relation);
            if (blob) setGuardianSigBlob(blob);
            setActiveSigType(null);
          }}
          onCancel={() => setActiveSigType(null)}
        />
      )}

      <StepActionBar>
        <BackButton title="Back to Identity" onClick={() => goToStep('PROFILE')} />
        <PrimaryActionButton type="submit" disabled={isBusy}>
          {!isBusy && !agreementSigned && (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l2.5 2.5L16 9" />
            </svg>
          )}
          {isBusy ? 'Saving…' : agreementSigned ? 'Proceed to Account' : 'Submit & sign contract'}
        </PrimaryActionButton>
      </StepActionBar>
    </form>
  );
}
