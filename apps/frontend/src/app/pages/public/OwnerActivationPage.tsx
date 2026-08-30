import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { AlertTriangle, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { hostelLeadsApi } from '@features/hostel-leads/api';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { resolveError, toErrorLine } from '@shared/errors';
import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  PASSWORD_CRITERIA,
  PASSWORD_STRENGTH_LABEL,
  evaluatePassword,
} from '@features/owner-onboarding/passwordPolicy';
import {
  eyebrow,
  h1,
  sub,
  fieldLabel,
  textInput,
  okNote,
} from '@features/owner-onboarding/components/stepStyles';

/** Loose check — the real validation is the server's; this only catches typos early. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InvitationContext {
  name: string;
  hostel_name: string;
  phone: string;
  google_email: string | null;
  city: string | null;
}

/**
 * Owner-acquisition funnel, phase 3. Lands here from the activation link an
 * admin's "Approve Lead" action sends (WhatsApp, email fallback — see
 * lead-invitation-service.ts). Unlike the phase-2 version of this page, this
 * one *is* the activation form — it no longer hands the token off to the
 * general-purpose `/onboarding` wizard via router state (which lost the
 * token on any refresh and, worse, let `/onboarding` be reached and
 * completed with no token at all). Name, hostel name, and phone come
 * straight from the lead — already collected and phone-OTP-verified at lead
 * capture — so only email (when missing) and a password are ever asked
 * here. The backend independently re-validates the token before creating
 * any account: this page hiding fields is a UX nicety, not the security
 * boundary.
 */
export function OwnerActivationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [ctx, setCtx] = useState<InvitationContext | null>(null);

  const [email, setEmail] = useState('');
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
        const result = await hostelLeadsApi.getInvitationContext(token);
        if (cancelled) return;
        setCtx(result);
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

  const needsEmail = Boolean(ctx && !ctx.google_email);
  const emailOk = !needsEmail || EMAIL_RE.test(email.trim());
  const passwordEval = evaluatePassword(password);
  const passwordOk = passwordEval.allMet;
  const matchOk = confirmPassword.length > 0 && confirmPassword === password;
  const canSubmit = emailOk && passwordOk && matchOk && !submitting;

  const markTouched = (key: string) => setTouched((t) => ({ ...t, [key]: true }));

  const handleSubmit = async () => {
    setTouched({ email: true, password: true, confirm: true });
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await hostelLeadsApi.activateInvitation(token, {
        ...(needsEmail ? { email: email.trim() } : {}),
        password,
        confirm_password: confirmPassword,
      });

      const { queryClient } = await import('@lib/queryClient');
      queryClient.clear();
      const { supabase } = await import('@lib/supabaseClient');
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (sessionError) throw sessionError;

      stayoToast.success('Account activated — welcome to Stayo.');
      navigate('/owner/home', { replace: true });
    } catch (err: unknown) {
      const message = toErrorLine(resolveError(err, 'generic'));
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <StayoLoadingScreen message="Opening your invitation…" />;
  }

  if (!ctx) {
    const title =
      errorCode === 'ALREADY_ACTIVE'
        ? 'Invitation already used'
        : errorCode === 'EXPIRED'
          ? 'Invitation expired'
          : errorCode === 'CANCELLED'
            ? 'Invitation cancelled'
            : 'Invitation unavailable';

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {errorMessage || 'This activation link has expired or was already used.'}
        </p>
        <Link to="/owners" className="mt-5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
          Back to StayO
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[480px]">
        <div className={eyebrow}>ACTIVATE YOUR ACCOUNT</div>
        <h1 className={h1}>Welcome, {ctx.name.split(' ')[0]}.</h1>
        <p className={sub}>
          Set a password to finish activating your Stayo account for {ctx.hostel_name}.
        </p>

        {/* Already-known details — sourced from the lead, never re-asked. */}
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-muted-foreground">Owner name</span>
            <span className="text-sm font-bold text-foreground">{ctx.name}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-muted-foreground">Hostel name</span>
            <span className="text-sm font-bold text-foreground">{ctx.hostel_name}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-muted-foreground">Mobile number</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
              {ctx.phone}
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
            </span>
          </div>
          {ctx.google_email && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground">Email</span>
              <span className="text-sm font-bold text-foreground">{ctx.google_email}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {needsEmail && (
            <label className="block">
              <span className={fieldLabel}>EMAIL</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => markTouched('email')}
                placeholder="you@hostel.com"
                inputMode="email"
                autoComplete="email"
                className={textInput}
              />
              {touched.email && !emailOk && (
                <span className="mt-1.5 block text-[12.5px] font-semibold text-destructive">
                  That doesn&apos;t look like an email address.
                </span>
              )}
            </label>
          )}

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
                          i < passwordEval.met.length
                            ? passwordOk
                              ? 'bg-success'
                              : 'bg-primary'
                            : 'bg-border'
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
              <span className="mt-1.5 block text-[12.5px] font-semibold text-destructive">
                These don&apos;t match yet.
              </span>
            )}
          </label>

          {submitError && (
            <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] font-semibold text-destructive">
              {submitError}
            </p>
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
      </div>
    </div>
  );
}
