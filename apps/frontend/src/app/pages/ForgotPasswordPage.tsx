import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
} from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { authApi } from '@lib/authApi';

/**
 * Password recovery, by email link or WhatsApp code (ADR-055).
 *
 * Two things worth knowing before editing:
 *
 * 1. It renders inside `<ThemeProvider theme="marketing">`, like LandingPage.
 *    Without it this route resolves theme.css's unscoped `:root` tokens — the
 *    legacy navy/orange palette — while the login popup it is reached from
 *    resolves the marketing clay palette. That mismatch is why this screen
 *    used to look like a different product, and why nothing here hardcodes a
 *    hex value any more.
 *
 * 2. The phone leg spends its verification code on the *same* screen that
 *    collects the new password, deliberately: the backend hands back a
 *    5-minute reset token when the code is verified, so splitting those into
 *    two screens would leave a live token sitting in browser state while the
 *    user thinks up a password.
 */
type Step = 'method' | 'email' | 'email-sent' | 'phone' | 'phone-code' | 'done';

const getMessage = (error: unknown, fallback: string) => {
  const response = (error as { response?: { data?: { error?: { message?: string } } } })?.response;
  return response?.data?.error?.message || fallback;
};

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('method');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailDegraded, setEmailDegraded] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const goBack = () => {
    setError('');
    if (step === 'phone-code') setStep('phone');
    else setStep('method');
  };

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await authApi.forgotPasswordByEmail(email.trim());
      setEmailDegraded(Boolean(result.delivery_degraded));
      setStep('email-sent');
    } catch (err) {
      setError(getMessage(err, 'Could not send reset instructions.'));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await authApi.forgotPasswordByPhone(phone.trim());
      setStep('phone-code');
      setResendIn(30);
    } catch (err) {
      setError(getMessage(err, 'Could not send a code to that number.'));
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { reset_token } = await authApi.verifyResetOtp(phone.trim(), otp.trim());
      await authApi.resetPassword(reset_token, password);
      setStep('done');
    } catch (err) {
      setError(getMessage(err, 'That code could not be verified.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemeProvider theme="marketing">
      <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
        <div className="w-full max-w-md">
          {step === 'method' ? (
            <Link
              to="/login?signin=1"
              className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          ) : (
            <button
              type="button"
              onClick={goBack}
              className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}

          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <PageMark step={step} />

            {step === 'method' && (
              <>
                <Heading
                  title="Reset your password"
                  description="Choose how you'd like to verify it's you."
                />
                <div className="mt-6 space-y-3">
                  <MethodOption
                    icon={<Mail className="h-[18px] w-[18px]" />}
                    label="Email me a link"
                    hint="Goes to the email on your account"
                    onClick={() => {
                      setError('');
                      setStep('email');
                    }}
                  />
                  <MethodOption
                    icon={<MessageCircle className="h-[18px] w-[18px]" />}
                    label="WhatsApp me a code"
                    hint="Usually the fastest"
                    onClick={() => {
                      setError('');
                      setStep('phone');
                    }}
                  />
                </div>
              </>
            )}

            {step === 'email' && (
              <form onSubmit={submitEmail}>
                <Heading
                  title="What's your email?"
                  description="We'll send a secure link that's valid for one hour."
                />
                <Field label="Email address">
                  <input
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="mt-2 w-full rounded-xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary"
                  />
                </Field>
                <ErrorNote message={error} />
                <SubmitButton busy={busy} disabled={!email.trim()}>
                  Send reset link
                </SubmitButton>
              </form>
            )}

            {step === 'email-sent' && (
              <>
                <Heading
                  title="Check your inbox"
                  description={`If an account exists for ${email.trim()}, a reset link is on its way. It's valid for one hour and can be used once.`}
                />
                {emailDegraded && (
                  <div className="mt-5 flex gap-3 rounded-xl border border-border bg-muted p-3 text-sm text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p>
                      Email delivery isn&apos;t fully configured on this environment yet, so the
                      message may not arrive.{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          setStep('phone');
                        }}
                        className="font-semibold text-primary underline"
                      >
                        Use WhatsApp instead
                      </button>
                      .
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/login?signin=1')}
                  className="mt-6 w-full rounded-xl border border-border py-3.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                >
                  Back to sign in
                </button>
              </>
            )}

            {step === 'phone' && (
              <form onSubmit={sendCode}>
                <Heading
                  title="What's your WhatsApp number?"
                  description="We'll send a 6-digit code to the number on your account."
                />
                <Field label="Phone number">
                  <input
                    type="tel"
                    autoComplete="tel"
                    autoFocus
                    required
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 98765 43210"
                    className="mt-2 w-full rounded-xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary"
                  />
                </Field>
                <ErrorNote message={error} />
                <SubmitButton busy={busy} disabled={phone.trim().length < 8}>
                  Send the code
                </SubmitButton>
              </form>
            )}

            {step === 'phone-code' && (
              <form onSubmit={submitNewPassword}>
                <Heading
                  title="Enter your code"
                  description={`If an account exists for ${phone.trim()}, a 6-digit code is on its way. Codes expire in 5 minutes.`}
                />
                <Field label="Verification code">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="mt-2 w-full rounded-xl border border-border bg-input-background px-4 py-3 text-center text-lg font-semibold tracking-[0.4em] text-foreground outline-none transition focus:border-primary"
                  />
                </Field>

                <div className="mt-2 text-right text-xs text-muted-foreground">
                  {resendIn > 0 ? (
                    `Resend in 0:${String(resendIn).padStart(2, '0')}`
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendCode()}
                      disabled={busy}
                      className="font-semibold text-primary disabled:opacity-60"
                    >
                      Resend code
                    </button>
                  )}
                </div>

                <Field label="New password">
                  <div className="relative mt-2">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full rounded-xl border border-border bg-input-background px-4 py-3 pr-11 text-sm text-foreground outline-none transition focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>

                <ErrorNote message={error} />
                <SubmitButton busy={busy} disabled={otp.length !== 6 || password.length < 8}>
                  Set new password
                </SubmitButton>
              </form>
            )}

            {step === 'done' && (
              <>
                <Heading
                  title="Password updated"
                  description="You've been signed out everywhere else for security. Sign in with your new password."
                />
                <button
                  type="button"
                  onClick={() => navigate('/login?signin=1', { replace: true })}
                  className="mt-6 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.98]"
                >
                  Go to sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}

function PageMark({ step }: { step: Step }) {
  if (step === 'done') {
    return (
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-[color:var(--success)]">
        <CheckCircle2 className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-primary">
      <KeyRound className="h-5 w-5" />
    </div>
  );
}

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="font-display text-[22px] font-extrabold leading-tight text-foreground">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-5 block">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}

function MethodOption({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3.5 text-left transition hover:bg-muted"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-bold text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="mt-4 flex gap-3 rounded-xl border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/8 p-3 text-sm text-[color:var(--destructive)]">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
