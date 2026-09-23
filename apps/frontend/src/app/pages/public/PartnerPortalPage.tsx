import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { partnerApi } from '@features/partner/api';
import { countLocked, orderEnquiries, summariseQuota, toEnquiryView } from '@features/partner/model/partnerPortal';
import { PageError } from '@shared/ui/error/PageError';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * A marketplace partner's view of their own listing — reached from the
 * "View my listing" button in `stayo_partner_listing_live`.
 *
 * Unauthenticated by design. A partner is a hostel owner who has no Stayo
 * account, and requiring one here would put the signup we are trying to
 * earn in front of the value we are trying to prove (ADR-231).
 *
 * Every judgement this page makes lives in `model/partnerPortal.ts`, which
 * the node-only test suite covers; this file only draws.
 */
export function PartnerPortalPage() {
  const { token = '' } = useParams<{ token: string }>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['partner-portal', token],
    queryFn: () => partnerApi.getPortal(token),
    enabled: Boolean(token),
    retry: false,
  });

  if (isLoading) return <StayoLoadingScreen />;

  if (isError || !data) {
    const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404;
    return (
      <main className="min-h-screen bg-background px-5 py-16">
        <PageError
          error={notFound ? undefined : error}
          title={notFound ? "We couldn't find that listing" : "We couldn't load your listing"}
          description={
            notFound
              ? 'This link may be mistyped or no longer valid.'
              : 'Your enquiries are safe — we just could not reach them right now.'
          }
          action={
            notFound
              ? 'Check the most recent message we sent you on WhatsApp.'
              : 'Try again in a moment.'
          }
          onRetry={notFound ? undefined : () => refetch()}
          className="mx-auto max-w-md rounded-[20px] border border-border"
        />
      </main>
    );
  }

  const locked = countLocked(data);
  const enquiries = orderEnquiries(data.enquiries);

  return (
    <main className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8">
          <p className="text-sm text-muted-foreground">Stayo</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            Enquiries for {data.partner_name}
          </h1>
        </header>

        <section className="mb-8 space-y-3">
          {data.listings.map((listing) => {
            const quota = summariseQuota({ delivered: listing.delivered, quota: listing.free_quota });
            return (
              <div
                key={listing.hostel?.id ?? listing.hostel?.name}
                className="rounded-[20px] border border-border bg-card p-5"
              >
                <p className="font-semibold text-foreground">{listing.hostel?.name ?? 'Your hostel'}</p>
                {listing.hostel?.city && (
                  <p className="text-sm text-muted-foreground">{listing.hostel.city}</p>
                )}
                <p className="mt-3 text-sm text-muted-foreground">{quota.line}</p>
              </div>
            );
          })}
        </section>

        {/* The gate, stated plainly. A partner who cannot tell why a contact
            is missing reads the page as broken rather than as a choice. */}
        {locked > 0 && (
          <div className="mb-8 rounded-[20px] border border-border bg-muted/40 p-5">
            <p className="font-semibold text-foreground">
              {locked === 1 ? '1 enquiry is waiting for you' : `${locked} enquiries are waiting for you`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Activate your Stayo account to see their contact details and every enquiry after them.
            </p>
            <Link
              to={`/partner/activate/${token}`}
              className="mt-4 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Unlock these enquiries
            </Link>
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Enquiries
          </h2>

          {enquiries.length === 0 && (
            <p className="rounded-[20px] border border-border bg-card p-5 text-sm text-muted-foreground">
              No enquiries yet. We will message you here as soon as a student asks about your hostel.
            </p>
          )}

          {enquiries.map((row) => {
            const view = toEnquiryView(row);
            const body = (
              <>
                <p className="font-medium text-foreground">{view.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{view.detail}</p>
              </>
            );
            return view.href ? (
              <Link
                key={view.id}
                to={view.href}
                className="block rounded-[20px] border border-border bg-card p-5 transition hover:border-primary"
              >
                {body}
              </Link>
            ) : (
              <div key={view.id} className="rounded-[20px] border border-dashed border-border bg-card/60 p-5">
                {body}
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
