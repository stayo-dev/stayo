import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { supabase } from '@lib/supabaseClient';
import { hostelLeadsApi } from '@features/hostel-leads/api';
import { PENDING_LEAD_TOKEN_KEY } from '@features/owner-onboarding/components/HostelLeadModal';
import { LandingPage } from './LandingPage';

type Outcome = 'working' | 'linked' | 'skipped';

/**
 * Lands here after the optional "Add my email with Google" step at the end of
 * lead capture (Google → Supabase → back here).
 *
 * The lead already exists by this point — it was saved at the phone step — so
 * this page's only job is to attach the email to it and confirm. That is the
 * whole reason Google moved to the end: if the visitor never got here, or the
 * link fails, we still have an actionable lead.
 *
 * As before, this Supabase session is never resolved into a StayO session:
 * a brand-new lead has no `profiles` row, and `resolveSupabaseSession()`
 * deliberately rejects exactly that case (ADR-031's "Google never
 * auto-provisions" invariant). The identity is read, used, and signed out.
 */
export function LeadSignupCallbackPage() {
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<Outcome>('working');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;

    const finish = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        navigate('/', { replace: true });
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const email = String(userData.user?.email || '');

      let token = '';
      try {
        token = window.sessionStorage.getItem(PENDING_LEAD_TOKEN_KEY) || '';
        window.sessionStorage.removeItem(PENDING_LEAD_TOKEN_KEY);
      } catch {
        // Storage blocked — nothing to link against.
      }

      if (email && token) {
        try {
          await hostelLeadsApi.linkLeadEmail(token, email);
          if (!cancelled) setOutcome('linked');
        } catch {
          // The lead is already saved and an admin can still reach them by
          // phone, so a failed link is a non-event — never show it as an error.
          if (!cancelled) setOutcome('skipped');
        }
      } else if (!cancelled) {
        setOutcome('skipped');
      }

      // This identity never becomes a StayO account.
      await supabase.auth.signOut().catch(() => {});
    };

    finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <LandingPage />
      <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(47,40,35,0.5)] px-5 backdrop-blur-[3px]">
        {outcome === 'working' ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <div className="w-full max-w-[400px] rounded-[22px] bg-card p-7 text-center shadow-[0_40px_90px_-30px_rgba(47,47,47,0.5)]">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <Check className="h-6 w-6 text-success" strokeWidth={2.8} />
            </div>
            <h1 className="mb-2 font-display text-xl font-extrabold text-foreground">
              {outcome === 'linked' ? "Email added — you're all set" : "You're all set"}
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              {outcome === 'linked'
                ? "We'll reach out on WhatsApp, and keep your email posted too."
                : "Your enquiry is saved. We'll reach out on WhatsApp shortly."}
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="rounded-xl bg-primary px-6 py-3 font-display text-sm font-bold text-primary-foreground"
            >
              Back to Stayo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
