import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';

import { useIsSeeker, useSavedHostels, useToggleSaved } from '@features/discover/hooks/useDiscover';

import { HostelCard } from './components/HostelCard';
import { DiscoverEmpty, PrimaryButton } from './components/DiscoverShell';
import { SignedOutPrompt } from './components/SignedOutPrompt';
import { C, FONT } from './discoverTheme';
import { FootprintTrail } from './components/FootprintTrail';

export function SavedPage() {
  const navigate = useNavigate();
  const { isSeeker, loading } = useIsSeeker();
  const { data, isLoading } = useSavedHostels();
  const toggleSaved = useToggleSaved();

  const savedIds = useMemo(() => new Set((data ?? []).map((item) => item.id)), [data]);

  useEffect(() => {
    document.title = 'Saved hostels — Stayo';
  }, []);

  if (!loading && !isSeeker) {
    return (
      <SignedOutPrompt
        title="Saved hostels"
        icon={Heart}
        body="Sign in to keep a shortlist. Your saved hostels follow you to any device, and stay with your Stayo account."
        returnTo="/profile/saved"
      />
    );
  }

  return (
    <div className="relative">
      {/*
        Same trail as Explore, and painted underneath the page for the same
        reason: `FootprintTrail` is `fixed z-0` while the content below is
        `relative z-[1]`, so a print lands on the graph-paper ground in the
        margins between cards and never across a hostel's photo. The component
        turns itself off on touch, under prefers-reduced-motion, and on narrow
        viewports where there are no margins to land in.
      */}
      <FootprintTrail />

      <div className="relative z-[1]">
      <header
        className="border-b px-5 pb-4 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Saved
        </h1>
        <p className="mt-0.5 text-[12px]" style={{ color: C.textMuted }}>
          {isLoading
            ? 'Loading…'
            : `${data?.length ?? 0} ${data?.length === 1 ? 'hostel' : 'hostels'} you're considering`}
        </p>
      </header>

      <section className="px-5 pb-8 pt-4">
        {!isLoading && (data?.length ?? 0) === 0 && (
          <DiscoverEmpty
            icon={Heart}
            title="No saved hostels yet"
            body="Tap the heart on any hostel to keep it here and compare before you enquire."
            action={<PrimaryButton onClick={() => navigate('/discover')}>Explore hostels</PrimaryButton>}
          />
        )}

        <div className="flex flex-col gap-3.5">
          {data?.map((hostel) => (
            <HostelCard
              key={hostel.id}
              hostel={hostel}
              variant="compact"
              saved={savedIds.has(hostel.id)}
              onOpen={(slug) => navigate(`/discover/h/${slug}`)}
              onToggleSave={() => toggleSaved.mutate({ hostelId: hostel.id, saved: true })}
            />
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
