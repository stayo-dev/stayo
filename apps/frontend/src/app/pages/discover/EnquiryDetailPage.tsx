import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft, Clock, Info } from 'lucide-react';

import type { EnquiryStage } from '@features/discover/api';
import { useEnquiry } from '@features/discover/hooks/useDiscover';

import { DiscoverEmpty, PrimaryButton } from './components/DiscoverShell';
import { STAGE_META } from './EnquiriesPage';
import { C, FONT, PHOTO_FALLBACK } from './discoverTheme';

/** How far along the three visible steps a given stage sits. */
const STEP_INDEX: Record<EnquiryStage, number> = {
  SENT: 0,
  REVIEWING: 1,
  ACCEPTED: 2,
  CLOSED: 2,
};

export function EnquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useEnquiry(id);

  useEffect(() => {
    document.title = 'Enquiry — Stayo';
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] space-y-4 p-5 pt-24">
        <div className="h-20 animate-pulse rounded-2xl" style={{ background: '#EDE4DA' }} />
        <div className="h-40 animate-pulse rounded-2xl" style={{ background: '#F2ECE5' }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-[100dvh] pt-24">
        <DiscoverEmpty
          icon={Info}
          title="Enquiry not found"
          body="We couldn't find this enquiry on your account."
          action={<PrimaryButton onClick={() => navigate('/discover/enquiries')}>Back to enquiries</PrimaryButton>}
        />
      </div>
    );
  }

  const stage = STAGE_META[data.stage];
  const current = STEP_INDEX[data.stage];
  const closed = data.stage === 'CLOSED';

  const steps = [
    { title: 'Enquiry sent', sub: 'Your details were shared with the owner' },
    { title: 'Owner reviewing', sub: 'They usually reply within a day' },
    {
      title: closed ? 'Closed' : 'Invitation to join',
      sub: closed
        ? 'This hostel could not take it forward'
        : 'If they accept, you get an invite to activate your stay',
    },
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        className="flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/discover/enquiries')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <h1 className="text-[19px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Your enquiry
        </h1>
      </header>

      <main className="flex-1 space-y-4 px-5 py-5">
        {/* Hostel */}
        <button
          type="button"
          onClick={() => data.hostel.slug && navigate(`/discover/h/${data.hostel.slug}`)}
          className="flex w-full gap-3.5 rounded-[18px] border bg-white p-4 text-left"
          style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
        >
          <div
            className="h-14 w-14 flex-none rounded-xl bg-cover bg-center"
            style={data.hostel.photos[0] ? { backgroundImage: `url(${data.hostel.photos[0]})` } : PHOTO_FALLBACK}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
              {data.hostel.name}
            </p>
            <p className="mt-0.5 truncate text-[11.5px]" style={{ color: C.textMuted }}>
              {[data.hostel.address, data.hostel.city].filter(Boolean).join(', ')}
            </p>
            <span
              className="mt-2 inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold"
              style={{ background: stage.bg, color: stage.color }}
            >
              {stage.label}
            </span>
          </div>
        </button>

        {/* Timeline */}
        <div
          className="rounded-[18px] border bg-white p-5"
          style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
        >
          {steps.map((step, index) => {
            const done = index < current || (index === current && data.stage === 'ACCEPTED');
            const active = index === current && !done;
            const last = index === steps.length - 1;

            return (
              <div key={step.title} className="flex gap-3.5">
                <div className="flex flex-none flex-col items-center">
                  <span
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-full"
                    style={{
                      background: done ? C.green : active ? C.ink : '#F0EAE2',
                      border: done || active ? 'none' : '2px solid #E0D6CA',
                    }}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.6} />
                    ) : (
                      <Clock
                        className="h-3.5 w-3.5"
                        strokeWidth={2.2}
                        style={{ color: active ? '#fff' : C.textGhost }}
                      />
                    )}
                  </span>
                  {!last && (
                    <span
                      className="w-0.5 flex-1"
                      style={{ minHeight: 24, background: done ? C.green : '#EAE1D8' }}
                    />
                  )}
                </div>

                <div className={last ? '' : 'pb-5'}>
                  <p
                    className="text-[13.5px] font-bold"
                    style={{ fontFamily: FONT.display, color: done || active ? C.text : C.textFaint }}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-[1.5]" style={{ color: C.textFaint }}>
                    {step.sub}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* What the seeker asked for, echoed back verbatim */}
        {data.notes && (
          <div
            className="rounded-[18px] border bg-white p-4"
            style={{ borderColor: C.line }}
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: '#A2978B' }}>
              What you sent
            </p>
            <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
              {data.notes}
            </p>
          </div>
        )}

        <p className="px-1 text-[11.5px] leading-[1.5]" style={{ color: C.textFaint }}>
          Sent {new Date(data.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </main>

      {data.stage === 'CLOSED' && (
        <div
          className="sticky bottom-0 flex-none border-t px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3"
          style={{ background: C.cardWarm, borderColor: C.line }}
        >
          <PrimaryButton full onClick={() => navigate('/discover/search')}>
            See similar hostels
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
