import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { partnerApi } from '@features/partner/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { PageError } from '@shared/ui/error/PageError';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * Claiming a Stayo-authored listing — reached from "Unlock this enquiry" in
 * `stayo_partner_enquiry_locked`.
 *
 * Deliberately framed as an upgrade, never a signup: the listing exists,
 * the enquiries exist, and claiming hands both over. Nothing is rebuilt
 * (ADR-231).
 *
 * The claim itself needs an owner session — the one authenticated route
 * under the public `/api/partner` prefix. Someone arriving without an
 * account is sent to owner signup and comes back to this same link.
 */
export function PartnerActivatePage() {
  const { token = '' } = useParams<{ token: string }>();
  const session = useOwnerSession();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['partner-activation', token],
    queryFn: () => partnerApi.getActivation(token),
    enabled: Boolean(token),
    retry: false,
  });

  const claim = useMutation({
    mutationFn: () => partnerApi.claim(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-activation', token] });
      queryClient.invalidateQueries({ queryKey: ['partner-portal'] });
    },
  });

  if (isLoading || session.isLoading) return <StayoLoadingScreen />;

  if (isError || !data) {
    const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404;
    return (
      <main className="min-h-screen bg-background px-5 py-16">
        <PageError
          error={notFound ? undefined : error}
          title={notFound ? "We couldn't find that listing" : "We couldn't load this page"}
          description={
            notFound
              ? 'This link may be mistyped or no longer valid.'
              : 'Nothing has changed — we just could not reach it right now.'
          }
          action={notFound ? 'Check the message we sent you on WhatsApp.' : 'Try again in a moment.'}
          onRetry={notFound ? undefined : () => refetch()}
          className="mx-auto max-w-md rounded-[20px] border border-border"
        />
      </main>
    );
  }

  if (claim.isSuccess || data.already_converted) {
    return (
      <main className="min-h-screen bg-background px-5 py-16">
        <div className="mx-auto w-full max-w-md rounded-[20px] border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">
            {data.hostels[0]?.name ?? 'Your hostel'} is yours
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {claim.data?.released_enquiries
              ? `${claim.data.released_enquiries} held ${claim.data.released_enquiries === 1 ? 'enquiry is' : 'enquiries are'} now in your dashboard.`
              : 'Everything we were holding is now in your dashboard.'}
          </p>
          <Link
            to="/owner"
            className="mt-5 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Open dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-semibold text-foreground">
          Hello {data.partner_name}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {data.held_enquiries > 0
            ? `${data.held_enquiries} ${data.held_enquiries === 1 ? 'student is' : 'students are'} waiting to hear from you.`
            : 'Take over your listing on Stayo.'}
        </p>

        <div className="mt-6 rounded-[20px] border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">You will manage</p>
          <ul className="mt-2 space-y-1">
            {data.hostels.map((h) => (
              <li key={h.id} className="font-medium text-foreground">
                {h.name}
                {h.city ? <span className="text-muted-foreground"> · {h.city}</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            Your listing stays exactly as it is. Nothing is rebuilt.
          </p>
        </div>

        {claim.isError && (
          <p className="mt-4 text-sm text-destructive">
            We could not complete this. Nothing has changed — please try again.
          </p>
        )}

        {session.isAuthenticated ? (
          <button
            type="button"
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
            className="mt-6 w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {claim.isPending ? 'Claiming…' : 'Claim my listing'}
          </button>
        ) : (
          /* No account yet — which is the normal case here, and the whole
             point of the funnel. Signup returns to this same link. */
          <Link
            to={`/owners?next=${encodeURIComponent(`/partner/activate/${token}`)}`}
            className="mt-6 block w-full rounded-full bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground"
          >
            Create your Stayo account
          </Link>
        )}
      </div>
    </main>
  );
}
