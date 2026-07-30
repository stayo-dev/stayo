import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { hostelLeadsApi } from '@features/hostel-leads/api';

/**
 * Owner-acquisition funnel, phase 2. Lands here from the activation link an
 * admin's "Approve Lead" action sends (WhatsApp, email fallback — see
 * lead-invitation-service.ts). Fetches the token's context (never the
 * lead's raw id — see GET /api/leads/invitation/[token]) and, on success,
 * hands the prefill data + token to the real onboarding wizard via router
 * state. Distinct copy for invalid/expired/already-used, mirroring
 * ActivateAccountPage.tsx's pattern for the equivalent tenant flow.
 */
export function OwnerLeadInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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
        const prefill = await hostelLeadsApi.getInvitationContext(token);
        if (cancelled) return;
        navigate('/onboarding', { replace: true, state: { prefill, token } });
      } catch (err: any) {
        if (cancelled) return;
        setErrorCode(err?.response?.data?.error?.code || 'INVALID');
        setErrorMessage(err?.response?.data?.error?.message || '');
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

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
      <Link to="/" className="mt-5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
        Back to StayO
      </Link>
    </div>
  );
}
