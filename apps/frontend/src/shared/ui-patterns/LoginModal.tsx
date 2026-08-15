import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Eye, EyeOff, X } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { useAuth } from '@context/AuthContext';
import { authApi } from '@lib/authApi';
import { StayoLoader, StayoMark, StayoWordmark } from '@shared/ui/brand';

export type LoginModalMode = 'owner' | 'tenant';

export interface LoginModalUser {
  role: string;
  name: string;
  email: string;
  tenantId?: string | null;
}

interface LoginModalProps {
  open: boolean;
  mode: LoginModalMode;
  onClose: () => void;
  onSuccess: (user: LoginModalUser) => void;
  /** Opens straight on the signup tab (tenant mode only). */
  initialTab?: 'login' | 'signup';
}

interface LoginModalForm {
  name: string;
  email: string;
  phone: string;
  password: string;
}

const EMPTY_FORM: LoginModalForm = { name: '', email: '', phone: '', password: '' };

const inputClass =
  'w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none';

const labelClass = 'mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary';

/**
 * The single login/signup surface for Stayo (ADR-035). `/login` renders the
 * landing page with this open, so every redirect that needs a URL — session
 * expiry, the admin guard, password reset, activation — still has one.
 *
 * Real auth as of 2026-07-31: this was previously a mock (a 650ms setTimeout
 * standing in for the network call) while the real work lived on a separate,
 * off-theme `/login` page, which has since been deleted.
 *
 * Owner mode is login-only — owner accounts are created through the lead →
 * approval → onboarding funnel, never here. Tenant signup creates a
 * *marketplace* account (browse/save/enquire); someone becomes a tenant of a
 * hostel only when an owner invites them and they activate.
 *
 * Built directly on `@radix-ui/react-dialog` rather than
 * `app/components/ui/dialog.tsx` — same reasoning as BottomSheet using
 * `vaul` directly: `shared/` can't import `app/` (scripts/check-architecture.mjs).
 */
export function LoginModal({ open, mode, onClose, onSuccess, initialTab = 'login' }: LoginModalProps) {
  const { login, loginWithGoogle, signUpTenant } = useAuth();

  const [tab, setTab] = useState<'login' | 'signup'>(initialTab);
  const [form, setForm] = useState<LoginModalForm>(EMPTY_FORM);
  const [otp, setOtp] = useState('');
  const [otpRequired, setOtpRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isOwner = mode === 'owner';
  const isLogin = isOwner || tab === 'login';
  const showName = !isOwner && !isLogin;

  useEffect(() => {
    if (!open) return;
    setTab(isOwner ? 'login' : initialTab);
    setForm(EMPTY_FORM);
    setOtp('');
    setOtpRequired(false);
    setShowPassword(false);
    setError('');
    setSubmitting(false);
  }, [open, initialTab, isOwner]);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const set = <K extends keyof LoginModalForm>(key: K, value: LoginModalForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submitLogin = async () => {
    if (!form.email.trim() || !form.password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const user = await login(form.email, form.password);
      onSuccess({
        role: String(user.role ?? ''),
        name: user.name ?? form.email.split('@')[0],
        email: user.email ?? form.email,
        tenantId: (user as { tenant_id?: string | null }).tenant_id ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  /** Creates the account and logs in. Shared by the skip and verified paths. */
  const createAccount = async () => {
    const user = await signUpTenant({
      name: form.name,
      email: form.email,
      phone: form.phone,
      password: form.password,
    });
    onSuccess({
      role: String(user.role ?? 'TENANT'),
      name: user.name ?? form.name,
      email: user.email ?? form.email,
      tenantId: (user as { tenant_id?: string | null }).tenant_id ?? null,
    });
  };

  const submitSignup = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (form.password.trim().length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const result = await authApi.sendPhoneOtp(form.phone.trim());

      // WhatsApp can't deliver a code right now (ADR-034) — the backend has
      // already recorded the number as unverified, so create the account
      // rather than showing an OTP screen for a code nobody will receive.
      if (result.verification_required === false) {
        await createAccount();
        return;
      }

      setOtp('');
      setOtpRequired(true);
    } catch (err) {
      setError(getMessage(err, 'Could not create your account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async () => {
    if (otp.trim().length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await authApi.verifyPhoneOtp(form.phone.trim(), otp.trim());
      await createAccount();
    } catch (err) {
      setError(getMessage(err, 'Verification failed. Check the code and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitGoogle = async () => {
    setError('');
    try {
      // Full-page redirect (ADR-031) — nothing after this runs.
      await loginWithGoogle();
    } catch (err) {
      setError(getMessage(err, 'Google sign-in failed.'));
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otpRequired) return submitOtp();
    return isLogin ? submitLogin() : submitSignup();
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[500] bg-[rgba(47,40,35,0.5)] backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-200" />
        <Dialog.Content
          className={cn(
            'fixed z-[500] flex flex-col bg-card p-6 pb-6 shadow-[0_40px_90px_-30px_rgba(47,47,47,0.5)]',
            'inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-300',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]',
          )}
        >
          <Dialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[10px] border border-border bg-card"
          >
            <X className="h-4 w-4 text-foreground" />
          </Dialog.Close>

          {/* The real lockup, not a typeset word. `StayoMark` + `StayoWordmark`
              inherit `currentColor`, so the brand's terracotta comes from the
              same `--primary` token the rest of the sheet uses rather than a
              second hard-coded value that could drift from it. */}
          <div className="mb-1.5 flex items-center gap-2 text-primary">
            <StayoMark className="h-[22px] w-auto" />
            <StayoWordmark className="h-[15px] w-auto" />
          </div>

          {otpRequired ? (
            <>
              <Dialog.Title className="mb-1 mt-3.5 font-display text-[22px] font-extrabold text-foreground">
                Enter verification code
              </Dialog.Title>
              <Dialog.Description className="mb-5 text-sm leading-normal text-muted-foreground">
                Sent to {form.phone.trim()}
              </Dialog.Description>
            </>
          ) : isOwner ? (
            <>
              <Dialog.Title className="mb-1 mt-3.5 font-display text-[22px] font-extrabold text-foreground">
                Owner Login
              </Dialog.Title>
              <Dialog.Description className="mb-5 text-sm leading-normal text-muted-foreground">
                Log in with your existing Stayo owner credentials.
              </Dialog.Description>
            </>
          ) : (
            <>
              <Dialog.Title className="mb-1 mt-3.5 font-display text-[22px] font-extrabold text-foreground">
                {isLogin ? 'Welcome back' : 'Create your account'}
              </Dialog.Title>
              <Dialog.Description className="mb-4.5 text-sm leading-normal text-muted-foreground">
                {isLogin ? 'Log in to continue.' : 'Sign up to browse, save and enquire about stays.'}
              </Dialog.Description>

              <div className="relative mb-5 flex gap-0 rounded-[13px] border border-border bg-muted p-1.5">
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-1.5 z-0 w-[calc(50%-6px)] rounded-[9px] bg-primary shadow-[0_6px_16px_-8px_rgba(164,93,68,0.55)] transition-transform duration-300 ease-out',
                    isLogin ? 'translate-x-0' : 'translate-x-full',
                  )}
                />
                {(['login', 'signup'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setTab(value);
                      setError('');
                    }}
                    className={cn(
                      'relative z-10 flex-1 rounded-[9px] px-2.5 py-2 font-display text-[13.5px] font-bold transition-colors',
                      (value === 'login') === isLogin ? 'text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {value === 'login' ? 'Log In' : 'Sign Up'}
                  </button>
                ))}
              </div>
            </>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
            {otpRequired ? (
              <label className="block">
                <span className={labelClass}>6-DIGIT CODE</span>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoFocus
                  placeholder="123456"
                  className={`${inputClass} text-center tracking-[0.3em]`}
                />
              </label>
            ) : (
              <>
                {showName && (
                  <label className="block">
                    <span className={labelClass}>FULL NAME</span>
                    <input
                      value={form.name}
                      onChange={(e) => set('name', e.target.value)}
                      placeholder="Your name"
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="block">
                  <span className={labelClass}>EMAIL</span>
                  <input
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    autoComplete="email"
                    className={inputClass}
                  />
                </label>
                {showName && (
                  <label className="block">
                    <span className={labelClass}>MOBILE NUMBER</span>
                    <input
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="+91 90000 00000"
                      inputMode="tel"
                      autoComplete="tel"
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="block">
                  <span className={labelClass}>PASSWORD</span>
                  <div className="relative">
                    <input
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      className={`${inputClass} pr-11`}
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
                </label>
              </>
            )}

            {error && (
              <div className="rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-4 py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_14px_28px_-14px_rgba(164,93,68,0.6)] disabled:opacity-75"
            >
              {submitting && (
                <StayoLoader size="sm" label={null} />
              )}
              {submitting
                ? 'Please wait…'
                : otpRequired
                  ? 'Verify & Continue'
                  : isLogin
                    ? 'Log In'
                    : 'Create Account'}
            </button>
          </form>

          {!otpRequired && isLogin && (
            <>
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="font-display text-[11px] font-bold tracking-wider text-muted-foreground">OR</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={submitGoogle}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-border bg-card px-4 py-3 font-display text-[14.5px] font-bold text-foreground transition-colors hover:border-primary"
              >
                <GoogleMark />
                Continue with Google
              </button>
              <a
                href="/forgot-password"
                className="mt-4 text-center text-[12.5px] font-semibold text-primary hover:underline"
              >
                Forgot password?
              </a>
            </>
          )}

          {isOwner && !otpRequired && (
            <p className="mt-4 text-center text-[12.5px] leading-normal text-muted-foreground">
              Owner accounts are created during onboarding — contact Stayo support if you need help accessing yours.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function getMessage(error: unknown, fallback: string) {
  const apiMessage = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
    ?.message;
  if (apiMessage) return apiMessage;
  return error instanceof Error ? error.message : fallback;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.8 6.6-9.5 6.6-16.2z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-5.7z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.2 2.2-6.4 0-11.7-3.7-13.6-9.1l-7.8 5.7C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
