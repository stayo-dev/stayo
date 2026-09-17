import { FormEvent, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { FLOW_INK } from '../skyTheme';
import { GuidanceNote, useFieldGuidance } from '../guidance/Guidance';
import { OtpBlock, PhoneField, cardWrap, inputBase, label } from './phoneFields';
import { GuardianDeferralBlock } from './GuardianDeferralBlock';
import type { GuardianDeferralReason } from '@features/guardian-verification/guardianVerification';

/**
 * The GUARDIAN step (ADR-213) — who vouches for this tenant.
 *
 * ## Why it left the Identity screen
 *
 * Identity used to carry two subjects at once: the tenant's own record, and
 * their guardian's. They read as one long form but describe different people,
 * and only one of them can stall — the guardian half is the only part of
 * onboarding that depends on somebody who is not in the room. Splitting them
 * means a tenant's own details are saved and finished before anything needing a
 * third party begins, instead of one screen refusing to submit because a parent
 * is not picking up.
 *
 * ## Relation
 *
 * New here. It used to be captured only when a guardian co-signed the
 * agreement, so most tenancies never had one and an owner looking at a number
 * could not tell a mother from an uncle from a family friend. The list is fixed
 * rather than free text, with "Other" carrying its own field, because the point
 * is to be able to group and address people correctly — not to store a sentence.
 */

const RELATIONS = ['Father', 'Mother', 'Guardian', 'Brother', 'Sister', 'Spouse', 'Other'] as const;

export interface GuardianDraft {
  guardian_name: string;
  guardian_relation: string;
  guardian_phone: string;
}

export function GuardianStep({
  draft,
  setDraft,
  tenantName,
  isGuardianPhoneVerified,
  setGuardianOverrideUnlocked,
  guardianOtp,
  setGuardianOtp,
  guardianOtpSent,
  guardianOtpSending,
  guardianOtpCountdown,
  guardianOtpVerifying,
  onSendGuardianOtp,
  onVerifyGuardianOtp,
  onAskGuardianToConfirm,
  askingGuardian,
  guardianRequestSent,
  guardianChased,
  guardianDeadline,
  guardianDeferralReason,
  onGuardianDeferralReasonChange,
  submitting,
  onSubmit,
}: {
  draft: GuardianDraft;
  setDraft: (next: GuardianDraft) => void;
  /** Used in the copy, so the screen names a person rather than "the tenant". */
  tenantName: string;
  isGuardianPhoneVerified: boolean;
  setGuardianOverrideUnlocked: (v: boolean) => void;
  guardianOtp: string;
  setGuardianOtp: (v: string) => void;
  guardianOtpSent: boolean;
  guardianOtpSending: boolean;
  guardianOtpCountdown: number;
  guardianOtpVerifying: boolean;
  onSendGuardianOtp: () => void;
  onVerifyGuardianOtp: () => void;
  onAskGuardianToConfirm: () => void;
  askingGuardian: boolean;
  guardianRequestSent: boolean;
  /** Whether this hostel chases an unverified number — decides what we promise. */
  guardianChased: boolean;
  guardianDeadline: Date | null;
  guardianDeferralReason: GuardianDeferralReason | null;
  onGuardianDeferralReasonChange: (reason: GuardianDeferralReason | null) => void;
  submitting: boolean;
  onSubmit: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const nameGuide = useFieldGuidance('guardian_name');
  const relationGuide = useFieldGuidance('guardian_relation');
  const isOther = draft.guardian_relation !== '' && !RELATIONS.includes(draft.guardian_relation as any);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };

  const isBusy = busy || submitting;
  const who = draft.guardian_name.trim() || 'them';

  return (
    <form onSubmit={handleSubmit} style={{ animation: 'obFade .25s ease' }}>
      <div className="flex items-start gap-[11px]">
        <div
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]"
          style={{ background: '#F3E7E0', color: '#B46A55' }}
        >
          <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </div>
        <div>
          <div className="font-display text-[18px] font-extrabold tracking-tight" style={{ color: FLOW_INK.title }}>
            Parent or Guardian
          </div>
          <div className="mt-1 text-xs leading-relaxed" style={{ color: FLOW_INK.body }}>
            One person the hostel can reach about {tenantName ? `${tenantName}'s` : 'your'} stay — rent,
            and anything urgent.
          </div>
        </div>
      </div>

      <div className="mt-4.5 flex flex-col gap-3.5">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
            Full Name <span style={{ color: '#D0473A' }}>*</span>
          </div>
          <div
            ref={nameGuide.ref}
            className={nameGuide.className}
            style={{ ...cardWrap, border: `1px solid ${nameGuide.invalid ? '#D0473A' : '#E7DDCE'}` }}
          >
            <input
              value={draft.guardian_name}
              onChange={(e) => setDraft({ ...draft, guardian_name: e.target.value })}
              placeholder="Parent or guardian name"
              className="text-sm font-medium"
              style={inputBase}
              {...nameGuide.aria}
            />
          </div>
          <GuidanceNote field="guardian_name" />
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
            Relationship <span style={{ color: '#D0473A' }}>*</span>
          </div>
          <div ref={relationGuide.ref} className={`flex flex-wrap gap-1.5 ${relationGuide.className}`}>
            {RELATIONS.map((relation) => {
              const active =
                relation === 'Other' ? isOther : draft.guardian_relation === relation;
              return (
                <button
                  key={relation}
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, guardian_relation: relation === 'Other' ? ' ' : relation })
                  }
                  aria-pressed={active}
                  className="rounded-[9px] px-3 py-2 text-[12.5px] font-bold transition-colors"
                  style={{
                    background: active ? '#B46A55' : '#F6F1EA',
                    color: active ? '#fff' : '#3A342E',
                    border: `1px solid ${active ? '#B46A55' : '#E7DDCE'}`,
                  }}
                >
                  {relation}
                </button>
              );
            })}
          </div>
          {isOther && (
            <div className="mt-2" style={{ ...cardWrap, border: '1px solid #E7DDCE' }}>
              <input
                autoFocus
                value={draft.guardian_relation.trim()}
                onChange={(e) => setDraft({ ...draft, guardian_relation: e.target.value })}
                placeholder="How are they related?"
                className="text-sm font-medium"
                style={inputBase}
              />
            </div>
          )}
          <GuidanceNote field="guardian_relation" />
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
            Mobile Number <span style={{ color: '#D0473A' }}>*</span>
          </div>
          <PhoneField
            field="guardian_phone"
            value={draft.guardian_phone}
            onChange={(v) => setDraft({ ...draft, guardian_phone: v })}
            placeholder="Guardian mobile number"
            verified={isGuardianPhoneVerified}
            disabled={isGuardianPhoneVerified}
            onSend={onSendGuardianOtp}
            sending={guardianOtpSending}
            countdown={guardianOtpCountdown}
            sent={guardianOtpSent}
          />

          {isGuardianPhoneVerified && (
            <button
              type="button"
              onClick={() => setGuardianOverrideUnlocked(true)}
              className="mt-1.5 text-[11px] font-semibold"
              style={{ color: '#B46A55' }}
            >
              Edit guardian mobile
            </button>
          )}

          {!isGuardianPhoneVerified && guardianOtpSent && (
            <>
              <OtpBlock
                phone={draft.guardian_phone}
                otp={guardianOtp}
                setOtp={setGuardianOtp}
                onResend={onSendGuardianOtp}
                sending={guardianOtpSending}
                countdown={guardianOtpCountdown}
                helperText="We sent a verification code to the guardian's mobile number."
              />
              <button
                type="button"
                disabled={guardianOtpVerifying || guardianOtp.length < 6}
                onClick={onVerifyGuardianOtp}
                className="mt-2.5 w-full rounded-[10px] py-2.5 text-xs font-bold text-white disabled:opacity-60"
                style={{ background: '#1F9D57' }}
              >
                {guardianOtpVerifying ? 'Verifying...' : 'Verify Code'}
              </button>
            </>
          )}

          {/* ADR-212: ask them, or enter the code, or say you can't — in that
              order, and only once there is a number to verify. */}
          {!isGuardianPhoneVerified && draft.guardian_phone.length === 10 && (
            <>
              {guardianRequestSent && (
                <div className="mt-2.5 rounded-[10px] px-3 py-2.5" style={{ background: '#EAF6EF' }}>
                  <div className="text-[12px] font-bold" style={{ color: '#1F7A52' }}>
                    Sent to {who}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: '#4A6B58' }}>
                    They just need to tap &ldquo;Yes, I confirm&rdquo; on WhatsApp. You can carry on —
                    this updates on its own.
                  </p>
                </div>
              )}
              {!guardianOtpSent && !guardianRequestSent && (
                <button
                  type="button"
                  onClick={onAskGuardianToConfirm}
                  disabled={askingGuardian}
                  className="mt-2.5 w-full rounded-[10px] py-2.5 text-xs font-bold text-white disabled:opacity-60"
                  style={{ background: '#B46A55' }}
                >
                  {askingGuardian ? 'Sending…' : `Ask ${who} to confirm`}
                </button>
              )}
              <GuardianDeferralBlock
                guardianName={draft.guardian_name}
                chased={guardianChased}
                deadline={guardianDeadline}
                reason={guardianDeferralReason}
                onReasonChange={onGuardianDeferralReasonChange}
              />
            </>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={isBusy}
        className="mt-5 w-full rounded-[12px] py-3 font-display text-[14px] font-bold text-white disabled:opacity-60"
        style={{ background: '#B46A55', boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
      >
        {isBusy ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}
