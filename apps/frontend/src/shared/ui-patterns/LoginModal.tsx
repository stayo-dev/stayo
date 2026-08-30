import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Eye, EyeOff, X } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { useAuth } from '@context/AuthContext';
import { StayoLoader, StayoMark, StayoWordmark } from '@shared/ui/brand';
import {
  MIN_SIGNUP_PASSWORD_LENGTH,
  toTenantSignupPayload,
  validateTenantSignup,
  type TenantSignupErrors,
} from '@shared/lib/tenantSignupForm';

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
  password: string;
  confirmPassword: string;
}

const EMPTY_FORM: LoginModalForm = { name: '', email: '', password: '', confirmPassword: '' };

const inputClass =
  'w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none';

const labelClass = 'mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary';

/** Applied on top of `inputClass` when a field has something wrong with it. */
const errorInputClass = 'border-destructive focus:border-destructive';

/**
 * The single login/signup surface for Stayo (ADR-035). `/login` renders the
 * landing page with this open, so every redirect that needs a URL — session
 * expiry, the admin guard, password reset, activation — still has one.
 *
 * Owner mode is login-only — owner accounts are created through the lead →
 * approval → onboarding funnel, never here.
 *
 * Tenant signup offers both an email+password form (name, email, password,
 * confirm password) and "Continue with Google" (ADR-096). It was Google-only
 * between 2026-08-16 and this change, which dead-ended anyone without a
 * Google account — or unwilling to hand one over to browse hostels — since
 * Google was the *only* way to get an account at all.
 *
 * What did not come back is the phone/OTP step: ADR-078 moved phone
 * verification out of signup to the moment it's actually needed (sending an
 * enquiry, see `EnquiryPage`), and it stays there. So a password account is
 * born the same shape a Google one is — `phone: null`, verified later.
 *
 * "Continue with Google" creates the account when the email is new
 * (`loginWithGoogleAllowProvision`) via a narrow, separately-gated backend
 * path (`lib/auth/supabase-provision.ts`) — the existing "Google never
 * auto-provisions" invariant on the plain login path is untouched. It appears
 * on the Login tab too, so a new visitor who starts on the wrong tab isn't
 * dead-ended.
 *
 * Field validation lives in `@shared/lib/tenantSignupForm` rather than here:
 * `apps/frontend` tests run without jsdom, so the rules are tested directly
 * and this file stays a renderer.
 *
 * Built directly on `@radix-ui/react-dialog` rather than
 * `app/components/ui/dialog.tsx` — same reasoning as BottomSheet using
 * `vaul` directly: `shared/` can't import `app/` (scripts/check-architecture.mjs).
 */
export function LoginModal({ open, mode, onClose, onSuccess, initialTab = 'login' }: LoginModalProps) {
  const { login, loginWithGoogle, loginWithGoogleAllowProvision, signUpTenant } = useAuth();

  const [tab, setTab] = useState<'login' | 'signup'>(initialTab);
  const [form, setForm] = useState<LoginModalForm>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** Per-field signup messages, shown under the field they belong to. */
  const [fieldErrors, setFieldErrors] = useState<TenantSignupErrors>({});

  const isOwner = mode === 'owner';
  const isLogin = isOwner || tab === 'login';
  const isTenantSignup = !isOwner && tab === 'signup';

  useEffect(() => {
    if (!open) return;
    setTab(isOwner ? 'login' : initialTab);
    setForm(EMPTY_FORM);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setError('');
    setFieldErrors({});
    setSubmitting(false);
    setGoogleSubmitting(false);
  }, [open, initialTab, isOwner]);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const set = <K extends keyof LoginModalForm>(key: K, value: LoginModalForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear this field's complaint as soon as it's being addressed — leaving it
    // up while someone fixes it reads as if the fix didn't register.
    setFieldErrors((prev) => (prev[key as keyof TenantSignupErrors] ? { ...prev, [key]: undefined } : prev));
  };

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

  const submitSignup = async () => {
    const validation = validateTenantSignup(form);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setError('');
      return;
    }
    setFieldErrors({});
    setError('');
    setSubmitting(true);
    try {
      const user = await signUpTenant(toTenantSignupPayload(form));
      onSuccess({
        role: String(user.role ?? ''),
        name: user.name ?? form.name.trim(),
        email: user.email ?? form.email.trim().toLowerCase(),
        tenantId: (user as { tenant_id?: string | null }).tenant_id ?? null,
      });
    } catch (err) {
      setError(getMessage(err, 'Could not create your account.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    return isTenantSignup ? submitSignup() : submitLogin();
  };

  /**
   * Tenant mode allows Google to create a new account (alongside the password
   * form); owner mode never does — owner accounts are only ever created
   * through the onboarding funnel.
   */
  const submitGoogle = async () => {
    setError('');
    setFieldErrors({});
    setGoogleSubmitting(true);
    try {
      if (isOwner) {
        await loginWithGoogle();
      } else {
        await loginWithGoogleAllowProvision();
      }
      // No further code runs on success — signInWithOAuth navigates the browser away.
    } catch (err) {
      setError(getMessage(err, 'Google sign-in failed.'));
      setGoogleSubmitting(false);
    }
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

          {isOwner ? (
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
                {isLogin ? 'Log in to continue.' : 'Browse, save and enquire about stays.'}
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

          {isTenantSignup ? (
            <>
              <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
                <label className="block">
                  <span className={labelClass}>FULL NAME</span>
                  <input
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="Riya Sharma"
                    autoComplete="name"
                    aria-invalid={Boolean(fieldErrors.name)}
                    className={cn(inputClass, fieldErrors.name && errorInputClass)}
                  />
                  <FieldError message={fieldErrors.name} />
                </label>

                <label className="block">
                  <span className={labelClass}>EMAIL</span>
                  <input
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    autoComplete="email"
                    aria-invalid={Boolean(fieldErrors.email)}
                    className={cn(inputClass, fieldErrors.email && errorInputClass)}
                  />
                  <FieldError message={fieldErrors.email} />
                </label>

                <label className="block">
                  <span className={labelClass}>PASSWORD</span>
                  <div className="relative">
                    <input
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      placeholder={`At least ${MIN_SIGNUP_PASSWORD_LENGTH} characters`}
                      autoComplete="new-password"
                      aria-invalid={Boolean(fieldErrors.password)}
                      className={cn(inputClass, 'pr-11', fieldErrors.password && errorInputClass)}
                    />
                    <RevealButton shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                  </div>
                  <FieldError message={fieldErrors.password} />
                </label>

                <label className="block">
                  <span className={labelClass}>CONFIRM PASSWORD</span>
                  <div className="relative">
                    <input
                      value={form.confirmPassword}
                      onChange={(e) => set('confirmPassword', e.target.value)}
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Type it again"
                      autoComplete="new-password"
                      aria-invalid={Boolean(fieldErrors.confirmPassword)}
                      className={cn(inputClass, 'pr-11', fieldErrors.confirmPassword && errorInputClass)}
                    />
                    <RevealButton
                      shown={showConfirmPassword}
                      onToggle={() => setShowConfirmPassword((v) => !v)}
                    />
                  </div>
                  <FieldError message={fieldErrors.confirmPassword} />
                </label>

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
                  {submitting && <StayoLoader size="sm" label={null} />}
                  {submitting ? 'Creating your account…' : 'Create Account'}
                </button>
              </form>

              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="font-display text-[11px] font-bold tracking-wider text-muted-foreground">OR</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={submitGoogle}
                disabled={googleSubmitting}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-border bg-card px-4 py-3 font-display text-[14.5px] font-bold text-foreground transition-colors hover:border-primary disabled:opacity-75"
              >
                {googleSubmitting ? <StayoLoader size="sm" label={null} /> : <GoogleMark />}
                {googleSubmitting ? 'Please wait…' : 'Continue with Google'}
              </button>

              {/* Said once, here, because it's the question this form raises:
                  there's no phone field, and an enquiry obviously needs one. */}
              <p className="mt-4 text-center text-[12px] leading-normal text-muted-foreground">
                We'll ask for your phone number and verify it once — when you're ready to send an enquiry.
              </p>
            </>
          ) : (
            <>
              <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
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
                <label className="block">
                  <span className={labelClass}>PASSWORD</span>
                  <div className="relative">
                    <input
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className={`${inputClass} pr-11`}
                    />
                    <RevealButton shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                  </div>
                </label>

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
                  {submitting && <StayoLoader size="sm" label={null} />}
                  {submitting ? 'Please wait…' : 'Log In'}
                </button>
              </form>

              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="font-display text-[11px] font-bold tracking-wider text-muted-foreground">OR</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={submitGoogle}
                disabled={googleSubmitting}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-border bg-card px-4 py-3 font-display text-[14.5px] font-bold text-foreground transition-colors hover:border-primary disabled:opacity-75"
              >
                {googleSubmitting ? <StayoLoader size="sm" label={null} /> : <GoogleMark />}
                {googleSubmitting ? 'Please wait…' : 'Continue with Google'}
              </button>
              <a
                href="/forgot-password"
                className="mt-4 text-center text-[12.5px] font-semibold text-primary hover:underline"
              >
                Forgot password?
              </a>
            </>
          )}

          {!isOwner && (
            /*
             * The doorway into the claim flow.
             *
             * A tenant whose owner has been keeping their records has a real
             * profile with a real phone number and NO password -- so logging in
             * with their own number returns "Invalid email, phone, or password".
             * The system knows their hostel, room and payment history and tells
             * them they do not exist. Without this, their only ways in were
             * typing /claim from memory or clicking a months-old invite link.
             *
             * Deliberately always shown, and deliberately not driven by what
             * was typed: a login form that answered "that number belongs to a
             * tenant" would let anyone enumerate which phone numbers live in
             * which hostels. Proof of the number comes from the OTP inside the
             * claim flow, and nothing is revealed before it.
             */
            <div className="mt-5 border-t border-border pt-4 text-center">
              <p className="text-[12.5px] leading-normal text-muted-foreground">
                Already staying at a hostel and your owner set you up?
              </p>
              <a
                href="/claim"
                className="mt-1 inline-block font-display text-[13px] font-bold text-primary hover:underline"
              >
                Take charge of your account
              </a>
            </div>
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-[11.5px] font-semibold text-destructive">{message}</p>;
}

function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function GoogleMark({ light }: { light?: boolean } = {}) {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      {light ? (
        <>
          <path fill="#fff" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" opacity={0.92} />
          <path fill="#fff" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.8 6.6-9.5 6.6-16.2z" opacity={0.75} />
          <path fill="#fff" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-5.7z" opacity={0.6} />
          <path fill="#fff" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.2 2.2-6.4 0-11.7-3.7-13.6-9.1l-7.8 5.7C6.5 42.6 14.6 48 24 48z" opacity={0.85} />
        </>
      ) : (
        <>
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.8 6.6-9.5 6.6-16.2z" />
          <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-5.7z" />
          <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.2 2.2-6.4 0-11.7-3.7-13.6-9.1l-7.8 5.7C6.5 42.6 14.6 48 24 48z" />
        </>
      )}
    </svg>
  );
}
