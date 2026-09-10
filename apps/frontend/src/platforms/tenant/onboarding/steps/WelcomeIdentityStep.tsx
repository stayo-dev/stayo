import { FormEvent, useState } from 'react';
import { canSubmitIdentity, needsPhoneOtp, type PhoneTrust } from './identityVerification';
import DateOfBirthField from './DateOfBirthField';
import { useSky } from '../skyContext';
import { AlertCircle, Camera, CheckCircle2, FileText, Receipt, Send } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationContext, ActivationStep } from '../activationTypes';
import { currency, fmtDate } from '../activationTypes';
import { kycDocLabel, requiredKycDocTypes, type OnboardingDocItem } from '../onboardingKyc';
import { BackButton, PrimaryActionButton, StepActionBar } from './shared';

export type ProfileDraft = {
  phone: string;
  gender: string;
  date_of_birth: string;
  profile_type: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_relation: string;
  emergency_phone: string;
};

const GENDERS = ['Male', 'Female', 'Other'];

/**
 * Steps 1+2 — "Welcome" and "Identity", merged into one component. ADR-070:
 * matches `stayo onbaording/Stayo Onboarding.dc.html` (a second, newer design
 * source superseding `Stayo SaaS redesign/`'s version this wizard was first
 * built against), where the Welcome screen drops to Room Allocation +
 * Billing Cycle only, and mobile/OTP/Gmail verification moves into a
 * combined Identity screen alongside the profile-photo/gender/DOB/guardian/
 * emergency fields — Identity now precedes Agreement.
 *
 * Backend-wise, `ACCOUNT` and `PROFILE` remain two distinct, independently
 * gated steps (`activation-workflow-service.ts`'s `assertTransition()`) —
 * this component renders for either `activeStep`, the same one-component-
 * two-backend-steps pattern `AgreementStep.tsx` already uses for
 * `RULES`+`AGREEMENT`. First time through: a local `welcome`/`identity`
 * phase (no backend call) lets the tenant view Room+Billing before Identity;
 * submitting Identity chains `onSubmitAccount()` then `onSubmitProfile()`
 * behind one tap, mirroring `AgreementStep`'s `onAcceptRules` →
 * `onSubmitAgreement` chain. Once `ACCOUNT` is actually persisted,
 * `ctx.current_step` advances to `PROFILE` server-side and this component
 * re-renders showing only the Identity fields (mobile/OTP/Gmail are done,
 * hidden) — safe to resume mid-flow after a reload or a failed Profile
 * submit.
 */
interface WelcomeIdentityStepProps {
  ctx: ActivationContext;
  activeStep: 'ACCOUNT' | 'PROFILE';
  accountVerified: boolean;
  profileCompleted: boolean;
  account: { phone: string; otp: string; email: string };
  setAccount: (next: { phone: string; otp: string; email: string; password: string; confirm_password: string }) => void;
  otpSent: boolean;
  otpSending: boolean;
  otpCountdown: number;
  onSendOtp: () => void;
  /** Owner-set at invite time — shown read-only, never chosen here. */
  paymentFrequency: string;
  /** KYC documents collected on the Identity step (auto-upload, PENDING, never blocks onboarding). */
  docItems: OnboardingDocItem[];
  docUploading: string | null;
  docErrors: Record<string, string>;
  onDocUpload: (docType: string, file?: File) => void;
  profile: ProfileDraft;
  setProfile: (next: ProfileDraft) => void;
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
  profileDraftStatus: 'idle' | 'restored' | 'saving' | 'saved';
  profilePhotoPreview: string;
  profilePhotoFile: File | null;
  photoUploading: boolean;
  onPhotoChange: (file?: File) => void;
  submitting: boolean;
  /** What the invitation proved about the number, from the activation context. */
  phoneTrust?: PhoneTrust | null;
  /**
   * Whether the gender selector must be rendered. False when the hostel's own
   * type already establishes it (a boys'/girls' hostel answered the question by
   * admitting the person) — resolved server-side, see identity-field-policy.
   */
  genderRequired?: boolean;
  onSubmitAccount: () => Promise<boolean>;
  onSubmitProfile: () => Promise<boolean>;
  goToStep: (step: ActivationStep) => void;
  /** Total visual stages — 4 when the hostel has `agreement_required: false`. */
  stageCount: number;
  /** Inline OTP failure from the last ACCOUNT submit, shown under the code box. */
  otpError?: string;
  /** Step 1's back tile leaves the wizard for the intro splash, per the design. */
  onExitToIntro: () => void;
  /**
   * Lifted to the parent (rather than local state) so `ActivationPage` can
   * feed the 'identity' phase into `ActivationProgress`'s `activeStep` — the
   * journey track otherwise has no way to know this component silently
   * switched screens, since the backend step stays `ACCOUNT` until submit.
   */
  localPhase: 'welcome' | 'identity';
  setLocalPhase: (phase: 'welcome' | 'identity') => void;
}

const label = { color: '#7A6F63', letterSpacing: '.05em' };
const cardWrap = { background: '#F6F1EA', borderRadius: 10, border: '1px solid #E7DDCE', padding: '0 13px' };
const inputBase = { width: '100%', border: 'none', outline: 'none', background: 'transparent', color: '#2A2521', padding: '11px 0' };

function PhoneField({
  value,
  onChange,
  placeholder,
  verified,
  disabled,
  onSend,
  sending,
  countdown,
  sent,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  verified: boolean;
  disabled?: boolean;
  onSend: () => void;
  sending: boolean;
  countdown: number;
  sent: boolean;
}) {
  const mobileValid = value.length === 10;
  const border = verified ? '#1F9D57' : mobileValid ? '#B46A55' : '#E7DDCE';
  return (
    <div className="flex items-center gap-2.5" style={{ ...cardWrap, border: `1.5px solid ${border}`, transition: 'border-color .2s' }}>
      <span className="flex-none text-sm font-bold" style={{ color: '#8A7F75' }}>
        +91
      </span>
      <div className="h-5 w-px flex-none" style={{ background: '#E0D5C6' }} />
      <input
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        placeholder={placeholder}
        disabled={disabled || (sent && countdown > 0)}
        className="min-w-0 flex-1 text-sm font-semibold"
        style={inputBase}
      />
      {verified ? (
        <div className="flex flex-none items-center gap-1.5 text-[11px] font-extrabold" style={{ color: '#1F7A52' }}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: '#1F9D57' }}>
            <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={2.6} />
          </span>
          Verified
        </div>
      ) : mobileValid ? (
        <button
          type="button"
          onClick={onSend}
          disabled={sending || countdown > 0}
          className="flex flex-none items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          style={{ background: '#B46A55', boxShadow: '0 4px 11px rgba(180,106,85,.28)' }}
        >
          <Send className="h-3 w-3" />
          {sending ? 'Sending' : countdown > 0 ? `${countdown}s` : sent ? 'Resend' : 'Send'}
        </button>
      ) : null}
    </div>
  );
}

function OtpBlock({
  phone,
  otp,
  setOtp,
  onResend,
  sending,
  countdown,
  helperText,
  error,
}: {
  phone: string;
  otp: string;
  setOtp: (v: string) => void;
  onResend: () => void;
  sending: boolean;
  countdown: number;
  helperText: string;
  /** Server-side verification failure, shown inline under the box per the design. */
  error?: string;
}) {
  const borderColor = error ? '#D0473A' : otp.length === 6 ? '#1F9D57' : '#E7DDCE';
  return (
    <div className="ob-up-fast mt-2.5 rounded-[11px]" style={{ background: '#FBF7F1', border: '1px solid #EEE3D4', padding: '12px 13px' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: '#1F7A52' }}>
          <Send className="h-3 w-3" />
          Code sent to +91 {phone}
        </span>
        <button type="button" onClick={onResend} disabled={sending || countdown > 0} className="font-display text-[11.5px] font-bold disabled:opacity-60" style={{ color: '#A45D44' }}>
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend'}
        </button>
      </div>
      <div className="mt-2.5 text-xs font-semibold" style={{ color: '#3A342E' }}>
        Enter 6-digit code
      </div>
      <div className="mt-1.5 flex items-center rounded-[10px] bg-white" style={{ border: `1.5px solid ${borderColor}`, padding: '0 14px', transition: 'border-color .2s' }}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="— — — — — —"
          className="font-display w-full text-center text-[17px] font-bold"
          style={{ ...inputBase, letterSpacing: '.4em' }}
        />
      </div>
      {error ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: '#D0473A' }}>
          <AlertCircle className="h-3 w-3 flex-none" />
          {error}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] font-medium" style={{ color: '#9A8F84' }}>
          {helperText}
        </div>
      )}
    </div>
  );
}

export function WelcomeIdentityStep({
  ctx,
  activeStep,
  accountVerified,
  phoneTrust,
  genderRequired = true,
  profileCompleted,
  account,
  setAccount,
  otpSent,
  otpSending,
  otpCountdown,
  onSendOtp,
  paymentFrequency,
  docItems,
  docUploading,
  docErrors,
  onDocUpload,
  profile,
  setProfile,
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
  profileDraftStatus,
  profilePhotoPreview,
  profilePhotoFile,
  photoUploading,
  onPhotoChange,
  submitting,
  onSubmitAccount,
  onSubmitProfile,
  goToStep,
  stageCount,
  otpError,
  onExitToIntro,
  localPhase,
  setLocalPhase,
}: WelcomeIdentityStepProps) {
  const [busy, setBusy] = useState(false);
  const sky = useSky();
  // Shadows the module-level constant: these labels sit directly on the sky
  // gradient, so their colour has to follow the hour rather than assume cream.
  const label = { color: sky.onSkyLabel, letterSpacing: '.05em' };

  const allocation = [
    { label: 'Room', value: ctx.room_summary.room_number || 'Assigned' },
    { label: 'Rent', value: currency(ctx.room_summary.monthly_rent) },
    { label: 'Joins', value: fmtDate(ctx.room_summary.joining_date) },
  ];

  const roomAllocationCard = (
    <div className="mt-4 rounded-[13px] p-[14px_13px]" style={{ background: '#F6F1EA' }}>
      <div className="flex items-center justify-between gap-2.5 border-b pb-2.5" style={{ borderColor: '#E4DACB' }}>
        <span className="text-[11px] font-extrabold uppercase" style={{ color: '#7A6F63', letterSpacing: '.05em' }}>
          Room Allocation
        </span>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ background: '#D6EEDF', color: '#1F7A52' }}>
          Reserved
        </span>
      </div>
      <div className="mt-2.5 flex gap-2">
        {allocation.map((a) => (
          <div key={a.label} className="flex-1 rounded-[10px] p-[10px_6px] text-center" style={{ background: '#fff', border: '1px solid #EDE3D5' }}>
            <div className="text-[9px] font-bold uppercase leading-tight" style={{ color: '#9A8F84', letterSpacing: '.03em' }}>
              {a.label}
            </div>
            <div className="font-display mt-1 text-sm font-extrabold" style={{ color: '#1A1A1A' }}>
              {a.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Read-only: the billing cycle is set by the owner at invite time. Shown as
  // information — no dropdown, no choice to make here.
  const FREQUENCY_LABEL: Record<string, string> = {
    MONTHLY: 'Monthly',
    QUARTERLY: 'Every 3 months',
    HALF_YEARLY: 'Every 6 months',
    ACADEMIC_YEARLY: 'Yearly',
  };
  const billingCard = (
    <div className="mt-4">
      <div
        className="flex items-center gap-2.5 rounded-[10px] p-[11px_13px]"
        style={{ background: '#F6F1EA', borderLeft: '3px solid #B46A55' }}
      >
        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg" style={{ background: '#F3E7E0', color: '#B46A55' }}>
          <Receipt className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase" style={{ color: '#7A6F63', letterSpacing: '.05em' }}>
            Billing cycle
          </div>
          <div className="font-display mt-0.5 text-sm font-extrabold" style={{ color: '#2A2521' }}>
            {FREQUENCY_LABEL[paymentFrequency] || paymentFrequency}
          </div>
        </div>
      </div>
    </div>
  );

  // --- activeStep === 'PROFILE', or local 'identity' phase pre-ACCOUNT ---
  const isStudent = String(profile.profile_type || ctx.tenant?.profile_type || 'STUDENT').toUpperCase() === 'STUDENT';
  const requiredMark = <span style={{ color: '#D0473A' }}>*</span>;
  const optionalMark = <span className="font-medium normal-case" style={{ color: '#9A8F84' }}>(optional)</span>;
  const requiredDocs = requiredKycDocTypes(profile.profile_type);

  const renderIdentity = (showAccountFields: boolean) => {
    const handleSubmit = async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      try {
        if (showAccountFields) {
          const ok = await onSubmitAccount();
          if (!ok) return;
        }
        await onSubmitProfile();
      } finally {
        setBusy(false);
      }
    };
    const isBusy = busy || submitting;
    // A number the invitation was delivered to needs no code; editing it
    // re-arms verification. See identityVerification.
    const otpRequired = showAccountFields && needsPhoneOtp({ enteredPhone: account.phone, trust: phoneTrust });
    const canSubmit = showAccountFields
      ? canSubmitIdentity({ enteredPhone: account.phone, trust: phoneTrust, otp: account.otp, otpSent })
      : true;

    return (
      <form onSubmit={handleSubmit} style={{ animation: 'obFade .25s ease' }}>
        <div className="flex items-start gap-[11px]">
          <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]" style={{ background: '#F3E7E0', color: '#B46A55' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 20c0-4 3.8-6 7.5-6s7.5 2 7.5 6" />
            </svg>
          </div>
          <div>
            <div
              className="font-display text-[18px] font-extrabold tracking-tight"
              style={{ color: sky.onSkyTitle, textShadow: sky.onSkyShadow }}
            >
              Identity Profile
            </div>
            <div className="mt-1 text-xs leading-relaxed" style={{ color: sky.onSkyBody }}>
              Confirm your details to complete the admission record.
            </div>
          </div>
        </div>

        {/* Profile photo — circular avatar + edit badge */}
        <div className="mt-4.5 flex flex-col items-center gap-2.5">
          <label className="relative cursor-pointer" style={{ width: 88, height: 88 }}>
            <div className="h-full w-full overflow-hidden rounded-full" style={{ padding: 3, background: 'linear-gradient(135deg,#B46A55,#D2986C)' }}>
              {profilePhotoPreview ? (
                <img src={profilePhotoPreview} alt="Profile" className="h-full w-full rounded-full object-cover" />
              ) : (
                /* Empty state is the bare gradient disc — the design leaves this slot filled, not hollow. */
                <div className="h-full w-full rounded-full" />
              )}
            </div>
            <span
              className="absolute flex items-center justify-center rounded-full"
              style={{ bottom: -2, right: -2, width: 28, height: 28, background: '#B46A55', border: '3px solid #fff', boxShadow: '0 3px 8px rgba(180,106,85,.4)' }}
            >
              <Camera className="h-3.5 w-3.5 text-white" />
            </span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPhotoChange(e.target.files?.[0])} />
          </label>
          <div className="text-center">
            <div className="text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
              Profile Photo {requiredMark}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: '#8A7F75' }}>
              {photoUploading
                ? 'Uploading…'
                : profilePhotoFile
                  ? profilePhotoFile.name
                  : /^https?:\/\//.test(profilePhotoPreview)
                    ? '✓ Photo uploaded — tap to change'
                    : 'Tap to upload — helps staff recognise you'}
            </div>
          </div>
        </div>

        {showAccountFields && (
          <>
            <div className="mt-4">
              <div className="text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
                Primary Mobile <span style={{ color: '#D0473A' }}>*</span>
              </div>
              <div className="mt-1.5">
                <PhoneField
                  value={account.phone}
                  onChange={(v) => setAccount({ ...account, phone: v })}
                  placeholder="10-digit mobile number"
                  verified={accountVerified || !otpRequired}
                  onSend={onSendOtp}
                  sending={otpSending}
                  countdown={otpCountdown}
                  sent={otpSent}
                />
              </div>
              {!otpRequired && (
                <div className="mt-1.5 text-[11.5px] font-medium" style={{ color: '#8A7F75' }}>
                  This is the number your invitation was sent to. Edit it and we'll send a code to confirm the new one.
                </div>
              )}
              {otpRequired && account.phone.length > 0 && account.phone.length < 10 && (
                <div className="mt-1.5 text-[11.5px] font-medium" style={{ color: '#8A7F75' }}>
                  {10 - account.phone.length} more digit{10 - account.phone.length === 1 ? '' : 's'} to verify
                </div>
              )}
              {otpRequired && otpSent && (
                <OtpBlock
                  phone={account.phone}
                  otp={account.otp}
                  setOtp={(v) => setAccount({ ...account, otp: v })}
                  onResend={onSendOtp}
                  sending={otpSending}
                  countdown={otpCountdown}
                  helperText="We sent a verification code to your mobile number."
                  error={otpError}
                />
              )}
            </div>

            {/*
              The Gmail ID field was here. It asked for an address we already
              hold — from the account this invitation belongs to, or from the
              invitation itself — and writing it back over `profiles.email`
              meant this screen could change the invitee's *login*. Leaving it
              as it was is what produced "An account with this email address
              already exists". The backend derives it now.
            */}
          </>
        )}

        <div className="mt-4 flex flex-col gap-3.5">
          {genderRequired && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
              Gender {requiredMark}
            </div>
            <div className="flex gap-2">
              {GENDERS.map((g) => {
                const on = profile.gender === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setProfile({ ...profile, gender: g })}
                    className="flex-1 rounded-[10px] px-1.5 py-2.5 text-center text-[12.5px] font-semibold"
                    style={{ background: on ? '#F3E7E0' : '#F6F1EA', border: on ? '1.5px solid #B46A55' : '1px solid #E7DDCE', color: on ? '#A45D44' : '#4A433C' }}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
              Date of Birth {requiredMark}
            </div>
            <DateOfBirthField
              value={profile.date_of_birth}
              onChange={(iso) => setProfile({ ...profile, date_of_birth: iso })}
            />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
              Guardian Full Name {isStudent ? requiredMark : optionalMark}
            </div>
            <div style={cardWrap}>
              <input
                value={profile.guardian_name || ''}
                onChange={(e) => setProfile({ ...profile, guardian_name: e.target.value })}
                placeholder="Parent or guardian name"
                className="text-sm font-medium"
                style={inputBase}
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
              Guardian Mobile {isStudent ? requiredMark : optionalMark}
            </div>
            <PhoneField
              value={profile.guardian_phone || ''}
              onChange={(v) => setProfile({ ...profile, guardian_phone: v })}
              placeholder="Guardian mobile number"
              verified={isGuardianPhoneVerified}
              disabled={isGuardianPhoneVerified}
              onSend={onSendGuardianOtp}
              sending={guardianOtpSending}
              countdown={guardianOtpCountdown}
              sent={guardianOtpSent}
            />
            {isGuardianPhoneVerified && (
              <button type="button" onClick={() => setGuardianOverrideUnlocked(true)} className="mt-1.5 text-[11px] font-semibold" style={{ color: '#B46A55' }}>
                Edit guardian mobile
              </button>
            )}
            {!isGuardianPhoneVerified && guardianOtpSent && (
              <>
                <OtpBlock
                  phone={profile.guardian_phone || ''}
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
          </div>

        </div>

        {/* Documents — auto-upload on pick, land PENDING, never wait for owner approval. */}
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-bold uppercase" style={label}>
            Documents
          </div>
          <div className="mb-2 text-[11px] leading-relaxed" style={{ color: sky.onSkyBody }}>
            Required for admission — your hostel verifies these separately.
          </div>
          <div className="flex flex-col gap-2">
            {requiredDocs.map((docType) => {
              const item = docItems.find((d) => String(d.doc_type).toUpperCase() === docType);
              const status = String(item?.document_status || 'MISSING').toUpperCase();
              const uploading = docUploading === docType;
              const err = docErrors[docType];
              const verified = status === 'APPROVED' || status === 'VERIFIED';
              const pending = status === 'PENDING';
              const rejected = status === 'REJECTED';
              const tone = verified || pending ? '#1F7A52' : rejected ? '#D0473A' : '#B46A55';
              return (
                <label key={docType} className="flex cursor-pointer items-center gap-2.5" style={{ ...cardWrap, padding: '10px 13px' }}>
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg" style={{ background: '#F3E7E0', color: tone }}>
                    {uploading ? <StayoLoader size="sm" label={null} /> : <FileText className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
                      {kycDocLabel(docType)} {requiredMark}
                    </div>
                    <div className="mt-0.5 text-[11px] font-semibold" style={{ color: tone }}>
                      {uploading
                        ? 'Uploading…'
                        : verified
                          ? '✓ Verified'
                          : pending
                            ? '✓ Uploaded · Pending verification'
                            : rejected
                              ? `Rejected${item?.rejection_reason ? ` — ${item.rejection_reason}` : ''}`
                              : 'Not uploaded yet'}
                    </div>
                    {err && (
                      <div className="mt-0.5 text-[11px] font-semibold" style={{ color: '#D0473A' }}>
                        {err}
                      </div>
                    )}
                  </div>
                  <span className="flex-none text-[11px] font-bold" style={{ color: '#A45D44' }}>
                    {rejected ? 'Upload again' : verified || pending ? 'Replace' : 'Upload'}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      onDocUpload(docType, file);
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>

        {(profileDraftStatus === 'restored' || profileDraftStatus === 'saving') && (
          <div className="mt-3.5 text-[11px] leading-relaxed" style={{ color: '#8A7F75' }}>
            {profileDraftStatus === 'restored' ? 'Draft restored from this device.' : 'Saving draft…'}
          </div>
        )}

        <StepActionBar>
          {showAccountFields ? (
            <BackButton title="Back to Welcome" onClick={() => setLocalPhase('welcome')} />
          ) : (
            <BackButton title="Back to Welcome" onClick={() => goToStep('ACCOUNT')} />
          )}
          <PrimaryActionButton type="submit" disabled={isBusy || photoUploading || !canSubmit}>
            {(isBusy || photoUploading) && <StayoLoader size="sm" label={null} />}
            {photoUploading ? 'Uploading photo…' : isBusy ? 'Saving…' : 'Verify & Continue'}
          </PrimaryActionButton>
        </StepActionBar>
      </form>
    );
  };

  // --- activeStep === 'ACCOUNT', account already verified (user looking back) ---
  if (activeStep === 'ACCOUNT' && accountVerified) {
    return (
      <div style={{ animation: 'obFade .25s ease' }}>
        <p className="font-display text-[10px] font-extrabold uppercase" style={{ color: sky.greetAccent, letterSpacing: '.1em' }}>
          Step 1 of {stageCount}
        </p>
        <h2
          className="font-display mt-1.5 text-[19px] font-extrabold leading-tight tracking-tight"
          style={{ color: sky.onSkyTitle, textShadow: sky.onSkyShadow }}
        >
          Welcome to Stayo
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: sky.onSkyBody }}>
          Confirm your stay details and billing preference to begin.
        </p>
        {roomAllocationCard}
        {billingCard}
        <StepActionBar>
          <BackButton title="Back to the welcome screen" onClick={onExitToIntro} />
          <PrimaryActionButton onClick={() => goToStep(profileCompleted ? 'AGREEMENT' : 'PROFILE')}>Continue</PrimaryActionButton>
        </StepActionBar>
      </div>
    );
  }

  // --- activeStep === 'ACCOUNT', fresh flow, local phase ---
  if (activeStep === 'ACCOUNT' && localPhase === 'welcome') {
    return (
      <div style={{ animation: 'obFade .25s ease' }}>
        <p className="font-display text-[10px] font-extrabold uppercase" style={{ color: sky.greetAccent, letterSpacing: '.1em' }}>
          Step 1 of {stageCount}
        </p>
        <h2
          className="font-display mt-1.5 text-[19px] font-extrabold leading-tight tracking-tight"
          style={{ color: sky.onSkyTitle, textShadow: sky.onSkyShadow }}
        >
          Welcome to Stayo
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: sky.onSkyBody }}>
          Confirm your stay details and billing preference to begin.
        </p>
        {roomAllocationCard}
        {billingCard}
        <StepActionBar>
          <BackButton title="Back to the welcome screen" onClick={onExitToIntro} />
          <PrimaryActionButton onClick={() => setLocalPhase('identity')}>Continue</PrimaryActionButton>
        </StepActionBar>
      </div>
    );
  }

  // activeStep === 'ACCOUNT' && localPhase === 'identity' (showAccountFields=true),
  // or activeStep === 'PROFILE' (showAccountFields=false, account already verified)
  return renderIdentity(activeStep === 'ACCOUNT');
}
