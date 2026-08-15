import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronLeft, Eye, EyeOff, Info, X } from 'lucide-react';

import type { DisclosureEntry, ResidencyStay } from '@features/profile/api';
import {
  useDisclosures,
  useResidencyHistory,
  useSetDisclosure,
} from '@features/profile/hooks/useProfileIdentity';

import { DiscoverEmpty, PrimaryButton } from './components/DiscoverShell';
import { C, FONT, formatRupees } from './discoverTheme';

/**
 * The tenant's own residency history, and their control over who sees it.
 *
 * Both halves live on one screen deliberately: showing someone their record
 * without showing them who is reading it is the half that erodes trust rather
 * than building it.
 */
export function ResidencyHistoryPage() {
  const navigate = useNavigate();
  const { data: history, isLoading } = useResidencyHistory();
  const { data: disclosures } = useDisclosures();
  const setDisclosure = useSetDisclosure();

  useEffect(() => {
    document.title = 'Your stay history — Stayo';
  }, []);

  const stays = history?.stays ?? [];
  const pending = disclosures?.pending_requests ?? [];
  const shared = disclosures?.shared_with ?? [];
  const blocked = disclosures?.blocked ?? [];

  return (
    <div className="flex min-h-[100dvh] flex-col" style={{ background: C.paper }}>
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/discover/profile')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
            Your stay history
          </h1>
          <p className="text-[11.5px]" style={{ color: C.textMuted }}>
            {isLoading
              ? 'Loading…'
              : `${history?.total_stays ?? 0} past ${history?.total_stays === 1 ? 'stay' : 'stays'} · ${history?.total_months ?? 0} months on Stayo`}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-7 px-5 py-5">
        {/* Requests come first — they need an answer. */}
        {pending.length > 0 && (
          <section>
            <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
              Waiting on you
            </h2>
            <div className="flex flex-col gap-2.5">
              {pending.map((request) => (
                <div
                  key={request.hostel_id}
                  className="rounded-2xl border p-4"
                  style={{ background: '#fff', borderColor: C.clay }}
                >
                  <p className="text-[13.5px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                    {request.hostel_name}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-[1.5]" style={{ color: C.textMuted }}>
                    wants to see where you've stayed before. They'll see the hostels, dates, room and
                    rent — never why you left or any note an owner wrote about you.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDisclosure.mutate({ hostelId: request.hostel_id, status: 'APPROVED' })
                      }
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold text-white"
                      style={{ fontFamily: FONT.display, background: C.clayDeep }}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Share
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDisclosure.mutate({ hostelId: request.hostel_id, status: 'DECLINED' })
                      }
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[12.5px] font-semibold"
                      style={{ borderColor: C.lineInput, color: C.textBody }}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Not now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The history itself */}
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Where you've stayed
          </h2>

          {!isLoading && stays.length === 0 && (
            <DiscoverEmpty
              icon={Building2}
              title="No stays yet"
              body="Once you move into a hostel through Stayo, it'll appear here — and you can share it with the next owner instead of starting from scratch."
              action={<PrimaryButton onClick={() => navigate('/discover')}>Find a hostel</PrimaryButton>}
            />
          )}

          <div className="flex flex-col gap-3">
            {stays.map((stay) => (
              <StayCard key={stay.id} stay={stay} />
            ))}
          </div>
        </section>

        {/* Who can see it */}
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Who can see this
          </h2>

          {shared.length === 0 && blocked.length === 0 && (
            <p className="px-1 text-[12px] leading-[1.55]" style={{ color: C.textMuted }}>
              Nobody yet. A hostel can see your history once you enquire to them or move in — and you
              can turn that off here at any time.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {shared.map((entry) => (
              <DisclosureRow
                key={entry.hostel_id}
                entry={entry}
                onToggle={() => setDisclosure.mutate({ hostelId: entry.hostel_id, status: 'REVOKED' })}
              />
            ))}
            {blocked.map((entry) => (
              <DisclosureRow
                key={entry.hostel_id}
                entry={entry}
                onToggle={() => setDisclosure.mutate({ hostelId: entry.hostel_id, status: 'APPROVED' })}
              />
            ))}
          </div>
        </section>

        <div
          className="flex gap-3 rounded-2xl border p-4"
          style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}
        >
          <Info className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.clay }} />
          <p className="text-[11.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
            Owners only ever see facts: which hostel, how long, which room, what rent, and whether you
            settled up. Why you left, and anything an owner wrote about you, stays private.
          </p>
        </div>
      </main>
    </div>
  );
}

function StayCard({ stay }: { stay: ResidencyStay }) {
  const period = [
    stay.joined_on ? new Date(stay.joined_on).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : null,
    stay.is_current
      ? 'now'
      : stay.exit_date
        ? new Date(stay.exit_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        : null,
  ]
    .filter(Boolean)
    .join(' → ');

  return (
    <article
      className="rounded-[18px] border bg-white p-4"
      style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14.5px] font-bold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
            {stay.hostel.name ?? 'A hostel on Stayo'}
          </h3>
          <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>
            {[stay.hostel.city, period].filter(Boolean).join(' · ')}
          </p>
        </div>
        {stay.is_current ? (
          <span
            className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
            style={{ background: C.greenPale, color: C.green }}
          >
            Living here
          </span>
        ) : (
          stay.settled && (
            <span
              className="flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
              style={{ background: C.greenPale, color: C.green }}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
              Settled
            </span>
          )
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Fact label="Stayed" value={stay.duration_months ? `${stay.duration_months} mo` : '—'} />
        <Fact
          label="Room"
          value={
            stay.room_no
              ? `${stay.room_no}${stay.sharing ? ` · ${stay.sharing}-bed` : ''}`
              : stay.sharing
                ? `${stay.sharing}-bed`
                : '—'
          }
        />
        <Fact label="Rent" value={stay.monthly_rent ? `₹${formatRupees(stay.monthly_rent)}` : '—'} />
      </dl>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-[0.04em]" style={{ color: C.textGhost }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
        {value}
      </dd>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  TENANCY: 'You live / lived here',
  OPEN_ENQUIRY: 'You enquired to them',
  APPROVED: 'You shared it',
  DECLINED: 'You said no',
  REVOKED: 'You turned this off',
};

function DisclosureRow({ entry, onToggle }: { entry: DisclosureEntry; onToggle: () => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border bg-white px-4 py-3"
      style={{ borderColor: C.line }}
    >
      <span
        className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px]"
        style={{ background: entry.can_see ? C.greenPale : '#F4EEE7' }}
      >
        {entry.can_see ? (
          <Eye className="h-4 w-4" strokeWidth={1.9} style={{ color: C.green }} />
        ) : (
          <EyeOff className="h-4 w-4" strokeWidth={1.9} style={{ color: C.textGhost }} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" style={{ color: C.inkSoft }}>
          {entry.hostel_name}
        </p>
        <p className="text-[11px]" style={{ color: C.textFaint }}>
          {SOURCE_LABEL[entry.source] ?? entry.source}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="flex-none rounded-lg px-3 py-2 text-[12px] font-semibold"
        style={{
          background: entry.can_see ? '#F4EEE7' : C.clayPaleBg,
          color: entry.can_see ? C.textBody : '#A4482F',
        }}
      >
        {entry.can_see ? 'Turn off' : 'Share'}
      </button>
    </div>
  );
}
