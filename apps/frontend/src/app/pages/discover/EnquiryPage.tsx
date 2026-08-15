import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Lock, ShieldCheck } from 'lucide-react';

import { useCreateEnquiry, useDiscoverListing, useIsSeeker } from '@features/discover/hooks/useDiscover';

import { useDiscoverAuth } from './DiscoverAuthContext';
import { PrimaryButton } from './components/DiscoverShell';
import { C, FONT, PHOTO_FALLBACK, formatRupees } from './discoverTheme';

const DURATIONS = [3, 6, 12];

/** Move-in options as real dates, so the owner reads a date and not "soon". */
function moveInChoices(): { value: string; day: string; label: string }[] {
  const today = new Date();
  const make = (offsetDays: number, label?: string) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offsetDays);
    return {
      value: date.toISOString().slice(0, 10),
      day: String(date.getDate()).padStart(2, '0'),
      label: label ?? date.toLocaleDateString('en-IN', { month: 'short' }),
    };
  };
  return [make(0, 'Today'), make(1, 'Tomorrow'), make(7), make(15), make(30)];
}

export function EnquiryPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isSeeker, loading: authLoading, user } = useIsSeeker();
  const { openSignIn } = useDiscoverAuth();

  const seeded = (location.state ?? {}) as { roomCapacity?: number; hostelName?: string };

  const { data } = useDiscoverListing(slug);
  const createEnquiry = useCreateEnquiry();

  const choices = useMemo(moveInChoices, []);
  const [moveIn, setMoveIn] = useState(choices[0].value);
  const [duration, setDuration] = useState(6);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hostel = data?.hostel;
  const capacity = seeded.roomCapacity;

  useEffect(() => {
    document.title = 'Send an enquiry — Stayo';
  }, []);

  const submit = () => {
    setError(null);
    if (!slug) return;
    createEnquiry.mutate(
      { slug, roomCapacity: capacity, moveInDate: moveIn, durationMonths: duration, message: message.trim() || undefined },
      {
        onSuccess: (enquiry) => navigate(`/discover/enquiries/${enquiry.id}`, { replace: true }),
        onError: (mutationError: any) =>
          setError(
            mutationError?.response?.data?.message ??
              'Could not send your enquiry. Please try again.',
          ),
      },
    );
  };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        className="flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
            Send an enquiry
          </h1>
          <p className="text-[11.5px]" style={{ color: C.textMuted }}>
            The owner replies to you directly
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-6 px-5 py-5">
        {/* What they're enquiring about */}
        <div
          className="flex gap-3.5 rounded-[18px] border bg-white p-4"
          style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
        >
          <div
            className="h-16 w-16 flex-none rounded-xl bg-cover bg-center"
            style={hostel?.photos?.[0] ? { backgroundImage: `url(${hostel.photos[0]})` } : PHOTO_FALLBACK}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
              {hostel?.name ?? seeded.hostelName ?? 'This hostel'}
            </p>
            <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>
              {capacity
                ? capacity === 1
                  ? 'Single room'
                  : `${capacity}-bed sharing`
                : 'Any available bed'}
              {hostel?.city ? ` · ${hostel.city}` : ''}
            </p>
            {hostel?.starting_price != null && (
              <p className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[16px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
                  ₹{formatRupees(hostel.starting_price)}
                </span>
                <span className="text-[11px]" style={{ color: C.textMuted }}>/mo onwards</span>
              </p>
            )}
          </div>
        </div>

        {/* Move-in */}
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Move-in date
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {choices.map((choice) => {
              const active = moveIn === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setMoveIn(choice.value)}
                  aria-pressed={active}
                  className="flex-none rounded-[13px] px-4 py-2.5 text-center"
                  style={{
                    background: active ? C.ink : '#fff',
                    border: active ? `2px solid ${C.ink}` : `1px solid ${C.lineInput}`,
                  }}
                >
                  <span className="block text-[15px] font-bold" style={{ fontFamily: FONT.display, color: active ? '#fff' : C.text }}>
                    {choice.day}
                  </span>
                  <span className="mt-0.5 block text-[10.5px]" style={{ color: active ? '#B9AFA3' : C.textMuted }}>
                    {choice.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Duration */}
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            How long will you stay?
          </h2>
          <div className="flex gap-2">
            {DURATIONS.map((months) => {
              const active = duration === months;
              return (
                <button
                  key={months}
                  type="button"
                  onClick={() => setDuration(months)}
                  aria-pressed={active}
                  className="flex-1 rounded-xl py-3 text-center text-[12.5px] font-semibold"
                  style={{
                    background: active ? C.clayPaleBg : '#fff',
                    border: active ? `1.5px solid ${C.clay}` : `1px solid ${C.lineInput}`,
                    color: active ? '#A4482F' : C.textBody,
                  }}
                >
                  {months} months
                </button>
              );
            })}
          </div>
        </section>

        {/* Message */}
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Anything to add?
          </h2>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
            rows={3}
            placeholder="Tell the owner anything useful — your college, when you can visit, questions about the room."
            className="w-full resize-none rounded-[13px] border bg-white px-3.5 py-3 text-[13.5px] outline-none"
            style={{ borderColor: C.lineInput, color: C.inkSoft }}
          />
        </section>

        {/* Identity */}
        {isSeeker ? (
          <section
            className="flex items-start gap-3 rounded-2xl border p-4"
            style={{ background: '#fff', borderColor: C.line }}
          >
            <ShieldCheck className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.green }} />
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold" style={{ color: C.inkSoft }}>
                Sending as {user?.name ?? 'your Stayo account'}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-[1.5]" style={{ color: C.textMuted }}>
                The owner sees your name, phone and email so they can reply.
              </p>
            </div>
          </section>
        ) : (
          <section
            className="rounded-2xl border p-4"
            style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}
          >
            <div className="flex items-start gap-3">
              <Lock className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.clay }} />
              <div>
                <p className="text-[13px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                  Sign in to send this
                </p>
                <p className="mt-1 text-[11.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
                  A Stayo account keeps your enquiries in one place and lets owners reply. It's the same
                  account you'll use to move in — anywhere on Stayo.
                </p>
              </div>
            </div>
            <div className="mt-3.5">
              <PrimaryButton full onClick={() => openSignIn()}>
                Sign in or create account
              </PrimaryButton>
            </div>
          </section>
        )}

        {error && (
          <p
            className="rounded-xl px-3.5 py-3 text-[12.5px] font-medium"
            style={{ background: '#F7E4DF', color: '#B3402F' }}
            role="alert"
          >
            {error}
          </p>
        )}
      </main>

      <div
        className="sticky bottom-0 flex-none border-t px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <PrimaryButton
          full
          disabled={!isSeeker || authLoading || createEnquiry.isPending}
          onClick={submit}
        >
          {createEnquiry.isPending ? 'Sending…' : 'Send enquiry to owner'}
        </PrimaryButton>
      </div>
    </div>
  );
}
