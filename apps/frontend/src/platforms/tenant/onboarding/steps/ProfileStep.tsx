import { FormEvent } from 'react';
import { Camera, CheckCircle2, Lock, ShieldCheck, Unlock } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationStep } from '../activationTypes';
import { guardianRelations } from '../activationTypes';
import { fieldClass } from './stepStyles';
import { BackButton, Field, FormGroup, PrimaryButton, SectionHeading } from './shared';

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

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

/**
 * Step 3 — "Identity Profile": gender/DOB/guardian+OTP/emergency contact/
 * photo. Maps to the backend's `PROFILE` step. Matches the design source's
 * field set closely — address/college/office fields are deliberately not
 * collected here (the legacy page never asked for them at this step either;
 * the backend's `saveProfile` doesn't require them, and they're completed
 * later from the tenant portal).
 */
interface ProfileStepProps {
  profile: ProfileDraft;
  setProfile: (next: ProfileDraft) => void;
  isStudent: boolean;
  isGuardianLocked: boolean;
  setIsGuardianLocked: (v: boolean) => void;
  isGuardianPhoneVerified: boolean;
  guardianOverrideUnlocked: boolean;
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
  completedSteps: Set<string>;
  goToStep: (step: ActivationStep) => void;
  onSubmit: (e: FormEvent) => void;
}

export function ProfileStep({
  profile,
  setProfile,
  isStudent,
  isGuardianLocked,
  setIsGuardianLocked,
  isGuardianPhoneVerified,
  guardianOverrideUnlocked,
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
  completedSteps,
  goToStep,
  onSubmit,
}: ProfileStepProps) {
  const footer = (
    <div className="flex gap-2">
      <BackButton title="Back to Agreement" onClick={() => goToStep('AGREEMENT')} />
      {completedSteps.has('PROFILE') ? (
        <button
          type="button"
          onClick={() => goToStep('ACTIVATE')}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
        >
          Proceed to Activation
        </button>
      ) : (
        <PrimaryButton loading={submitting || photoUploading}>{photoUploading ? 'Uploading photo...' : 'Verify identity'}</PrimaryButton>
      )}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5 pb-24">
      <SectionHeading icon={<ShieldCheck className="w-5 h-5" />} title="Verify your identity" text="Just a few quick fields — we'll collect address and academic details after activation." />

      <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-xs font-semibold text-muted-foreground">
        {profileDraftStatus === 'saving' ? (
          <>
            <StayoLoader size="sm" className="text-primary" label={null} />
            Saving draft...
          </>
        ) : profileDraftStatus === 'restored' ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" />
            Draft restored from this device
          </>
        ) : profileDraftStatus === 'saved' ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" />
            Draft saved locally
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" />
            Saved steps are synced to your account
          </>
        )}
      </div>

      <FormGroup title="Personal details">
        <div className="grid gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Profile type *</span>
            <select value={profile.profile_type} onChange={(e) => setProfile({ ...profile, profile_type: e.target.value })} className={fieldClass}>
              <option value="STUDENT">Student</option>
              <option value="WORKING_PROFESSIONAL">Working professional</option>
            </select>
          </label>
          <Field label="Date of birth" required type="date" value={profile.date_of_birth} onChange={(v) => setProfile({ ...profile, date_of_birth: v })} />
          <div className="block">
            <span className="text-xs font-semibold text-muted-foreground">Gender *</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setProfile({ ...profile, gender: g })}
                  className={`rounded-full border px-4 py-2 text-xs font-bold transition-all ${
                    profile.gender === g ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-secondary/50'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </FormGroup>

      <FormGroup title="Guardian details">
        <div className="rounded-2xl border border-border bg-secondary/10 p-4.5 space-y-4 shadow-sm">
          {isGuardianLocked && profile.guardian_name && profile.guardian_relation ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card rounded-xl p-3 border border-border/60">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Guardian Details</span>
                <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                  {profile.guardian_name}
                  <span className="text-xs font-normal text-muted-foreground">({profile.guardian_relation})</span>
                </h4>
                <p className="text-[11px] text-muted-foreground">Synced and locked from agreement signing.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsGuardianLocked(false)}
                className="shrink-0 text-xs font-semibold text-primary hover:underline flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-secondary/40 transition cursor-pointer"
              >
                Modify details
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {!isGuardianLocked && profile.guardian_name && profile.guardian_relation && (
                <div className="flex items-center justify-between rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Unlock className="w-3.5 h-3.5 animate-pulse" />
                    Editing details updates all stages.
                  </span>
                  <button type="button" onClick={() => setIsGuardianLocked(true)} className="font-bold underline">
                    Lock
                  </button>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Guardian name" value={profile.guardian_name || ''} onChange={(v) => setProfile({ ...profile, guardian_name: v })} />
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground">Guardian relation</span>
                  <select value={profile.guardian_relation || ''} onChange={(e) => setProfile({ ...profile, guardian_relation: e.target.value })} className={fieldClass}>
                    <option value="">Select relation</option>
                    {guardianRelations.map((relation) => (
                      <option key={relation} value={relation}>
                        {relation}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          <div className="border-t border-border/60 pt-3.5 space-y-3">
            <div className="block">
              <span className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                <span>Guardian phone {isStudent && <span className="text-destructive">*</span>}</span>
                {isGuardianPhoneVerified && (
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-success bg-success/10 px-1.5 py-0.5 rounded">
                      <CheckCircle2 className="w-3 h-3" /> Verified
                    </span>
                    <button type="button" onClick={() => setGuardianOverrideUnlocked(true)} className="text-[11px] text-primary hover:underline font-semibold cursor-pointer">
                      Edit
                    </button>
                  </span>
                )}
              </span>
              <div className="flex gap-2 mt-1.5">
                <input
                  type="tel"
                  disabled={isGuardianPhoneVerified}
                  value={profile.guardian_phone || ''}
                  onChange={(e) => setProfile({ ...profile, guardian_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  placeholder="e.g. 98765 43210"
                  className={`${fieldClass} mt-0 flex-1`}
                />
              </div>
              {!isGuardianPhoneVerified && profile.guardian_phone && profile.guardian_phone.length === 10 && (
                <button
                  type="button"
                  disabled={guardianOtpSending || guardianOtpCountdown > 0}
                  onClick={onSendGuardianOtp}
                  className="w-full mt-2 px-4 py-3 text-sm font-bold bg-primary text-primary-foreground rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-all shadow-sm"
                >
                  {guardianOtpSending ? 'Sending...' : guardianOtpCountdown > 0 ? `Resend in ${guardianOtpCountdown}s` : guardianOtpSent ? 'Resend code' : 'Send Verification Code'}
                </button>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">{isStudent ? 'Mandatory mobile number for parent/guardian.' : 'Use a valid 10-digit mobile number if provided.'}</p>
            </div>

            {!isGuardianPhoneVerified && guardianOtpSent && (
              <div className="block mt-3 bg-card border border-border/80 rounded-xl p-3.5 shadow-inner">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-primary" />
                  Guardian Verification Code *
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={guardianOtp}
                  onChange={(e) => setGuardianOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit code"
                  className={`${fieldClass} mt-1.5 tracking-widest text-center font-bold text-lg`}
                />
                <button
                  type="button"
                  disabled={guardianOtpVerifying || guardianOtp.length < 6}
                  onClick={onVerifyGuardianOtp}
                  className="w-full mt-2 px-4 py-3 text-sm font-bold bg-success text-success-foreground rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all shadow-sm"
                >
                  {guardianOtpVerifying ? 'Verifying...' : 'Verify Code'}
                </button>
                <p className="mt-1.5 text-[11px] text-muted-foreground">We sent a verification code to the guardian's mobile number.</p>
              </div>
            )}
          </div>
        </div>
      </FormGroup>

      <FormGroup title="Emergency contact details">
        <div className="rounded-2xl border border-border bg-secondary/10 p-4.5 shadow-sm space-y-3">
          <div className="block">
            <span className="text-xs font-semibold text-muted-foreground">
              Emergency contact (Mobile) <span className="text-destructive">*</span>
            </span>
            <input
              type="tel"
              value={profile.emergency_phone || ''}
              onChange={(e) => setProfile({ ...profile, emergency_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder="e.g. +91 98765 43210"
              className={`${fieldClass} mt-1.5`}
            />
            <p className="text-[11px] text-muted-foreground mt-1">Must be valid and different from primary and guardian numbers.</p>
          </div>
        </div>
      </FormGroup>

      <FormGroup title="Photo verification">
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3 cursor-pointer hover:bg-secondary/50 transition-colors">
          <div className={`w-11 h-11 rounded-full overflow-hidden bg-secondary flex items-center justify-center shrink-0 ${profilePhotoPreview ? 'ring-2 ring-primary ring-offset-1' : 'ring-1 ring-border'}`}>
            {profilePhotoPreview ? <img src={profilePhotoPreview} alt="Profile preview" className="w-full h-full object-cover" /> : <Camera className="w-4 h-4 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            {photoUploading ? (
              <p className="text-xs font-medium text-primary">Uploading...</p>
            ) : profilePhotoFile ? (
              <p className="text-xs text-primary font-medium truncate">{profilePhotoFile.name}</p>
            ) : !profilePhotoFile && /^https?:\/\//.test(profilePhotoPreview) ? (
              <p className="text-xs text-success font-medium">✓ Photo uploaded</p>
            ) : (
              <p className="text-xs text-muted-foreground">Upload photo *</p>
            )}
          </div>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPhotoChange(e.target.files?.[0])} />
          <span className="text-xs font-semibold text-primary shrink-0">{profilePhotoPreview ? 'Change' : 'Choose'}</span>
        </label>
      </FormGroup>

      <div className="rounded-xl border border-info/20 bg-info/5 p-2.5 text-xs text-info flex items-start gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>Address, academic, and work details can be completed later from your tenant portal.</p>
      </div>

      {footer}
    </form>
  );
}
