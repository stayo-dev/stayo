import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@lib/supabaseClient';
import api from '@lib/api-client';

/**
 * Lands here after `supabase.auth.signInWithOAuth({provider:'google'})`'s
 * full-page redirect (Google → Supabase → back here). Supabase's client
 * processes the session out of the URL automatically (`detectSessionInUrl:
 * true`) before `getSession()` below resolves.
 *
 * Deliberately makes its own `GET /auth/me` call rather than only waiting
 * on AuthContext's `user`/`loading` — this is the one place that needs the
 * *specific* rejection reason (no account for this email / account disabled
 * / tenancy not activated) to show the right message, which is the UI half
 * of the "Google sign-in never auto-provisions an account" invariant.
 * AuthContext's own listener also fires in parallel and will hydrate `user`
 * normally for the rest of the app once this succeeds.
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

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) setError('Google sign-in did not complete. Please try again.');
        return;
      }
      try {
        const response = await api.get('/auth/me');
        if (cancelled) return;
        const role = String(response.data.role || '').toLowerCase();
        if (role === 'admin') navigate('/admin', { replace: true });
        else if (role === 'owner') navigate('/owner/home', { replace: true });
        else navigate('/tenant/home', { replace: true });
      } catch (err: any) {
        if (cancelled) return;
        await supabase.auth.signOut();
        const status = err?.response?.status;
        const serverMessage = err?.response?.data?.error?.message;
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  );
}
