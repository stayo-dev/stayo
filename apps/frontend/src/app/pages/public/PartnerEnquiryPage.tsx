import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { partnerApi } from '@features/partner/api';
import { PageError } from '@shared/ui/error/PageError';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * One enquiry, with the student's number — reached from the "View enquiry"
 * button in `stayo_partner_new_enquiry`.
 *
 * This is where the contact exchange actually happens. The public listing
 * never shows the owner's number, and this page shows exactly one student,
 * so a forwarded link leaks a single enquiry rather than the whole listing.
 */
export function PartnerEnquiryPage() {
  const { token = '' } = useParams<{ token: string }>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['partner-enquiry', token],
    queryFn: () => partnerApi.getEnquiry(token),
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
          title={notFound ? "We couldn't find that enquiry" : "We couldn't load this enquiry"}
          description={
            notFound
              ? 'This link may be mistyped or no longer valid.'
              : 'The enquiry is safe — we just could not reach it right now.'
          }
          action={notFound ? 'Check the message we sent you on WhatsApp.' : 'Try again in a moment.'}
          onRetry={notFound ? undefined : () => refetch()}
          className="mx-auto max-w-md rounded-[20px] border border-border"
        />
      </main>
    );
  }

  const { student, unlocked } = data;
  // A WhatsApp deep link, not a tel: — the owner is being asked to reply to
  // a student who contacted them through a chat product, and most will
  // rather message than call a stranger.
  const waHref = student.phone ? `https://wa.me/${student.phone.replace(/\D/g, '')}` : null;

  return (
    <main className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <p className="text-sm text-muted-foreground">Enquiry for {data.hostel_name ?? 'your hostel'}</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{student.name ?? 'A student'}</h1>

        {unlocked ? (
          <div className="mt-6 space-y-4 rounded-[20px] border border-border bg-card p-5">
            {student.phone && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Phone</p>
                <p className="font-medium text-foreground">{student.phone}</p>
              </div>
            )}
            {student.email && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                <p className="font-medium text-foreground">{student.email}</p>
              </div>
            )}
            {student.note && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">What they said</p>
                <p className="text-foreground">{student.note}</p>
              </div>
            )}
            {waHref && (
              <a
                href={waHref}
                className="mt-2 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                Reply on WhatsApp
              </a>
            )}
          </div>
        ) : (
          /* Locked. Says what is missing and what opens it — a blank card
             would read as a fault rather than a decision. */
          <div className="mt-6 rounded-[20px] border border-dashed border-border bg-card/60 p-5">
            <p className="text-foreground">This enquiry is waiting for you.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Activate your Stayo account to see their contact details.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
