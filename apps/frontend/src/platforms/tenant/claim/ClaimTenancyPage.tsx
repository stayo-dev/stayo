import { useEffect, useReducer, useState, type Dispatch } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft } from 'lucide-react';
import { useAuth } from '@context/AuthContext';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { StayoLoader } from '@shared/ui/brand';
import { resolveError, toErrorLine, extractError } from '@shared/errors';
import { canonicalPhone, formatIndianPhone, toLocalPhone } from '@shared/lib/phone';
import { tenancyClaimApi } from '@features/tenant-session/api/tenancyClaim';
import {
  acknowledgementsComplete,
  canConfirm,
  canSendOtp,
  canVerifyOtp,
  claimReducer,
  initialClaimState,
  isTenantSession,
  REQUIRED_ACKNOWLEDGEMENTS,
  selectedTenancy,
  type AcknowledgementKey,
} from './claimSteps';

/**
 * Thin renderer over `claimSteps.ts`'s pure step machine. This component
 * owns only: DOM state (input focus, etc.), calling the four backend
 * endpoints via `tenancyClaimApi`, and translating their results into
 * events for the reducer. Every "what step comes next" / "what does this
 * error mean for where the tenant lands" decision lives in `claimSteps.ts`
 * and is tested there — see that file's module comment.
 *
 * Reached two ways: directly at `/claim` (optionally `?phone=` to prefill),
 * or via a redirect from `ActivationPage` when a stale invitation link's
 * tenancy was adopted by the owner in the meantime (`CLAIM_REQUIRED`).
 */
export function ClaimTenancyPage() {
  const { user, updateUser } = useAuth();
  // SECURITY (final security review, finding 4): gated on role, not mere
  // presence of a session -- a signed-in OWNER/ADMIN is not who `confirm`'s
  // already-signed-in path is for, and treating them as such hides the
  // password fields while the backend still requires one from them. See
  // `isTenantSession`'s doc comment.
  const wasSignedInAtStart = isTenantSession(user);
  // Read once, at mount -- `alreadySignedIn` describes the session the
  // tenant walked in with and must not flip mid-flow (the reducer's own
  // RESTART preserves it for the same reason). Gates whether the confirm
  // step asks for a password and whether the backend will accept one --
  // see `claimSteps.ts`'s module comment on `ClaimState.alreadySignedIn`.
  const [state, dispatch] = useReducer(claimReducer, initialClaimState({ alreadySignedIn: wasSignedInAtStart }));
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const prefill = toLocalPhone(searchParams.get('phone'));
    if (prefill) dispatch({ type: 'PHONE_CHANGED', phone: prefill });
    // Only ever consult the query param on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendOtp = async () => {
    const phone = canonicalPhone(state.phone);
    if (!phone) return;
    dispatch({ type: 'SEND_OTP_REQUESTED' });
    try {
      await tenancyClaimApi.sendOtp(phone);
      dispatch({ type: 'SEND_OTP_SUCCEEDED' });
    } catch (err) {
      dispatch({ type: 'SEND_OTP_FAILED', message: toErrorLine(resolveError(err, 'claim')) });
    }
  };

  const handleVerifyOtp = async () => {
    const phone = canonicalPhone(state.phone);
    if (!phone || !canVerifyOtp(state.otp)) return;
    dispatch({ type: 'VERIFY_OTP_REQUESTED' });
    let claimToken: string | null = null;
    try {
      ({ claimToken } = await tenancyClaimApi.verifyOtp(phone, state.otp.trim()));
      dispatch({ type: 'VERIFY_OTP_SUCCEEDED', claimToken });
    } catch (err) {
      dispatch({ type: 'VERIFY_OTP_FAILED', message: toErrorLine(resolveError(err, 'claim')) });
      return;
    }
    dispatch({ type: 'LOOKUP_REQUESTED' });
    try {
      const tenancies = await tenancyClaimApi.lookup(phone, claimToken);
      dispatch({ type: 'LOOKUP_SUCCEEDED', tenancies });
    } catch (err) {
      const extracted = extractError(err);
      dispatch({ type: 'LOOKUP_FAILED', code: extracted.code, message: toErrorLine(resolveError(err, 'claim')) });
    }
  };

  const handleConfirm = async () => {
    const phone = canonicalPhone(state.phone);
    if (!phone || !state.selectedTenantId || !canConfirm(state)) return;
    dispatch({ type: 'CONFIRM_REQUESTED' });
    try {
      const result = await tenancyClaimApi.confirm({
        phone,
        tenantId: state.selectedTenantId,
        claimToken: state.claimToken,
        acknowledgements: state.acknowledgements,
        typedSignatureName: state.typedSignatureName,
        name: state.name,
        email: state.email,
        // Omitted for an already-signed-in caller -- the backend refuses a
        // password from them (their session already authenticates them).
        ...(state.alreadySignedIn ? {} : { password: state.password }),
      });
      dispatch({ type: 'CONFIRM_SUCCEEDED', result });
      // Claiming a *second* tenancy while already signed in doesn't mint a
      // new session (the backend attaches to the existing profile) — patch
      // the in-memory session so `hasLiveTenancy`/`useAppNav` see it
      // immediately rather than waiting for the next `/auth/me`.
      if (wasSignedInAtStart) {
        updateUser({ tenant_id: result.tenant_id, tenant_status: 'ACTIVE' });
      }
    } catch (err) {
      const extracted = extractError(err);
      dispatch({ type: 'CONFIRM_FAILED', code: extracted.code, message: toErrorLine(resolveError(err, 'claim')) });
    }
  };

  // Mirrors `ActivationPage.tsx`'s `enterStayo`: when `confirm` minted a
  // session (a brand-new or newly-attached unauthenticated claimant), hand
  // it to Supabase's client SDK via `setSession()` so the tenant lands
  // signed in, rather than on a login screen they have no password-free way
  // through.
  const enterStayo = async () => {
    const session = state.result?.session;
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

    // Someone already signed in, claiming a second tenancy, keeps the
    // session `updateUser` patched above in `handleConfirm` -- no new
    // session was ever expected here.
    if (wasSignedInAtStart) {
      navigate('/tenant/home', { replace: true });
      return;
    }

    // No session came back even though this claimant wasn't signed in --
    // the rare case where `tenancy-claim-service.ts`'s session-mint step
    // failed *after* the claim itself durably committed (e.g. Supabase was
    // briefly unreachable). The claim stands; there's nothing to sign
    // straight into here. An ordinary password login (which re-provisions
    // the Supabase identity on every attempt) self-heals once it's
    // reachable again.
    navigate('/login?signin=1', { replace: true });
  };

  return (
    <ThemeProvider theme="product">
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            {state.step === 'phone' && <PhoneStep state={state} dispatch={dispatch} onSubmit={handleSendOtp} />}
            {state.step === 'otp' && <OtpStep state={state} dispatch={dispatch} onSubmit={handleVerifyOtp} onResend={handleSendOtp} />}
            {state.step === 'empty' && <EmptyStep onTryAgain={() => dispatch({ type: 'RESTART' })} />}
            {state.step === 'picker' && <PickerStep state={state} dispatch={dispatch} />}
            {state.step === 'confirm' && <ConfirmStep state={state} dispatch={dispatch} onSubmit={handleConfirm} />}
            {state.step === 'done' && <DoneStep state={state} onEnter={enterStayo} />}
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function PhoneStep({ state, dispatch, onSubmit }: StepProps & { onSubmit: () => void }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground">Claim your tenancy</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        If your owner has been keeping your rent and payment records for you, enter the mobile number they have on
        file to bring them into your own account.
      </p>
      <ErrorBanner message={state.error} />
      <label className="mt-5 block text-sm font-medium text-foreground" htmlFor="claim-phone">
        Mobile number
      </label>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 focus-within:ring-2 focus-within:ring-accent">
        <span className="text-sm text-muted-foreground">+91</span>
        <input
          id="claim-phone"
          type="tel"
          inputMode="numeric"
          autoFocus
          maxLength={10}
          className="w-full bg-transparent text-sm text-foreground outline-none"
          placeholder="98765 43210"
          value={state.phone}
          onChange={(e) => dispatch({ type: 'PHONE_CHANGED', phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
        />
      </div>
      <button
        type="button"
        disabled={!canSendOtp(state.phone) || state.submitting}
        onClick={onSubmit}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {state.submitting ? <StayoLoader size="sm" /> : 'Send code'}
      </button>
    </div>
  );
}

function OtpStep({ state, dispatch, onSubmit, onResend }: StepProps & { onSubmit: () => void; onResend: () => void }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground">Enter the code</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We sent a 6-digit code over WhatsApp to {formatIndianPhone(state.phone)}.
      </p>
      <ErrorBanner message={state.error} />
      <label className="mt-5 block text-sm font-medium text-foreground" htmlFor="claim-otp">
        Verification code
      </label>
      <input
        id="claim-otp"
        type="text"
        inputMode="numeric"
        autoFocus
        maxLength={6}
        className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-center text-lg tracking-[0.4em] text-foreground outline-none focus:ring-2 focus:ring-accent"
        placeholder="——————"
        value={state.otp}
        onChange={(e) => dispatch({ type: 'OTP_CHANGED', otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
      />
      <button
        type="button"
        disabled={!canVerifyOtp(state.otp) || state.submitting}
        onClick={onSubmit}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {state.submitting ? <StayoLoader size="sm" /> : 'Verify'}
      </button>
      <button
        type="button"
        disabled={state.submitting}
        onClick={onResend}
        className="mt-3 w-full text-center text-sm font-medium text-accent disabled:opacity-50"
      >
        Resend code
      </button>
    </div>
  );
}

function EmptyStep({ onTryAgain }: { onTryAgain: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-foreground">Nothing to claim with that number</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn't find a tenancy your owner is keeping records for under this mobile number. If you think this is
        wrong, check the number with your owner and try again.
      </p>
      <button
        type="button"
        onClick={onTryAgain}
        className="mt-5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground"
      >
        Try a different number
      </button>
    </div>
  );
}

function PickerStep({ state, dispatch }: StepProps) {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground">Which one is yours?</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        This number matches more than one record. Pick the one that's you.
      </p>
      <ErrorBanner message={state.error} />
      <div className="mt-4 space-y-2.5">
        {state.tenancies.map((t) => (
          <button
            key={t.tenant_id}
            type="button"
            onClick={() => dispatch({ type: 'SELECT_TENANCY', tenantId: t.tenant_id })}
            className="w-full rounded-xl border border-border p-3.5 text-left hover:border-accent"
          >
            <div className="text-sm font-semibold text-foreground">{t.hostel_name || 'Hostel'}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Room {t.room_no || '—'} · Owner {t.owner_name || '—'}
              {t.joined_on ? ` · Since ${new Date(t.joined_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const ACK_LABELS: Record<AcknowledgementKey, string> = {
  fee_refund_rules: 'I understand the fee and refund rules.',
  discipline_policies: 'I agree to the hostel discipline policies.',
  late_fee_obligations: 'I understand late-fee obligations apply to unpaid rent.',
  damage_liabilities: 'I accept liability for any damage I cause.',
  hostel_rules: 'I have read and accept the hostel rules.',
};

function ConfirmStep({ state, dispatch, onSubmit }: StepProps & { onSubmit: () => void }) {
  const tenancy = selectedTenancy(state);
  if (!tenancy) return null;
  const canGoBack = state.tenancies.length > 1;

  return (
    <div>
      {canGoBack && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'BACK_TO_PICKER' })}
          className="mb-2 -ml-1 flex items-center gap-1 text-sm font-medium text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
      )}
      <h1 className="text-xl font-bold text-foreground">Confirm what you're claiming</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Every payment and receipt already on this record stays exactly as it is — confirming just links it to your
        account.
      </p>
      <ErrorBanner message={state.error} />

      <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
        <div className="text-sm font-semibold text-foreground">{tenancy.hostel_name || 'Hostel'}</div>
        <dl className="mt-2 space-y-1 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <dt>Room</dt>
            <dd className="text-foreground">{tenancy.room_no || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Owner</dt>
            <dd className="text-foreground">{tenancy.owner_name || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Moved in</dt>
            <dd className="text-foreground">
              {tenancy.joined_on ? new Date(tenancy.joined_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            </dd>
          </div>
          {tenancy.monthly_rent != null && (
            <div className="flex justify-between">
              <dt>Monthly rent</dt>
              <dd className="text-foreground">₹{Number(tenancy.monthly_rent).toLocaleString('en-IN')}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-4 space-y-2.5">
        {REQUIRED_ACKNOWLEDGEMENTS.map((key) => (
          <label key={key} className="flex items-start gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={state.acknowledgements[key]}
              onChange={(e) => dispatch({ type: 'ACK_TOGGLED', key, value: e.target.checked })}
            />
            <span>{ACK_LABELS[key]}</span>
          </label>
        ))}
      </div>

      <label className="mt-4 block text-sm font-medium text-foreground" htmlFor="claim-signature">
        Type your full name as your signature
      </label>
      <input
        id="claim-signature"
        type="text"
        className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        placeholder="Your full name"
        value={state.typedSignatureName}
        onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: 'typedSignatureName', value: e.target.value })}
      />

      {!state.alreadySignedIn && (
        <>
          <label className="mt-4 block text-sm font-medium text-foreground" htmlFor="claim-password">
            Create a password
          </label>
          <input
            id="claim-password"
            type="password"
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            placeholder="At least 8 characters"
            value={state.password}
            onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: 'password', value: e.target.value })}
          />
          <label className="mt-3 block text-sm font-medium text-foreground" htmlFor="claim-confirm-password">
            Confirm password
          </label>
          <input
            id="claim-confirm-password"
            type="password"
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            placeholder="Re-enter your password"
            value={state.confirmPassword}
            onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: 'confirmPassword', value: e.target.value })}
          />
          {state.confirmPassword.length > 0 && state.password !== state.confirmPassword && (
            <p className="mt-1.5 text-xs text-destructive">Passwords don't match yet.</p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">You'll use this to sign in going forward.</p>
        </>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground" htmlFor="claim-name">
            Your name <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <input
            id="claim-name"
            type="text"
            className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            value={state.name}
            onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: 'name', value: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground" htmlFor="claim-email">
            Your email <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <input
            id="claim-email"
            type="email"
            className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            value={state.email}
            onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: 'email', value: e.target.value })}
          />
        </div>
      </div>
      {!acknowledgementsComplete(state.acknowledgements) && (
        <p className="mt-3 text-xs text-muted-foreground">All five acknowledgements are required to continue.</p>
      )}

      <button
        type="button"
        disabled={!canConfirm(state) || state.submitting}
        onClick={onSubmit}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {state.submitting ? <StayoLoader size="sm" /> : 'Confirm and claim'}
      </button>
    </div>
  );
}

function DoneStep({ state, onEnter }: { state: ReturnType<typeof initialClaimState>; onEnter: () => void }) {
  const [entering, setEntering] = useState(false);
  if (!state.result) return null;
  return (
    <div className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-foreground">You're in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {state.result.hostel_name || 'Your tenancy'} — Room {state.result.room_no || '—'} — is now linked to your
        account, with every payment and receipt already on it.
      </p>
      <button
        type="button"
        disabled={entering}
        onClick={() => {
          setEntering(true);
          onEnter();
        }}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {entering ? <StayoLoader size="sm" /> : 'Continue'}
      </button>
    </div>
  );
}

interface StepProps {
  state: ReturnType<typeof initialClaimState>;
  dispatch: Dispatch<Parameters<typeof claimReducer>[1]>;
}
