import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@lib/supabaseClient';
import api from '@lib/api-client';
import { GOOGLE_PROVISION_INTENT_KEY, GOOGLE_RETURN_TO_KEY } from '@context/AuthContext';
import { shouldProvisionAccount } from './authCallbackDecision';
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
 * So the flag is now cleared only by `clearProvisionIntent()`, once the flow
 * has genuinely finished — see below.
 */
function readProvisionIntent(): { allowed: boolean; returnTo: string | null } {
  try {
    return {
      allowed: sessionStorage.getItem(GOOGLE_PROVISION_INTENT_KEY) === '1',
      returnTo: sessionStorage.getItem(GOOGLE_RETURN_TO_KEY),
    };
  } catch {
    return { allowed: false, returnTo: null };
  }
}

/**
 * Clear the intent once this sign-in has resolved either way.
 *
 * Called on success and on terminal failure — never mid-flight — so a retry
 * within the same tab starts clean, but a re-run of this effect cannot strip
 * the intent out from under itself.
 */
function clearProvisionIntent() {
  try {
    sessionStorage.removeItem(GOOGLE_PROVISION_INTENT_KEY);
    sessionStorage.removeItem(GOOGLE_RETURN_TO_KEY);
  } catch {
    /* private mode — nothing to clear */
  }
}

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
 * Since 2026-08-16: a `NO_STAYO_ACCOUNT` rejection is no longer necessarily
 * a dead end. If `AuthContext.loginWithGoogleAllowProvision()` marked this
 * attempt as provisioning-allowed (`GOOGLE_PROVISION_INTENT_KEY`), this page
 * calls `POST /api/auth/google/provision` — which creates the account only
 * if this is genuinely a new email — then retries `/auth/me`, which now
 * resolves normally. `resolveSupabaseSession()` itself is untouched; the
 * provisioning path is a separate, narrower function
 * (`lib/auth/supabase-provision.ts` on the backend).
 *
 * `/auth/me` answers 403 with a specific code for those cases and 401 for a
 * token the server could not verify at all. The distinction matters to the
 * person reading the screen: 403 is "your account can't sign in this way"
 * and is actionable by them; 401 here means the deployment itself is
 * misconfigured (it happened — see docs/obsidian/Bugs.md) and no amount of
 * retrying will help, so this stops telling them to try again.
 */
export function AuthCallbackPage() {
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
      clearProvisionIntent();
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
      if (!data.session) {
        if (!cancelled) setError('Google sign-in did not complete. Please try again.');
        return;
      }

      const { allowed: provisionAllowed, returnTo } = readProvisionIntent();

      try {
        const response = await api.get('/auth/me');
        if (cancelled) return;
        proceed(response.data, returnTo);
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.response?.status;
        const code = err?.response?.data?.error?.code;
        const serverMessage = err?.response?.data?.error?.message;

        if (shouldProvisionAccount({ status, code, provisionAllowed })) {
          try {
            await api.post('/auth/google/provision');
            const retry = await api.get('/auth/me');
            if (cancelled) return;
            proceed(retry.data, returnTo);
            return;
          } catch (provisionErr: any) {
            if (cancelled) return;
            clearProvisionIntent();
            await supabase.auth.signOut();
            setError(
              provisionErr?.response?.data?.error?.message ||
                'Could not create your Stayo account. Please try again.',
            );
            return;
          }
        }

        clearProvisionIntent();
        await supabase.auth.signOut();
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
  }, [navigate]);

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
