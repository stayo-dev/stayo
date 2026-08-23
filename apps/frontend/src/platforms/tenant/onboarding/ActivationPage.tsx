import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { resolveError, toErrorLine } from '@shared/errors';
import { tenantService } from '@features/tenants/api';
import { useAuth } from '@context/AuthContext';
import { StayoLoader } from '@shared/ui/brand';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ActivationLayout } from './ActivationLayout';
import type { ActivationVisualStep } from './ActivationProgress';
import { ActivationIntroScreen } from './ActivationIntroScreen';
import { AgreementStep } from './steps/AgreementStep';
import { WelcomeIdentityStep, type ProfileDraft } from './steps/WelcomeIdentityStep';
import { PasswordActivateStep } from './steps/PasswordActivateStep';
import { WelcomeSummaryStep } from './steps/WelcomeSummaryStep';
import {
  activationMessages,
  clearProfileDraft,
  type ActivationContext,
  type ActivationStep,
  duplicatePhoneMessage,
  invalidPhoneMessage,
  normalizeActivationToken,
  phoneDigits,
  readProfileDraft,
  writeProfileDraft,
} from './activationTypes';
import { buildPrefillPlan } from './onboardingPrefill';

/**
 * Tenant activation flow, redesigned to match `Stayo Onboarding.dc.html`.
 *
 * Replaces `portal/pages/ActivateAccountPage.tsx` as the mounted route
 * component for `/activate`, `/activate/:token`, `/invite/:token` — the
 * second (and final) slice of the `portal → platforms/tenant` extraction
 * that `ActivationLayout.tsx` started: the chrome moved first, the step
 * bodies move here. All business logic (validation, OTP flows, signature/
 * photo upload, the draft-save effect, the activation-progress simulation,
 * the post-activate session hand-off) is carried over unchanged from the
 * legacy page — only the presentation and file layout changed. See the
 * onboarding-wiring plan for the full design ↔ backend step mapping.
 */
export function ActivationPage() {
  const { token: pathToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = normalizeActivationToken(pathToken || searchParams.get('token'));
  const navigate = useNavigate();
  const { login } = useAuth();

  const [ctx, setCtx] = useState<ActivationContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [invalidCode, setInvalidCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [screen, setScreen] = useState<'intro' | 'wizard'>('intro');
  const [visibleStep, setVisibleStep] = useState<ActivationStep | null>(null);
  const [activationProgress, setActivationProgress] = useState(0);
  const [profileDraftReady, setProfileDraftReady] = useState(false);
  const [profileDraftStatus, setProfileDraftStatus] = useState<'idle' | 'restored' | 'saving' | 'saved'>('idle');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [paymentFrequency, setPaymentFrequency] = useState('MONTHLY');
  const [welcomeLocalPhase, setWelcomeLocalPhase] = useState<'welcome' | 'identity'>('welcome');
  /** Last ACCOUNT-submit failure, surfaced inline under the OTP box (design's `otpError` row). */
  const [accountOtpError, setAccountOtpError] = useState('');
  /** The tenant tapped "Change" on the verified mobile — a fresh OTP is now due. */
  const [phoneEdited, setPhoneEdited] = useState(false);

  const [account, setAccount] = useState({ password: '', confirm_password: '', phone: '', otp: '', email: '' });
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);

  const [guardianOtpSent, setGuardianOtpSent] = useState(false);
  const [guardianOtpSending, setGuardianOtpSending] = useState(false);
  const [guardianOtpCountdown, setGuardianOtpCountdown] = useState(0);
  const [guardianOtp, setGuardianOtp] = useState('');
  const [guardianOtpVerified, setGuardianOtpVerified] = useState(false);
  const [guardianVerifiedPhone, setGuardianVerifiedPhone] = useState('');
  const [guardianOtpVerifying, setGuardianOtpVerifying] = useState(false);
  const [guardianOverrideUnlocked, setGuardianOverrideUnlocked] = useState(false);

  const [profile, setProfile] = useState<ProfileDraft>({
    phone: '',
    gender: '',
    date_of_birth: '',
    profile_type: 'STUDENT',
    guardian_name: '',
    guardian_phone: '',
    guardian_relation: '',
    emergency_phone: '',
  });
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string>('');

  // Post-ACTIVATE: hold the session result and show the Step 5 celebration
  // screen before actually handing off the session and navigating — the
  // legacy page navigated immediately, this adds the design's summary beat.
  const [activationResult, setActivationResult] = useState<{ session: any; redirect_to?: string } | null>(null);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = window.setTimeout(() => setOtpCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [otpCountdown]);

  useEffect(() => {
    if (guardianOtpCountdown <= 0) return;
    const timer = window.setTimeout(() => setGuardianOtpCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [guardianOtpCountdown]);

  const loadContext = async () => {
    if (!token) {
      setInvalid(true);
      setChecking(false);
      return;
    }
    setChecking(true);
    setProfileDraftReady(false);
    try {
      const data = await tenantService.getActivationContext(token);
      const draft = readProfileDraft(token);
      setCtx(data);
      setPaymentFrequency(String(data?.tenant?.payment_frequency || 'MONTHLY'));
      setProfilePhotoPreview(String(data.tenant?.photo_url || draft?.photoUrl || ''));
      setInvalid(false);
      setInvalidCode('');
      setError('');
      setAccount((prev) => ({
        ...prev,
        // The tenancy's own number wins: the owner invited this person on the
        // number they are reachable on *now*, and the portable profile may
        // still hold an older one. When the two differ, `buildKnown` reports
        // `phone_verified: false`, so the field stays editable with an OTP box
        // rather than silently reverting the tenancy to a stale number.
        phone: prev.phone || phoneDigits(data.tenant?.phone_1 || data.known?.phone || data.profile?.phone),
        email: prev.email || String(data.known?.email || data.profile?.email || ''),
      }));

      // Seed the editable inputs from the person's own portable record first,
      // then fall back to the tenancy snapshot the owner typed. Without this
      // the "we already know these" panel showed a date of birth and gender
      // that the form underneath it did not actually hold, and submit failed
      // on "Gender is required".
      const knownIdentity = (data.known?.identity || {}) as Record<string, unknown>;
      // `profile_identity.date_of_birth` can arrive as a full ISO timestamp;
      // `<input type="date">` only accepts `YYYY-MM-DD`.
      const knownDob = String(knownIdentity.date_of_birth || '').slice(0, 10);
      const backendProfile: ProfileDraft = {
        phone: phoneDigits(data.tenant?.phone_1 || data.known?.phone || data.profile?.phone),
        gender: String(knownIdentity.gender || data.tenant?.gender || ''),
        date_of_birth: knownDob || String(data.tenant?.date_of_birth || ''),
        profile_type: String(knownIdentity.profile_type || data.tenant?.profile_type || 'STUDENT'),
        guardian_name: String(
          knownIdentity.guardian_name || data.tenant?.guardian_name || data.agreement?.guardian_signature_name || ''
        ),
        guardian_phone: phoneDigits(knownIdentity.guardian_phone || data.tenant?.guardian_phone || data.tenant?.phone_2),
        guardian_relation: String(
          knownIdentity.guardian_relation || data.tenant?.guardian_relation || data.agreement?.guardian_relation || ''
        ),
        emergency_phone: phoneDigits(data.tenant?.phone_3),
      };
      const mergedProfile: ProfileDraft = {
        ...backendProfile,
        ...(data.activation_state?.profile_completed ? {} : (draft?.profile as Partial<ProfileDraft>) || {}),
      };
      setProfile(mergedProfile);

      const backendGuardianPhone = phoneDigits(data.tenant?.guardian_phone || data.tenant?.phone_2 || '');
      if (backendGuardianPhone) {
        setGuardianOtpVerified(true);
        setGuardianVerifiedPhone(backendGuardianPhone);
      } else if (draft?.guardianOtpVerified) {
        setGuardianOtpVerified(true);
        setGuardianVerifiedPhone(draft.guardianVerifiedPhone || '');
      }

      if (data.activation_state?.profile_completed) clearProfileDraft(token);
      setProfileDraftStatus(draft && !data.activation_state?.profile_completed ? 'restored' : 'idle');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'This invitation link has expired or was already used.';
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code || '';
      setInvalid(true);
      setInvalidCode(code);
      setError(message);
    } finally {
      setProfileDraftReady(true);
      setChecking(false);
    }
  };

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const currentStep = ctx?.current_step ?? ctx?.activation_state?.current_step;
  const completed = new Set(ctx?.completed_steps ?? ctx?.activation_state?.completed_steps ?? []);
  const activeStep = (visibleStep || currentStep) as ActivationStep | undefined;
  const isStudent = String(profile.profile_type || ctx?.tenant?.profile_type || 'STUDENT').toUpperCase() === 'STUDENT';
  const prefillPlan = buildPrefillPlan({
    known: ctx?.known,
    profileType: isStudent ? 'STUDENT' : 'WORKING_PROFESSIONAL',
    // "Change" records intent, not a change. Retyping the same verified number
    // is not an edit, and the server would not demand an OTP for it — so don't
    // latch the tenant into an OTP box the server will ignore.
    phoneEdited: phoneEdited && phoneDigits(account.phone) !== phoneDigits(ctx?.known?.phone),
  });
  const activationStageIndex = activationProgress < 40 ? 0 : activationProgress < 78 ? 1 : 2;
  const activationProgressWidth = `${Math.max(8, Math.round(activationProgress))}%`;

  useEffect(() => {
    setVisibleStep(null);
  }, [ctx?.current_step, ctx?.activation_state?.current_step]);

  useEffect(() => {
    if (!(submitting && activeStep === 'ACTIVATE')) {
      setActivationProgress(0);
      return;
    }
    const startedAt = Date.now();
    setActivationProgress(8);
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const next = elapsed < 1800 ? 8 + (elapsed / 1800) * 32 : elapsed < 4600 ? 40 + ((elapsed - 1800) / 2800) * 38 : 78 + Math.min(((elapsed - 4600) / 6500) * 16, 16);
      setActivationProgress(next);
    }, 250);
    return () => window.clearInterval(timer);
  }, [activeStep, submitting]);

  useEffect(() => {
    if (!token || !ctx || !profileDraftReady || ctx.activation_state?.profile_completed) return;
    if (activeStep !== 'ACCOUNT' && activeStep !== 'PROFILE') return;
    setProfileDraftStatus('saving');
    const timer = window.setTimeout(() => {
      writeProfileDraft(token, {
        profile,
        selectedCollege: '',
        selectedCourse: '',
        photoUrl: /^https?:\/\//.test(profilePhotoPreview) ? profilePhotoPreview : '',
        guardianOtpVerified,
        guardianVerifiedPhone,
      });
      setProfileDraftStatus('saved');
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeStep, ctx, profile, profileDraftReady, profilePhotoPreview, token, guardianOtpVerified, guardianVerifiedPhone]);

  const goToStep = (step: ActivationStep) => {
    const targetStep = step === 'RULES' ? 'AGREEMENT' : step;
    if (targetStep === currentStep || completed.has(targetStep)) {
      setError('');
      setVisibleStep(targetStep);
    }
  };

  const lastStepErrorRef = useRef('');

  const submitStep = async (step: ActivationStep, data: Record<string, unknown>) => {
    setSubmitting(true);
    setError('');
    lastStepErrorRef.current = '';
    try {
      const result = await tenantService.updateActivationWorkflow({ token, step, data });
      if (step === 'ACTIVATE') {
        setActivationResult({ session: (result as any)?.session, redirect_to: (result as any)?.redirect_to });
        return true;
      }
      setCtx(result as ActivationContext);
      setVisibleStep(null);
      return true;
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Could not save this step';
      lastStepErrorRef.current = message;
      setError(message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const enterStayo = async () => {
    setEntering(true);
    const session = activationResult?.session;
    if (session?.access_token && session?.refresh_token) {
      try {
        const { supabase } = await import('@lib/supabaseClient');
        const { queryClient } = await import('@lib/queryClient');
        queryClient.clear();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (sessionError) throw sessionError;
        navigate('/tenant/home', { replace: true });
        return;
      } catch {
        navigate('/login?signin=1', { replace: true });
        return;
      }
    }

    const submittedPassword = account.password;
    const email = ctx?.profile?.email || (ctx?.profile?.phone ? `${ctx.profile.phone}@hms.temp` : ctx?.tenant?.phone_1 ? `${ctx.tenant.phone_1}@hms.temp` : '');
    if (submittedPassword && email) {
      try {
        await login(email, submittedPassword);
        navigate('/tenant/home', { replace: true });
        return;
      } catch {
        navigate('/login?signin=1', { replace: true });
        return;
      }
    }
    navigate(activationResult?.redirect_to || '/login?signin=1', { replace: true });
  };

  const handleSendOtp = async () => {
    const phone = account.phone.trim();
    if (!phone) return setError('Please enter your primary mobile number first.');
    setOtpSending(true);
    setError('');
    try {
      await tenantService.sendPhoneOtp({ phone, purpose: 'Registration' });
      setOtpSent(true);
      setOtpCountdown(60);
    } catch (err: any) {
      setError(toErrorLine(resolveError(err, 'activation')));
    } finally {
      setOtpSending(false);
    }
  };

  const submitAccount = async (): Promise<boolean> => {
    setAccountOtpError('');
    const emailVal = (account.email || '').trim().toLowerCase();
    if (!emailVal) {
      setError('An email address is required');
      return false;
    }
    // Any real address, not just Gmail: the owner may well have invited this
    // person on a college or work address, and rejecting it made them retype a
    // perfectly good one.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) {
      setError('Please enter a valid email address');
      return false;
    }
    const ok = await submitStep('ACCOUNT', account);
    if (!ok) setAccountOtpError(lastStepErrorRef.current || 'Incorrect code — please try again');
    return ok;
  };

  const handleSendGuardianOtp = async () => {
    const phone = (profile.guardian_phone || '').trim();
    if (!phone) return setError('Please enter a parent/guardian mobile number first.');
    const invalidMessage = invalidPhoneMessage({ guardian: phone }, ['guardian']);
    if (invalidMessage) return setError(invalidMessage);
    const duplicateMessage = duplicatePhoneMessage({ primary: profile.phone, guardian: phone });
    if (duplicateMessage) return setError(duplicateMessage);

    setGuardianOtpSending(true);
    setError('');
    try {
      await tenantService.sendPhoneOtp({ phone, purpose: 'ParentVerify' });
      setGuardianOtpSent(true);
      setGuardianOtpCountdown(60);
    } catch (err: any) {
      setError(toErrorLine(resolveError(err, 'activation')));
    } finally {
      setGuardianOtpSending(false);
    }
  };

  const handleVerifyGuardianOtp = async () => {
    const phone = (profile.guardian_phone || '').trim();
    if (!phone) return setError('Please enter a parent/guardian mobile number.');
    if (guardianOtp.length < 6) return setError('Please enter the 6-digit verification code.');
    setGuardianOtpVerifying(true);
    setError('');
    try {
      await tenantService.verifyPhoneOtp({ phone, otp: guardianOtp, purpose: 'ParentVerify' });
      setGuardianOtpVerified(true);
      setGuardianVerifiedPhone(phone);
      setGuardianOverrideUnlocked(false);
    } catch (err: any) {
      setError(toErrorLine(resolveError(err, 'activation')));
    } finally {
      setGuardianOtpVerifying(false);
    }
  };

  const isGuardianPhoneVerified =
    !guardianOverrideUnlocked &&
    Boolean(profile.guardian_phone) &&
    ((ctx?.tenant?.guardian_phone && profile.guardian_phone === phoneDigits(ctx?.tenant?.guardian_phone) && ctx?.verification_status?.guardian_verified) ||
      (ctx?.tenant?.phone_2 && profile.guardian_phone === phoneDigits(ctx?.tenant?.phone_2) && ctx?.verification_status?.guardian_verified) ||
      (guardianOtpVerified && profile.guardian_phone === guardianVerifiedPhone));

  const handlePhotoChange = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError('Image must be under 2MB');
    setProfilePhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setProfilePhotoPreview(reader.result as string);
    reader.readAsDataURL(file);

    setPhotoUploading(true);
    setError('');
    try {
      const uploadRes = await tenantService.uploadActivationPhoto(token, file);
      if (uploadRes?.photo_url) {
        setProfilePhotoPreview(uploadRes.photo_url);
        setProfilePhotoFile(null);
        writeProfileDraft(token, {
          profile,
          selectedCollege: '',
          selectedCourse: '',
          photoUrl: uploadRes.photo_url,
          guardianOtpVerified,
          guardianVerifiedPhone,
        });
        setProfileDraftStatus('saved');
      }
    } catch (err: any) {
      setError(toErrorLine(resolveError(err, 'activation')));
    } finally {
      setPhotoUploading(false);
    }
  };

  const submitProfile = async (): Promise<boolean> => {
    if (isStudent) {
      if (!profile.guardian_name?.trim()) {
        setError('Parent/Guardian name is required.');
        return false;
      }
      if (!profile.guardian_phone) {
        setError('Parent/Guardian phone number is required.');
        return false;
      }
    }
    const invalidMessage = invalidPhoneMessage({ primary: profile.phone, guardian: profile.guardian_phone }, ['primary', 'guardian']);
    if (invalidMessage) {
      setError(invalidMessage);
      return false;
    }
    const duplicateMessage = duplicatePhoneMessage({ primary: profile.phone, guardian: profile.guardian_phone });
    if (duplicateMessage) {
      setError(duplicateMessage);
      return false;
    }
    if ((isStudent || profile.guardian_phone) && !isGuardianPhoneVerified) {
      setError('Please verify the parent/guardian phone number first.');
      return false;
    }
    if (!profilePhotoFile && !profilePhotoPreview) {
      setError('Profile photo is required');
      return false;
    }

    setSubmitting(true);
    setError('');
    try {
      let photoUrl = profilePhotoPreview;
      if (profilePhotoFile) {
        const uploadRes = await tenantService.uploadActivationPhoto(token, profilePhotoFile);
        if (uploadRes?.photo_url) photoUrl = uploadRes.photo_url;
      }
      const saved = await submitStep('PROFILE', { ...profile, photo_url: photoUrl, guardian_otp: guardianOtp });
      if (saved) {
        clearProfileDraft(token);
        setProfileDraftStatus('idle');
      }
      return saved;
    } catch (err: any) {
      setError(toErrorLine(resolveError(err, 'activation')));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <ThemeProvider theme="product">
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[340px_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="h-14 w-14 rounded-2xl bg-muted animate-pulse" />
            <div className="mt-5 h-3 rounded bg-muted animate-pulse" />
            <div className="mt-3 h-24 rounded-xl bg-muted animate-pulse" />
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <StayoLoader size="lg" className="text-accent" />
            <p className="mt-4 text-sm font-medium text-foreground">Loading your setup</p>
            <p className="mt-1 text-sm text-muted-foreground">Checking the latest activation state...</p>
          </div>
        </div>
      </div>
      </ThemeProvider>
    );
  }

  if (invalid || !ctx) {
    const title =
      invalidCode === 'ALREADY_ACTIVE' ? 'Account already active' : invalidCode === 'EXPIRED' ? 'Invitation expired' : invalidCode === 'CANCELLED' ? 'Invitation cancelled' : 'Invitation unavailable';
    return (
      <ThemeProvider theme="product">
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertTriangle className="w-7 h-7" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{error || 'This activation link has expired or was already used.'}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={loadContext} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold">
            Retry
          </button>
          <Link to="/login?signin=1" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
            Go to login
          </Link>
        </div>
      </div>
      </ThemeProvider>
    );
  }

  if (screen === 'intro') {
    return (
      <ThemeProvider theme="product">
        <ActivationIntroScreen
          hostelName={ctx.hostel.name || 'Stayo'}
          hostelLogoUrl={ctx.hostel.logo_url}
          tenantFirstName={(ctx.profile?.name || '').split(' ')[0]}
          roomNumber={ctx.room_summary.room_number as any}
          monthlyRent={ctx.room_summary.monthly_rent as any}
          moveInLabel={ctx.room_summary.joining_date ? new Date(String(ctx.room_summary.joining_date)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : undefined}
          onBeginAdmission={() => setScreen('wizard')}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme="product">
    <ActivationLayout
      activeStep={
        activationResult
          ? 'MOVE_IN'
          : (((activeStep || ctx.activation_state?.current_step || 'ACCOUNT') === 'ACCOUNT' && welcomeLocalPhase === 'identity'
              ? 'PROFILE'
              : activeStep || ctx.activation_state?.current_step || 'ACCOUNT') as ActivationVisualStep)
      }
      currentStep={activationResult ? 'MOVE_IN' : ((currentStep || 'ACCOUNT') as ActivationVisualStep)}
      completedSteps={new Set(activationResult ? ['ACCOUNT', 'RULES', 'AGREEMENT', 'PROFILE', 'ACTIVATE'] : ctx.activation_state?.completed_steps || [])}
      onStepClick={(step) => goToStep(step as ActivationStep)}
      agreementRequired={ctx.activation_state?.agreement_required !== false}
      hostelName={ctx.hostel.name || 'Stayo'}
      hostelLogoUrl={ctx.hostel.logo_url}
      gender={profile.gender}
      error={error}
      onDismissError={() => setError('')}
    >
        {activationResult && <WelcomeSummaryStep ctx={ctx} tenantName={ctx.agreement?.tenant_signature_name || ctx.profile?.name || ''} entering={entering} onEnter={enterStayo} />}

        {!activationResult && (activeStep === 'ACCOUNT' || activeStep === 'PROFILE') && (
          <WelcomeIdentityStep
            ctx={ctx}
            activeStep={activeStep}
            accountVerified={Boolean(ctx.activation_state?.account_setup_completed)}
            profileCompleted={completed.has('PROFILE') || Boolean(ctx.activation_state?.profile_completed)}
            account={account}
            setAccount={setAccount}
            otpSent={otpSent}
            otpSending={otpSending}
            otpCountdown={otpCountdown}
            onSendOtp={handleSendOtp}
            paymentFrequency={paymentFrequency}
            setPaymentFrequency={setPaymentFrequency}
            profile={profile}
            setProfile={setProfile}
            isGuardianPhoneVerified={Boolean(isGuardianPhoneVerified)}
            setGuardianOverrideUnlocked={setGuardianOverrideUnlocked}
            guardianOtp={guardianOtp}
            setGuardianOtp={setGuardianOtp}
            guardianOtpSent={guardianOtpSent}
            guardianOtpSending={guardianOtpSending}
            guardianOtpCountdown={guardianOtpCountdown}
            guardianOtpVerifying={guardianOtpVerifying}
            onSendGuardianOtp={handleSendGuardianOtp}
            onVerifyGuardianOtp={handleVerifyGuardianOtp}
            profileDraftStatus={profileDraftStatus}
            profilePhotoPreview={profilePhotoPreview}
            profilePhotoFile={profilePhotoFile}
            photoUploading={photoUploading}
            onPhotoChange={handlePhotoChange}
            submitting={submitting}
            onSubmitAccount={submitAccount}
            onSubmitProfile={submitProfile}
            goToStep={goToStep}
            stageCount={ctx.activation_state?.agreement_required === false ? 4 : 5}
            otpError={accountOtpError}
            onExitToIntro={() => setScreen('intro')}
            localPhase={welcomeLocalPhase}
            setLocalPhase={setWelcomeLocalPhase}
            prefill={prefillPlan}
            onUnlockPhone={() => setPhoneEdited(true)}
          />
        )}

        {!activationResult && (activeStep === 'RULES' || activeStep === 'AGREEMENT') && (
          <AgreementStep
            ctx={ctx}
            completedSteps={completed}
            submitting={submitting}
            guardianName={profile.guardian_name}
            guardianRelation={profile.guardian_relation}
            onGuardianSigned={(name, relation) => setProfile({ ...profile, guardian_name: name, guardian_relation: relation })}
            onAcceptRules={(data) => submitStep('RULES', data)}
            onSubmitAgreement={(data) => submitStep('AGREEMENT', data)}
            uploadSignature={(file, type) => tenantService.uploadActivationSignature(token, file, type)}
            goToStep={goToStep}
            onError={setError}
          />
        )}

        {!activationResult && activeStep === 'ACTIVATE' && (
          <PasswordActivateStep
            password={account.password}
            setPassword={(v) => setAccount({ ...account, password: v })}
            confirmPassword={account.confirm_password}
            setConfirmPassword={(v) => setAccount({ ...account, confirm_password: v })}
            submitting={submitting}
            activationProgressWidth={activationProgressWidth}
            activationMessage={activationMessages[activationStageIndex]}
            goToStep={goToStep}
            onActivate={() =>
              submitStep('ACTIVATE', {
                password: account.password,
                confirm_password: account.confirm_password,
                payment_frequency: paymentFrequency,
              })
            }
          />
        )}
    </ActivationLayout>
    </ThemeProvider>
  );
}
