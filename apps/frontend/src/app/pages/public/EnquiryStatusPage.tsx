import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { hostelLeadsApi } from '@features/hostel-leads/api';

/**
 * Public enquiry-status page, reached from the "Track Status" button in the
 * stayo_owner_lead_received WhatsApp template and from the lead-submission
 * success screen. Unauthenticated by design — a prospective owner has no
 * account yet (design doc D1).
 */
export function EnquiryStatusPage() {
  const { token = '' } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['enquiry-status', token],
    queryFn: () => hostelLeadsApi.getEnquiryStatus(token),
    enabled: Boolean(token),
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#FDF8F3] px-5 py-16">
        <div className="mx-auto max-w-md animate-pulse space-y-4">
          <div className="h-6 w-2/3 rounded bg-black/10" />
          <div className="h-32 rounded-2xl bg-black/5" />
        </div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen bg-[#FDF8F3] px-5 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-black/10 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-[#2B1B12]">We couldn't find that enquiry</h1>
          <p className="mt-2 text-sm text-[#6B5B52]">
            This link may be mistyped or no longer valid. If you submitted an enquiry recently,
            check the most recent message we sent you on WhatsApp.
          </p>
          <Link to="/" className="mt-5 inline-block text-sm font-medium text-[#B45309] underline">
            Back to Stayo
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FDF8F3] px-5 py-16">
      <div className="mx-auto max-w-md space-y-5">
        <header>
          <p className="text-xs uppercase tracking-wide text-[#6B5B52]">Your enquiry</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#2B1B12]">{data.hostel_name}</h1>
          <p className="mt-1 text-sm text-[#6B5B52]">
            Submitted {new Date(data.submitted_at).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </p>
        </header>

        <section className="rounded-2xl border border-black/10 bg-white p-5">
          <ol className="space-y-4">
            {data.timeline.map((stage) => (
              <li key={stage.key} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={
                    stage.state === 'done'
                      ? 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#15803D]'
                      : stage.state === 'current'
                        ? 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#B45309] ring-4 ring-[#B45309]/20'
                        : 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-black/20 bg-transparent'
                  }
                />
                <span
                  className={
                    stage.state === 'pending'
                      ? 'text-sm text-[#9A8B82]'
                      : 'text-sm font-medium text-[#2B1B12]'
                  }
                >
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {data.applicant_message ? (
          <section className="rounded-2xl border border-[#B45309]/20 bg-[#FEF6EC] p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#B45309]">
              Message from our team
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm text-[#2B1B12]">{data.applicant_message}</p>
          </section>
        ) : null}

        {!data.is_terminal ? (
          <p className="px-1 text-center text-xs text-[#6B5B52]">
            We'll message you on WhatsApp as soon as there's an update. You can return to this page any time.
          </p>
        ) : null}
      </div>
    </main>
  );
}
