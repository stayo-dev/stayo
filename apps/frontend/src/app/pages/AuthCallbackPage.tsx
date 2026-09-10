import { ClerkAuthProvider } from '@/app/providers/ClerkAuthProvider';
import { signOutClerk } from '@lib/auth/clerkBrowser';
import { decideCallbackAction } from '@lib/auth/sessionAuthority';
import { useClerkSessionState } from '@/app/providers/clerkSessionContext';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@lib/supabaseClient';
import api from '@lib/api-client';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * Reads the sign-in intent WITHOUT destroying it.
 *
 * It used to delete on read, which silently broke Google signup: this effect
 * can run more than once (React StrictMode double-invokes it, and
 * `AuthContext` hydrates on every Supabase auth event, so several passes race
 * over the same callback). The first pass consumed the flag; whichever pass
 * actually received the 403 then saw `allowed: false` and rendered "No account
 * found" instead of creating the account. The POST never happened at all.
 *
 * has genuinely finished — see below.
 */

/**
 * Clear the intent once this sign-in has resolved either way.
 *
 * Called on success and on terminal failure — never mid-flight — so a retry
 * within the same tab starts clean, but a re-run of this effect cannot strip
 * the intent out from under itself.
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

      // A returnTo path takes priority — it's the page the visitor was
      // actually on. Otherwise, a TENANT-role sign-in only belongs in the
      // Dashboard if they have a live tenancy (INVITED/ACTIVE); without one
      // there is nothing at /tenant/home (ProtectedTenantRoute would just
      // bounce it back). v1 (ADR-170): no marketplace, so the fallback is
      // the shared Profile hub.
      if (returnTo) return navigate(returnTo, { replace: true });
      const tenantStatus = data.tenant_status ?? null;
      const liveTenancy = tenantStatus === 'INVITED' || tenantStatus === 'ACTIVE';
      navigate(liveTenancy ? '/tenant/home' : '/profile', { replace: true });
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
         * ADR-176 Phase 3.1 — authentication never creates a Stayo account.
         *
         * This used to call `POST /auth/google/provision` when the sign-in was
         * marked provisioning-allowed, creating a marketplace tenant for an
         * unknown Google email (ADR-078). Onboarding is controlled: owners
         * exist after admin approval, tenants after an owner's invitation. An
         * unknown email is now simply NO_STAYO_ACCOUNT, handled below like any
         * other 403.
         */
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
