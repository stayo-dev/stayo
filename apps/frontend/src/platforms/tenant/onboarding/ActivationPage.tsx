import { useEffect, useMemo, useRef, useState } from 'react';
import type { GuardianDeferralReason } from '@features/guardian-verification/guardianVerification';
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
import { GuardianStep } from './steps/GuardianStep';
import { WelcomeIdentityStep, type ProfileDraft } from './steps/WelcomeIdentityStep';
import { PasswordActivateStep } from './steps/PasswordActivateStep';
import { WelcomeSummaryStep } from './steps/WelcomeSummaryStep';
import { useEmailVerification } from './useEmailVerification';
import { kycDocLabel, missingKycDocs, type OnboardingDocItem } from './onboardingKyc';
import { prepareImageForUpload } from './compressImage';
import { isImage, uploadProblem } from './uploadImagePolicy';
import { Guidance } from './guidance/Guidance';
import { guardianIssues, identityIssues, passwordIssues } from './guidance/stepIssues';
import {
  activationMessages,
  clearProfileDraft,
  type ActivationContext,
  type ActivationStep,
  duplicatePhoneMessage,
  invalidPhoneMessage,
  normalizeActivationToken,
  phoneDigits,
  activationDraftKey,
  readProfileDraft,
  writeProfileDraft,
} from './activationTypes';

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
  // A tenant who claimed their tenancy arrives here with no token at all --
  // their invitation was superseded at adoption, so the link is dead by
  // design and the session is the credential instead. Every call below still
  // passes `token`; when it is empty the backend resolves the session. See
  // ADR-155.
  const [draftKey, setDraftKey] = useState('');
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
  // KYC documents collected on the Identity step (auto-upload, PENDING, never
  // blocks onboarding on owner approval).
  const [docItems, setDocItems] = useState<OnboardingDocItem[]>([]);
  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [welcomeLocalPhase, setWelcomeLocalPhase] = useState<'welcome' | 'identity'>('welcome');
  /** Last ACCOUNT-submit failure, surfaced inline under the OTP box (design's `otpError` row). */
  const [accountOtpError, setAccountOtpError] = useState('');

  const [account, setAccount] = useState({ password: '', confirm_password: '', phone: '', otp: '', email: '' });
  const emailVerification = useEmailVerification(token, ctx?.email_requirement);
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
  // ADR-212 — the guardian-side confirmation, and the deferral that replaces
  // the old hard gate.
  const [askingGuardian, setAskingGuardian] = useState(false);
  const [guardianRequestSent, setGuardianRequestSent] = useState(false);
  const [guardianDeferralReason, setGuardianDeferralReason] = useState<GuardianDeferralReason | null>(null);
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
    // No early bail on a missing token: a claimed tenant legitimately has
    // none, and only the backend can say whether their session stands in for
    // one. A request with neither still comes back VALIDATION_ERROR and lands
    // on the same "unavailable" screen as before.
    setChecking(true);
    setProfileDraftReady(false);
    try {
      const data = await tenantService.getActivationContext(token);
      const key = activationDraftKey(token, data?.tenant?.id);
      setDraftKey(key);
      const draft = readProfileDraft(key);
      setCtx(data);
      setPaymentFrequency(String(data?.tenant?.payment_frequency || 'MONTHLY'));
      setDocItems(Array.isArray(data?.documents?.items) ? data.documents.items : []);
      setProfilePhotoPreview(String(data.tenant?.photo_url || draft?.photoUrl || ''));
      setInvalid(false);
      setInvalidCode('');
      setError('');
      setAccount((prev) => ({
        ...prev,
        phone: prev.phone || phoneDigits(data.tenant?.phone_1 || data.profile?.phone),
        // An address already proved for this invitation first, then whatever
        // the owner typed at invite — editable, and confirmed by a code
        // either way. Never the `@hms.temp` stand-in: the server no longer
        // returns it.
        email: prev.email || String(data.email_requirement?.email || data.profile?.email || ''),
      }));

      const backendProfile: ProfileDraft = {
        phone: phoneDigits(data.tenant?.phone_1 || data.profile?.phone),
        // Falls back to what the hostel's own type establishes, so the progress
        // avatar is right even though the Identity screen never asks. See
        // identity-field-policy on the server.
        gender: String(data.tenant?.gender || data.identity_fields?.value || ''),
        date_of_birth: String(data.tenant?.date_of_birth || ''),
        profile_type: String(data.tenant?.profile_type || 'STUDENT'),
        guardian_name: String(data.tenant?.guardian_name || data.agreement?.guardian_signature_name || ''),
        guardian_phone: phoneDigits(data.tenant?.guardian_phone || data.tenant?.phone_2),
        guardian_relation: String(data.tenant?.guardian_relation || data.agreement?.guardian_relation || ''),
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

      if (data.activation_state?.profile_completed) clearProfileDraft(key);
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
    if (!draftKey || !ctx || !profileDraftReady || ctx.activation_state?.profile_completed) return;
    if (activeStep !== 'ACCOUNT' && activeStep !== 'PROFILE') return;
    setProfileDraftStatus('saving');
    const timer = window.setTimeout(() => {
      writeProfileDraft(draftKey, {
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
  }, [activeStep, ctx, profile, profileDraftReady, profilePhotoPreview, draftKey, guardianOtpVerified, guardianVerifiedPhone]);

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
    // The email is collected again — mandatory, and proved with a code before
    // this is enabled (see steps/emailVerification). The server checks the
    // proof itself; `account.email` is the address it will look up.
    const ok = await submitStep('ACCOUNT', account);
    if (!ok) setAccountOtpError(lastStepErrorRef.current || 'Incorrect code — please try again');
    return ok;
  };

  /**
   * Ask the guardian to confirm, instead of making the tenant relay a code
   * (ADR-212).
   *
   * Falls back to the OTP path rather than erroring when the WhatsApp template
   * is not live yet — Meta's approval has a lead time, and "we can't do that
   * right now" is a worse answer than the one that has always worked.
   */
  /**
   * Whether this hostel chases an unverified guardian number, and the date it
   * would ask again. Both come from the server (ADR-212) — the screen renders
   * the promise, it does not compute it, so what a tenant is told and what
   * actually happens cannot drift apart.
   *
   * The deadline is derived here rather than read back, because it has to be
   * shown at the moment of deferring — before anything has been saved and
   * therefore before any deadline exists on the record.
   */
  const guardianChased = ctx?.verification_status?.guardian_chased ?? true;
  const guardianDeadline = useMemo(() => {
    const stored = ctx?.verification_status?.guardian_deadline_at;
    if (stored) return new Date(stored);
    if (!guardianChased) return null;
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date;
  }, [ctx?.verification_status?.guardian_deadline_at, guardianChased]);

  const handleAskGuardianToConfirm = async () => {
    const phone = (profile.guardian_phone || '').trim();
    if (!phone) return setError('Please enter a parent/guardian mobile number first.');
    const invalidMessage = invalidPhoneMessage({ guardian: phone }, ['guardian']);
    if (invalidMessage) return setError(invalidMessage);
    const duplicateMessage = duplicatePhoneMessage({ primary: profile.phone, guardian: phone });
    if (duplicateMessage) return setError(duplicateMessage);

    setAskingGuardian(true);
    setError('');
    try {
      /*
        Saved first, because the message names the guardian and the resident and
        reads both back off the tenancy — a number typed but not yet submitted
        would otherwise send a message about the previous one.

        The failure is deliberately swallowed rather than surfaced: the PROFILE
        step validates the *whole* form, so a tenant who has filled in their
        guardian but not yet their photo would be shown an unrelated complaint
        about a photo when all they asked for was a confirmation message.
        Swallowing it is only safe because the request itself carries the number
        on screen and the backend refuses to send if it does not match what was
        actually stored — so a failed save produces a clear "save your details
        first", never a message to the wrong handset.
      */
      await tenantService.updateActivationWorkflow({
        token,
        step: 'PROFILE',
        data: { ...profile, guardian_verification_deferred_reason: null },
      }).catch(() => undefined);

      const result = await tenantService.sendGuardianConfirmRequest({ token, guardianPhone: phone });
      if (result?.fallback_to_otp) {
        await handleSendGuardianOtp();
        return;
      }
      setGuardianRequestSent(true);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not reach your guardian. Try the code instead.');
    } finally {
      setAskingGuardian(false);
    }
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

  /**
   * Everything the Identity step can still be missing, in one place — fed to
   * `<Guidance>` so the step can point at whichever of it is outstanding.
   * Computed here because this is where the state lives; the rules themselves
   * are in guidance/stepIssues.ts.
   */
  const identityState = {
    showAccountFields: activeStep === 'ACCOUNT',
    phone: account.phone,
    otp: account.otp,
    otpSent,
    phoneTrust: ctx?.phone_trust ?? null,
    emailRequirement: ctx?.email_requirement ?? null,
    email: account.email,
    emailVerifiedAs: emailVerification.verifiedAs ?? null,
    genderRequired: ctx?.identity_fields?.required ?? true,
    gender: profile.gender || '',
    dateOfBirth: profile.date_of_birth || '',
    profileType: String(profile.profile_type || ctx?.tenant?.profile_type || 'STUDENT'),
    photoUploaded: Boolean(profilePhotoFile || profilePhotoPreview),
    docItems,
  };

  /**
   * The GUARDIAN step's guidance (ADR-213). Separate from `identityState`
   * because guidance has to move with the fields it describes — leaving the
   * guardian rules on Identity is what made Continue report things left to do
   * and then scroll to controls that were no longer on screen.
   */
  const guardianState = {
    name: profile.guardian_name || '',
    relation: profile.guardian_relation || '',
    phone: profile.guardian_phone || '',
    verified: Boolean(isGuardianPhoneVerified),
    deferralReason: guardianDeferralReason,
  };

  /**
   * Photo and KYC uploads compress on the device first, then check the result
   * against the server's limits — never the other way round. Checking the raw
   * file first refused every ordinary camera photo (3-8MB) against the 2MB
   * photo limit before compression could run. See uploadImagePolicy.ts.
   */
  const handlePhotoChange = async (file?: File) => {
    if (!file) return;
    if (!isImage(file.type)) return setError(uploadProblem(file, 'photo') || 'Choose a photo');

    setPhotoUploading(true);
    setError('');
    try {
      const ready = await prepareImageForUpload(file, 'photo');
      const problem = uploadProblem(ready, 'photo');
      if (problem) {
        setError(problem);
        return;
      }
      // Kept as the compressed file, so the retry in submitProfile() sends this and not the camera original.
      setProfilePhotoFile(ready);
      const reader = new FileReader();
      reader.onloadend = () => setProfilePhotoPreview(reader.result as string);
      reader.readAsDataURL(ready);

      const uploadRes = await tenantService.uploadActivationPhoto(token, ready);
      if (uploadRes?.photo_url) {
        setProfilePhotoPreview(uploadRes.photo_url);
        setProfilePhotoFile(null);
        writeProfileDraft(draftKey, {
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

  const handleDocUpload = async (docType: string, file?: File) => {
    if (!file) return;
    const setDocError = (message: string) => setDocErrors((prev) => ({ ...prev, [docType]: message }));
    if (!isImage(file.type) && file.type !== 'application/pdf') {
      setDocError(uploadProblem(file, 'document') || 'Use a photo of the document, or a PDF.');
      return;
    }
    setDocErrors((prev) => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });
    setDocUploading(docType);
    try {
      const ready = await prepareImageForUpload(file, 'document');
      const problem = uploadProblem(ready, 'document');
      if (problem) {
        setDocError(problem);
        return;
      }
      const uploadRes = await tenantService.uploadActivationDocument(token, docType, ready);
      setDocItems((prev) => {
        const updated = [...prev];
        const index = updated.findIndex((d) => d.doc_type === docType);
        if (index >= 0) {
          updated[index] = { ...updated[index], document_status: uploadRes?.document_status || 'PENDING' };
        }
        return updated;
      });
    } catch (err: any) {
      setDocError(
        err?.response
          ? err.response.data?.error?.message || 'Upload failed — please try again'
          : "The upload didn't finish — check your connection and try again.",
      );
    } finally {
      setDocUploading(null);
    }
  };

  /**
   * The GUARDIAN step (ADR-213). Validates the three fields this screen owns,
   * then sends them plus whatever verification evidence exists — a code if one
   * was entered, a deferral reason if the tenant said they could not.
   */
  const submitGuardian = async (): Promise<boolean> => {
    if (!profile.guardian_name?.trim()) {
      setError('Parent/Guardian name is required.');
      return false;
    }
    if (!profile.guardian_relation?.trim()) {
      setError('Tell us how they are related to you.');
      return false;
    }
    if (!profile.guardian_phone) {
      setError('Parent/Guardian phone number is required.');
      return false;
    }
    const invalidGuardian = invalidPhoneMessage({ guardian: profile.guardian_phone }, ['guardian']);
    if (invalidGuardian) {
      setError(invalidGuardian);
      return false;
    }
    const duplicateMessage = duplicatePhoneMessage({ primary: profile.phone, guardian: profile.guardian_phone });
    if (duplicateMessage) {
      setError(duplicateMessage);
      return false;
    }
    /**
     * ADR-212. Unverified is no longer a dead end — but it is still not the
     * default way through. The tenant has to have *said* they cannot do it now,
     * which is one deliberate tap rather than a form they can submit past
     * without noticing the question.
     *
     * The message names the way out rather than only the obstacle. "Verify
     * first" was true and useless to someone whose parent was not answering.
     */
    if (!isGuardianPhoneVerified && !guardianDeferralReason) {
      setError('Verify the parent/guardian number, or tell us why it can’t be confirmed right now.');
      return false;
    }

    setSubmitting(true);
    setError('');
    try {
      return await submitStep('GUARDIAN', {
        guardian_name: profile.guardian_name,
        guardian_relation: profile.guardian_relation,
        guardian_phone: profile.guardian_phone,
        guardian_otp: guardianOtp,
        // Sent only when the tenant actually chose to defer — the backend reads
        // its absence as "no deferral this time", which is what stops a later
        // save re-stamping a clock that already started.
        ...(guardianDeferralReason ? { guardian_verification_deferred_reason: guardianDeferralReason } : {}),
      });
    } catch (err: any) {
      setError(toErrorLine(resolveError(err, 'activation')));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const submitProfile = async (): Promise<boolean> => {
    // ADR-213: the guardian moved to its own step, so this screen validates the
    // tenant's own record and nothing else. The primary number is still checked
    // here; the guardian number is checked where it is now entered.
    const invalidMessage = invalidPhoneMessage({ primary: profile.phone }, ['primary']);
    if (invalidMessage) {
      setError(invalidMessage);
      return false;
    }
    if (!profilePhotoFile && !profilePhotoPreview) {
      setError('Profile photo is required');
      return false;
    }
    // Documents must be uploaded to continue — but only uploaded. Owner
    // verification runs separately and never blocks onboarding.
    const missingDocs = missingKycDocs(profile.profile_type, docItems);
    if (missingDocs.length > 0) {
      setError(`Please upload your ${missingDocs.map(kycDocLabel).join(' and ')} to continue.`);
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
      const saved = await submitStep('PROFILE', { ...profile, photo_url: photoUrl });
      if (saved) {
        clearProfileDraft(draftKey);
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
      linkExpiresAt={ctx.link_expiry?.expires_at ?? null}
      linkHeld={ctx.link_expiry?.held ?? false}
      completedSteps={new Set(activationResult ? ['ACCOUNT', 'RULES', 'AGREEMENT', 'PROFILE', 'ACTIVATE'] : ctx.activation_state?.completed_steps || [])}
      onStepClick={(step) => goToStep(step as ActivationStep)}
      agreementRequired={ctx.activation_state?.agreement_required !== false}
      guardianRequired={ctx.activation_state?.guardian_required !== false}
      hostelName={ctx.hostel.name || 'Stayo'}
      hostelLogoUrl={ctx.hostel.logo_url}
      gender={profile.gender}
      error={error}
      onDismissError={() => setError('')}
    >
        {activationResult && <WelcomeSummaryStep ctx={ctx} tenantName={ctx.agreement?.tenant_signature_name || ctx.profile?.name || ''} entering={entering} onEnter={enterStayo} />}

        {!activationResult && (activeStep === 'ACCOUNT' || activeStep === 'PROFILE') && (
          <Guidance issues={welcomeLocalPhase === 'identity' || activeStep === 'PROFILE' ? identityIssues(identityState) : []}>
          <WelcomeIdentityStep
            ctx={ctx}
            activeStep={activeStep}
            accountVerified={Boolean(ctx.activation_state?.account_setup_completed)}
            phoneTrust={ctx.phone_trust ?? null}
            emailRequirement={ctx.email_requirement ?? null}
            emailVerification={emailVerification}
            genderRequired={ctx.identity_fields?.required ?? true}
            profileCompleted={completed.has('PROFILE') || Boolean(ctx.activation_state?.profile_completed)}
            account={account}
            setAccount={setAccount}
            otpSent={otpSent}
            otpSending={otpSending}
            otpCountdown={otpCountdown}
            onSendOtp={handleSendOtp}
            paymentFrequency={paymentFrequency}
            docItems={docItems}
            docUploading={docUploading}
            docErrors={docErrors}
            onDocUpload={handleDocUpload}
            profile={profile}
            setProfile={setProfile}
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
          />
          </Guidance>
        )}

        {!activationResult && activeStep === 'GUARDIAN' && (
          <Guidance issues={guardianIssues(guardianState)}>
            <GuardianStep
              draft={{
                guardian_name: profile.guardian_name || '',
                guardian_relation: profile.guardian_relation || '',
                guardian_phone: profile.guardian_phone || '',
              }}
              setDraft={(next) => setProfile({ ...profile, ...next })}
              tenantName={ctx?.profile?.name || ''}
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
              onAskGuardianToConfirm={handleAskGuardianToConfirm}
              askingGuardian={askingGuardian}
              guardianRequestSent={guardianRequestSent}
              guardianChased={guardianChased}
              guardianDeadline={guardianDeadline}
              guardianDeferralReason={guardianDeferralReason}
              onGuardianDeferralReasonChange={setGuardianDeferralReason}
              submitting={submitting}
              onSubmit={submitGuardian}
              onBack={() => goToStep('PROFILE')}
            />
          </Guidance>
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
          <Guidance issues={passwordIssues({ password: account.password, confirm: account.confirm_password })}>
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
          </Guidance>
        )}
    </ActivationLayout>
    </ThemeProvider>
  );
}
