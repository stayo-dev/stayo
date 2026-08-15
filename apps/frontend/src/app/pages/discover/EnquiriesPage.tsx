import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';

import type { DiscoverEnquiry, EnquiryStage } from '@features/discover/api';
import { useEnquiries, useIsSeeker } from '@features/discover/hooks/useDiscover';

import { DiscoverEmpty, PrimaryButton } from './components/DiscoverShell';
import { SignedOutPrompt } from './components/SignedOutPrompt';
import { C, FONT, PHOTO_FALLBACK } from './discoverTheme';

/**
 * The four stages a seeker sees, and what each is honestly claiming.
 * `ACCEPTED` deliberately says "invited", not "approved" — an invitation to
 * join is what the owner actually issued, and it still needs the seeker to
 * act on it.
 */
export const STAGE_META: Record<EnquiryStage, { label: string; bg: string; color: string; blurb: string }> = {
  SENT: {
    label: 'Sent',
    bg: '#FBF1DE',
    color: C.amber,
    blurb: 'Waiting for the owner to open it.',
  },
  REVIEWING: {
    label: 'In progress',
    bg: '#FBF1DE',
    color: C.amber,
    blurb: 'The owner has seen it and is following up.',
  },
  ACCEPTED: {
    label: 'Invited',
    bg: C.greenPale,
    color: C.green,
    blurb: 'The owner invited you to join — check your messages to activate.',
  },
  CLOSED: {
    label: 'Closed',
    bg: '#EFE6DA',
    color: C.textMuted,
    blurb: 'This one did not work out. Plenty of other verified hostels are ready.',
  },
};

export function EnquiriesPage() {
  const navigate = useNavigate();
  const { isSeeker, loading } = useIsSeeker();
  const { data, isLoading } = useEnquiries();

  useEffect(() => {
    document.title = 'Your enquiries — Stayo';
  }, []);

  if (!loading && !isSeeker) {
    return (
      <SignedOutPrompt
        title="Enquiries"
        icon={ClipboardList}
        body="Sign in to send enquiries and track every owner's reply in one place."
        returnTo="/discover/enquiries"
      />
    );
  }

  return (
    <div>
      <header
        className="border-b px-5 pb-4 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Enquiries
        </h1>
        <p className="mt-0.5 text-[12px]" style={{ color: C.textMuted }}>
          Track every request and the owner's reply
        </p>
      </header>

      <section className="px-5 pb-8 pt-4">
        {isLoading && (
          <div className="flex flex-col gap-3.5">
            {[0, 1].map((index) => (
              <div key={index} className="h-[104px] animate-pulse rounded-[18px]" style={{ background: '#EDE4DA' }} />
            ))}
          </div>
        )}

        {!isLoading && (data?.length ?? 0) === 0 && (
          <DiscoverEmpty
            icon={ClipboardList}
            title="Nothing here yet"
            body="You have no enquiries. Find a hostel you like and send your first request."
            action={<PrimaryButton onClick={() => navigate('/discover')}>Find a hostel</PrimaryButton>}
          />
        )}

        <div className="flex flex-col gap-3.5">
          {data?.map((enquiry) => (
            <EnquiryRow
              key={enquiry.id}
              enquiry={enquiry}
              onOpen={() => navigate(`/discover/enquiries/${enquiry.id}`)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function EnquiryRow({ enquiry, onOpen }: { enquiry: DiscoverEnquiry; onOpen: () => void }) {
  const stage = STAGE_META[enquiry.stage];
  const photo = enquiry.hostel.photos[0];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full overflow-hidden rounded-[18px] border bg-white text-left transition-shadow hover:shadow-md"
      style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04),0 6px 16px rgba(40,30,20,.05)' }}
    >
      <div className="flex gap-3 p-4">
        <div
          className="h-[52px] w-[52px] flex-none rounded-xl bg-cover bg-center"
          style={photo ? { backgroundImage: `url(${photo})` } : PHOTO_FALLBACK}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span
              className="min-w-0 flex-1 truncate text-[14px] font-bold tracking-[-0.01em]"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {enquiry.hostel.name}
            </span>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
              style={{ background: stage.bg, color: stage.color }}
            >
              {stage.label}
            </span>
          </div>
          <p className="mt-1 text-[11.5px]" style={{ color: C.textMuted }}>
            {enquiry.hostel.city ?? enquiry.hostel.address}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-[1.5]" style={{ color: C.textFaint }}>
            {stage.blurb}
          </p>
        </div>
      </div>
    </button>
  );
}
