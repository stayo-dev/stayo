import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import { useMockOwnerJourney } from '../context/MockOwnerJourneyContext';
import { JourneyShell } from '../components/JourneyShell';

/**
 * Composed screen simulating the click-through from the activation email —
 * no equivalent in the design source. See LeadSubmittedPage for the same
 * note. `token` is a client-generated mock value; nothing here calls the
 * backend, per the phase-2 "mock data only" instruction.
 */
export function ActivationLinkPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { activate } = useMockOwnerJourney();
  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    setVerifying(true);
    const t = setTimeout(() => {
      setVerifying(false);
      activate();
    }, 700);
    return () => clearTimeout(t);
  }, [token, activate]);

  return (
    <JourneyShell>
      <div className="rounded-2xl border border-border bg-card px-7 py-10 text-center">
        {verifying ? (
          <>
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            </div>
            <h1 className="mb-2 font-display text-xl font-extrabold text-foreground">Opening your invitation…</h1>
            <p className="text-sm text-muted-foreground">This only takes a moment.</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <Check className="h-6 w-6 text-success" strokeWidth={2.8} />
            </div>
            <h1 className="mb-2 font-display text-xl font-extrabold text-foreground">Invitation accepted — your account is activated</h1>
            <p className="mb-7 text-sm text-muted-foreground">Let's build your hostel.</p>
            <button
              type="button"
              onClick={() => navigate('/onboarding')}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)]"
            >
              Continue to onboarding
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>
    </JourneyShell>
  );
}
