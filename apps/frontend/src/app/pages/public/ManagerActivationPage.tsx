import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { AlertTriangle, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { managerInvitationApi } from '@features/managers/api/invitationApi';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { resolveError, toErrorLine } from '@shared/errors';
import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  PASSWORD_CRITERIA,
  PASSWORD_STRENGTH_LABEL,
  evaluatePassword,
} from '@features/owner-onboarding/passwordPolicy';
import { eyebrow, h1, sub, fieldLabel, textInput, okNote } from '@features/owner-onboarding/components/stepStyles';

interface InvitationContext {
  name: string;
  phone: string;
  email: string;
  phoneVerified: boolean;
}

/**
 * Manager invitation/activation (ADR-212). Lands here from the link
 * `manager-invitation-service.sendInvitation` emails when a Super Admin adds
 * a manager. Unlike `OwnerActivationPage`, this does NOT get Supabase tokens
 * back from activation — the backend only sets the manager's password; the
 * account is JIT-linked to Supabase on their first real `login()` call
 * below, same as every other role's first password sign-in.
 *
 * Two steps, in order: verify the phone by OTP (reuses the existing
 * phone-OTP service, purpose MANAGER_INVITE), then set a password. Both are
 * re-checked server-side — this page hiding the password step until the
 * phone step succeeds is UX only, not the security boundary.
 */
export function ManagerActivationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [ctx, setCtx] = useState<InvitationContext | null>(null);

  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setErrorCode('INVALID');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await managerInvitationApi.getInvitationContext(token);
        if (cancelled) return;
        setCtx(result);
        setPhoneVerified(result.phoneVerified);
      } catch (err: any) {
        if (cancelled) return;
        setErrorCode(err?.response?.data?.error?.code || 'INVALID');
        setErrorMessage(err?.response?.data?.error?.message || '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordEval = evaluatePassword(password);
  const passwordOk = passwordEval.allMet;
  const matchOk = confirmPassword.length > 0 && confirmPassword === password;
  const canSubmit = phoneVerified && passwordOk && matchOk && !submitting;

  const markTouched = (key: string) => setTouched((t) => ({ ...t, [key]: true }));

  const handleSendOtp = async () => {
    if (!token) return;
    setOtpError('');
    setOtpSubmitting(true);
    try {
      await managerInvitationApi.sendPhoneOtp(token);
      setOtpSent(true);
      stayoToast.success('Code sent to your phone.');
    } catch (err: unknown) {
      setOtpError(toErrorLine(resolveError(err, 'generic')));
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!token || otp.trim().length === 0) return;
    setOtpError('');
    setOtpSubmitting(true);
    try {
      await managerInvitationApi.verifyPhoneOtp(token, otp.trim());
      setPhoneVerified(true);
      stayoToast.success('Phone verified.');
    } catch (err: unknown) {
      setOtpError(toErrorLine(resolveError(err, 'generic')));
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setTouched({ password: true, confirm: true });
    if (!canSubmit || !token || !ctx) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await managerInvitationApi.activate(token, password);
      await login(ctx.email, password);
      stayoToast.success('Account activated — welcome to Stayo.');
      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      setSubmitError(toErrorLine(resolveError(err, 'generic')));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <ThemeProvider theme="marketing">
        <StayoLoadingScreen message="Opening your invitation…" />
      </ThemeProvider>
    );
  }

  if (!ctx) {
    const title =
      errorCode === 'ALREADY_ACTIVE'
        ? 'Invitation already used'
        : errorCode === 'EXPIRED'
          ? 'Invitation expired'
          : 'Invitation unavailable';

    return (
      <ThemeProvider theme="marketing">
        <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {errorMessage || 'This activation link has expired or was already used. Ask your Super Admin to resend it.'}
          </p>
          <Link to="/login" className="mt-5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
            Back to sign in
          </Link>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme="marketing">
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-[480px]">
          <div className={eyebrow}>ACTIVATE YOUR MANAGER ACCOUNT</div>
          <h1 className={h1}>Welcome, {ctx.name.split(' ')[0]}.</h1>
          <p className={sub}>
            {phoneVerified
              ? 'Set a password to finish activating your Stayo manager account.'
              : 'Verify your phone number to continue.'}
          </p>

          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground">Name</span>
              <span className="text-sm font-bold text-foreground">{ctx.name}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground">Email</span>
              <span className="text-sm font-bold text-foreground">{ctx.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground">Mobile number</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
                {ctx.phone}
                {phoneVerified && <ShieldCheck className="h-3.5 w-3.5 text-success" />}
              </span>
            </div>
          </div>

          {!phoneVerified ? (
            <div className="flex flex-col gap-4">
              {!otpSent ? (
                <button
                  type="button"
                  disabled={otpSubmitting}
                  onClick={handleSendOtp}
                  className="inline-flex items-center justify-center gap-2 rounded-[13px] bg-primary px-7.5 py-3.5 font-display text-base font-bold text-primary-foreground disabled:opacity-60"
                >
                  {otpSubmitting ? 'Sending…' : 'Send verification code'}
                </button>
              ) : (
                <>
                  <label className="block">
                    <span className={fieldLabel}>ENTER THE CODE SENT TO YOUR PHONE</span>
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="6-digit code"
                      inputMode="numeric"
                      className={textInput}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={otpSubmitting || otp.trim().length === 0}
                    onClick={handleVerifyOtp}
                    className="inline-flex items-center justify-center gap-2 rounded-[13px] bg-primary px-7.5 py-3.5 font-display text-base font-bold text-primary-foreground disabled:opacity-60"
                  >
                    {otpSubmitting ? 'Verifying…' : 'Verify code'}
                  </button>
                  <button type="button" onClick={handleSendOtp} disabled={otpSubmitting} className="text-[12.5px] font-semibold text-muted-foreground underline">
                    Resend code
                  </button>
                </>
              )}
              {otpError && (
                <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] font-semibold text-destructive">{otpError}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <label className="block">
                <span className={fieldLabel}>CREATE A PASSWORD</span>
                <div className="relative">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => markTouched('password')}
                    placeholder="Pick something only you would know"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className={`${textInput} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-1 gap-1" aria-hidden>
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              i < passwordEval.met.length ? (passwordOk ? 'bg-success' : 'bg-primary') : 'bg-border'
                            }`}
                          />
                        ))}
                      </div>
                      <span className={`text-[11.5px] font-bold ${passwordOk ? 'text-success' : 'text-muted-foreground'}`}>
                        {PASSWORD_STRENGTH_LABEL[passwordEval.strength]}
                      </span>
                    </div>
                    <ul className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                      {PASSWORD_CRITERIA.map((criterion) => {
                        const met = passwordEval.met.includes(criterion.id);
                        return (
                          <li
                            key={criterion.id}
                            className={`flex items-center gap-1.5 text-[12px] font-semibold ${
                              met ? 'text-success' : 'text-muted-foreground'
                            }`}
                          >
                            <span
                              className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full ${
                                met ? 'bg-success/15' : 'bg-border/60'
                              }`}
                            >
                              {met ? <Check className="h-2.5 w-2.5" strokeWidth={3.4} /> : <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />}
                            </span>
                            {criterion.label}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </label>

              <label className="block">
                <span className={fieldLabel}>CONFIRM PASSWORD</span>
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => markTouched('confirm')}
                  placeholder="Type it once more"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={textInput}
                />
                {matchOk && (
                  <span className={okNote}>
                    <Check className="h-3 w-3" strokeWidth={2.8} />
                    Passwords match.
                  </span>
                )}
                {touched.confirm && confirmPassword.length > 0 && !matchOk && (
                  <span className="mt-1.5 block text-[12.5px] font-semibold text-destructive">These don&apos;t match yet.</span>
                )}
              </label>

              {submitError && (
                <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] font-semibold text-destructive">{submitError}</p>
              )}

              <button
                type="button"
                disabled={!canSubmit}
                onClick={handleSubmit}
                className="inline-flex items-center justify-center gap-2 rounded-[13px] bg-primary px-7.5 py-3.5 font-display text-base font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? 'Activating…' : 'Activate account'}
              </button>
            </div>
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}
