import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@lib/supabaseClient';
import { HostelLeadModal } from '@features/owner-onboarding/components/HostelLeadModal';
import { LandingPage } from './LandingPage';

/**
 * Lands here after `GoogleSignInModal`'s real
 * `supabase.auth.signInWithOAuth({provider:'google'})` redirect (Google →
 * Supabase → back here). Unlike `AuthCallbackPage` (the real `/login`
 * Google flow), this page deliberately never calls `/api/auth/me` or
 * resolves a StayO session — a brand-new lead has no `profiles` row, and
 * `resolveSupabaseSession()` is built to reject exactly that case
 * (ADR-031's "Google never auto-provisions" invariant, correct for login,
 * wrong here). Instead this Supabase session is used only as a
 * client-side identity/anti-spam gate: read the email, show the real
 * details+OTP popup (`HostelLeadModal`, now wired to
 * `POST /leads/self-serve`), then sign out — this identity never becomes
 * a real StayO account. A real account only exists later, after an admin
 * accepts the resulting lead and the owner completes the real onboarding
 * wizard via an activation link.
 */
export function LeadSignupCallbackPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const signedOutRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        navigate('/', { replace: true });
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = userData.user;
      setName(String(user?.user_metadata?.full_name || user?.user_metadata?.name || ''));
      setEmail(String(user?.email || ''));
      setReady(true);
    };

    finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const signOutAndReturn = async () => {
    if (!signedOutRef.current) {
      signedOutRef.current = true;
      await supabase.auth.signOut();
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <LandingPage />
      {!ready ? (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(47,40,35,0.5)] backdrop-blur-[3px]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
        </div>
      ) : (
        <HostelLeadModal open prefillName={name} googleEmail={email} onClose={signOutAndReturn} />
      )}
    </div>
  );
}
