import { ClerkAuthProvider } from '@/app/providers/ClerkAuthProvider';
import { signOutClerk } from '@lib/auth/clerkBrowser';
import { decideCallbackAction, isDiscoverSignupCallback } from '@lib/auth/sessionAuthority';
import { useClerkSessionState } from '@/app/providers/clerkSessionContext';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@lib/supabaseClient';
import api from '@lib/api-client';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * A note on history, for whoever next touches the Discover-provisioning
 * branch below: an earlier version of this page carried the "should this
 * sign-in provision an account" signal in sessionStorage, read by this
 * effect. That flag had to be consumed carefully — deleting it on read broke
 * Google signup outright, because this effect can genuinely run more than
 * once (StrictMode double-invokes it, and `AuthContext` hydrates on every
 * Supabase auth event) and the wrong pass could consume it before the pass
 * that actually saw the 403 got a turn.
 *
 * The current mechanism (`isDiscoverSignupCallback`, `sessionAuthority.ts`)
 * reads the signal off the URL instead — present or absent on every read,
 * nothing to consume, so that whole class of race can't recur.
 */

/**
 * Lands here after `supabase.auth.signInWithOAuth({provider:'google'})`'s
 * full-page redirect (Google → Supabase → back here). Supabase's client
 * processes the session out of the URL automatically (`detectSessionInUrl:
 * true`) before `getSession()` below resolves.
 *
 * Deliberately makes its own `GET /auth/me` call rather than only waiting
 * on AuthContext's `user`/`loading` — this is the one place that needs the
 * *specific* rejection reason (no account for this email / account disabled
 * / tenancy not activated) to show the right message.
 *
 * Since ADR-176 Phase 3.1 a `NO_STAYO_ACCOUNT` rejection is a dead end again,
 * deliberately: authentication never creates a Stayo account. Owners exist
 * after admin approval, tenants after an owner's invitation.
 *
 * `/auth/me` answers 403 with a specific code for those cases and 401 for a
 * token the server could not verify at all. The distinction matters to the
 * person reading the screen: 403 is "your account can't sign in this way"
 * and is actionable by them; 401 here means the deployment itself is
 * misconfigured (it happened — see docs/obsidian/Bugs.md) and no amount of
 * retrying will help, so this stops telling them to try again.
 */
/**
 * Mounts Clerk around the callback so `window.Clerk` is present even on a cold
 * load of this URL (a Clerk redirect arrives as a full navigation, and the SDK
 * global only exists once a provider has mounted). Cheap here and nowhere near
 * the landing page — this route is only ever reached mid-sign-in.
 */
export function AuthCallbackPage() {
  return (
    <ClerkAuthProvider>
      <AuthCallbackInner />
    </ClerkAuthProvider>
  );
}

function AuthCallbackInner() {
  /**
   * Clerk's SDK loads asynchronously, so this must not decide anything until it
   * has settled — see `decideCallbackAction`. `clerk` is null until the provider
   * mounts and `{ isLoaded: false }` while loading; either way this effect
   * re-runs when it changes.
   */
  const clerk = useClerkSessionState();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  /**
   * One callback, one attempt. StrictMode double-invokes effects and
   * `navigate` can change identity, and without this the flow ran several
   * times against the same Supabase session — which is how the provisioning
   * intent came to be read by a pass that was not the one handling the 403.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    const proceed = (data: any, returnTo: string | null) => {
      // Landed somewhere real: this sign-in is done with its intent.
      const role = String(data.role || '').toLowerCase();
      if (role === 'admin') return navigate('/admin', { replace: true });
      if (role === 'owner') return navigate('/owner/home', { replace: true });

      // A returnTo path takes priority — it's the enquiry/page the visitor
      // was actually on. Otherwise, a TENANT-role sign-in only belongs in
      // the Dashboard if they have a live tenancy (INVITED/ACTIVE) — a
      // Discover-only marketplace account has nothing to show at
      // /tenant/home (ProtectedTenantRoute would just bounce it back).
      if (returnTo) return navigate(returnTo, { replace: true });
      const tenantStatus = data.tenant_status ?? null;
      const liveTenancy = tenantStatus === 'INVITED' || tenantStatus === 'ACTIVE';
      navigate(liveTenancy ? '/tenant/home' : '/discover', { replace: true });
    };

    const finish = async () => {
      const { data } = await supabase.auth.getSession();

      /*
       * ADR-176 Phase 3 — this page now lands two different sign-ins.
       *
       * Google goes through Clerk, so the usual arrival has NO Supabase
       * session and a Clerk one instead. The Supabase branch is kept because
       * password sign-in and any redirect still in flight during the migration
       * come back through here too — it is not dead until the final cutover.
       *
       * Nothing below needs to know which it was: `api-client` attaches
       * whichever token exists and `GET /auth/me` accepts both, returning the
       * same shape. Only "is there a session at all" is decided here.
       */
      const action = decideCallbackAction({ hasSupabaseSession: Boolean(data.session), clerk });

      if (action === 'wait') {
        // Clerk has not finished loading. Do not conclude anything yet; the
        // effect re-runs when it settles.
        started.current = false;
        return;
      }

      if (action === 'no-session') {
        if (!cancelled) setError('Google sign-in did not complete. Please try again.');
        return;
      }


      try {
        const response = await api.get('/auth/me');
        if (cancelled) return;
        proceed(response.data, null);
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.response?.status;
        const code = err?.response?.data?.error?.code;
        const serverMessage = err?.response?.data?.error?.message;

        /*
         * ADR-176 Phase 3.1 — authentication never creates a Stayo account,
         * as a general rule. Discover's sign-up tab is the one deliberate,
         * narrow exception (2026-09-23): the same self-serve marketplace
         * seeker `POST /api/auth/tenant-signup` already lets anyone create
         * with a password, no invitation needed, offered through Google too.
         * `isDiscoverSignupCallback` is what tells this apart from every
         * other 403 here — owner login, tenant login, admin all reach this
         * same catch block and take the plain rejection path below unchanged.
         */
        if (status === 403 && code === 'NO_STAYO_ACCOUNT' && isDiscoverSignupCallback(window.location.search)) {
          try {
            await api.post('/auth/discover/google-signup');
            if (cancelled) return;
            const retried = await api.get('/auth/me');
            if (cancelled) return;
            proceed(retried.data, null);
            return;
          } catch (provisionErr: any) {
            if (cancelled) return;
            // Falls through to the ordinary rejection path below, using
            // whichever error actually happened — the provisioning attempt's
            // own (e.g. "email already registered") if it answered one, else
            // the original /auth/me rejection.
            const provisionMessage = provisionErr?.response?.data?.error?.message;
            await supabase.auth.signOut();
            await signOutClerk();
            setError(provisionMessage || serverMessage || 'Could not create your account. Please try again.');
            return;
          }
        }

        await supabase.auth.signOut();
        await signOutClerk();
        if (status === 403 && serverMessage) {
          setError(serverMessage);
        } else if (status === 401) {
          setError(
            'Google verified you, but this Stayo deployment could not accept the session. ' +
              'That is a server configuration problem — please report it rather than retrying.',
          );
        } else {
          setError(serverMessage || 'Google sign-in failed. Please try again.');
        }
      }
    };

    finish();
    return () => {
      cancelled = true;
    };
  }, [navigate, clerk]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/login', { replace: true })}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return <StayoLoadingScreen message="Finishing sign-in…" />;
}
