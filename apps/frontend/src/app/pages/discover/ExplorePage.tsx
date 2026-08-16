import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Compass, Search, ShieldCheck, Utensils } from 'lucide-react';

import type { DiscoverCard, DiscoverFilters, HostelType } from '@features/discover/api';
import {
  useDiscoverSearch,
  useSavedHostels,
  useToggleSaved,
  useIsSeeker,
} from '@features/discover/hooks/useDiscover';

import { useDiscoverAuth } from './DiscoverAuthContext';
import { HostelCard } from './components/HostelCard';
import { DiscoverEmpty, HostelCardSkeleton, PrimaryButton } from './components/DiscoverShell';
import { C, FONT } from './discoverTheme';

/** Shortcuts that map onto real filters — nothing here is decorative. */
const QUICK_FILTERS: { label: string; icon: typeof Search; patch: Partial<DiscoverFilters> }[] = [
  { label: 'With meals', icon: Utensils, patch: { foodIncluded: true } },
  { label: 'Beds free now', icon: ShieldCheck, patch: { hasVacancy: true } },
  { label: 'Girls', icon: Compass, patch: { hostelType: 'GIRLS' as HostelType } },
  { label: 'Boys', icon: Compass, patch: { hostelType: 'BOYS' as HostelType } },
  { label: 'Co-ed', icon: Compass, patch: { hostelType: 'CO_LIVING' as HostelType } },
];

const CITY_KEY = 'stayo.discover.city';

export function ExplorePage() {
  const navigate = useNavigate();
  const { isSeeker } = useIsSeeker();
  const { openSignIn } = useDiscoverAuth();

  // The chosen city persists: someone browsing Hyderabad hostels does not want
  // to re-pick it on every visit. Falls back to "everywhere" rather than
  // guessing a location we have no permission to know.
  const [city, setCity] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(CITY_KEY);
    } catch {
      return null;
    }
  });
  const [cityOpen, setCityOpen] = useState(false);

  useEffect(() => {
    try {
      if (city) window.localStorage.setItem(CITY_KEY, city);
      else window.localStorage.removeItem(CITY_KEY);
    } catch {
      /* private mode — the filter still works for this session */
    }
  }, [city]);

  useEffect(() => {
    document.title = 'Find a hostel — Stayo';
  }, []);

  const filters = useMemo<DiscoverFilters>(
    () => ({ city: city ?? undefined, sort: 'recommended', limit: 20 }),
    [city],
  );

  const { data, isLoading, isError, refetch } = useDiscoverSearch(filters);
  const { data: saved } = useSavedHostels();
  const toggleSaved = useToggleSaved();

  const savedIds = useMemo(() => new Set((saved ?? []).map((item) => item.id)), [saved]);
  const cities = data?.facets.cities ?? [];

  const openListing = (slug: string) => navigate(`/discover/h/${slug}`);

  const handleToggleSave = (hostel: DiscoverCard) => {
    if (!isSeeker) {
      // Sign in over the page, then complete the save they actually asked for
      // — losing the tap would make signing in feel like a detour.
      openSignIn({
        onDone: () => toggleSaved.mutate({ hostelId: hostel.id, saved: false, card: hostel }),
      });
      return;
    }
    toggleSaved.mutate({ hostelId: hostel.id, saved: savedIds.has(hostel.id), card: hostel });
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="relative overflow-hidden rounded-b-[28px] px-5 pb-5 pt-[max(3.5rem,env(safe-area-inset-top))]"
        style={{ background: C.ink }}
      >
        <div
          className="pointer-events-none absolute -right-12 -top-9 h-[170px] w-[170px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(217,144,111,.24),transparent 70%)' }}
        />

        <div className="relative">
          {/* Home affordance. Discovery is reachable directly (shared links,
              WhatsApp buttons), so a seeker can land here with no way back to
              the front door — the owner landing page has had this all along. */}
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Stayo home"
            className="mb-3 flex items-center"
          >
            {/* The horizontal lockup already contains the wordmark, so there is
                no separate text beside it. */}
            <img
              src="/stayo-logo-horizontal.svg"
              alt="Stayo"
              className="h-9 w-auto"
            />
          </button>

          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: '#8C8177' }}>
            Discover on Stayo
          </p>

          <button
            type="button"
            onClick={() => setCityOpen((open) => !open)}
            aria-expanded={cityOpen}
            className="mt-1 flex items-center gap-1.5"
            disabled={cities.length === 0}
          >
            <span
              className="text-[18px] font-extrabold tracking-[-0.01em] text-white"
              style={{ fontFamily: FONT.display }}
            >
              {city ?? 'Everywhere'}
            </span>
            {cities.length > 0 && <ChevronDown className="h-4 w-4" style={{ color: '#A79C90' }} />}
          </button>

          {cityOpen && cities.length > 0 && (
            <div
              className="mt-3 flex flex-wrap gap-2 rounded-2xl p-3"
              style={{ background: 'rgba(255,255,255,.06)' }}
            >
              <CityChip label="Everywhere" active={city === null} onClick={() => { setCity(null); setCityOpen(false); }} />
              {cities.map(({ city: name, count }) => (
                <CityChip
                  key={name}
                  label={`${name} · ${count}`}
                  active={city === name}
                  onClick={() => { setCity(name); setCityOpen(false); }}
                />
              ))}
            </div>
          )}

          <h1
            className="mt-4 text-[25px] font-extrabold leading-[1.2] tracking-[-0.02em] text-white"
            style={{ fontFamily: FONT.display }}
          >
            Find a hostel that
            <br />
            feels like home.
          </h1>

          <button
            type="button"
            onClick={() => navigate('/discover/search')}
            className="mt-4 flex w-full items-center gap-2.5 rounded-[15px] bg-white px-4 py-3.5 text-left"
            style={{ boxShadow: '0 8px 22px rgba(0,0,0,.22)' }}
          >
            <Search className="h-[17px] w-[17px] flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>
                Search area, college or hostel
              </span>
              <span className="block truncate text-[11px]" style={{ color: C.textFaint }}>
                {cities.length > 0
                  ? cities.slice(0, 3).map((entry) => entry.city).join(' · ')
                  : 'Browse every verified hostel on Stayo'}
              </span>
            </span>
          </button>
        </div>
      </header>

      {/* ── Quick filters ──────────────────────────────────────────────── */}
      <div className="flex gap-2.5 overflow-x-auto px-5 pb-1 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {QUICK_FILTERS.map(({ label, icon: Icon, patch }) => (
          <button
            key={label}
            type="button"
            onClick={() =>
              navigate('/discover/search', { state: { patch, city: city ?? undefined } })
            }
            className="flex flex-none items-center gap-1.5 rounded-full border bg-white px-3.5 py-2.5"
            style={{ borderColor: '#EAE1D8', boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} style={{ color: C.textMuted }} />
            <span className="text-[12.5px] font-semibold" style={{ color: C.textBody }}>{label}</span>
          </button>
        ))}
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <section className="px-5 pb-8 pt-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
              {city ? `Hostels in ${city}` : 'Verified hostels'}
            </h2>
            <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>
              {isLoading
                ? 'Looking…'
                : `${data?.total ?? 0} ${data?.total === 1 ? 'hostel' : 'hostels'} on Stayo`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/discover/search')}
            className="flex-none text-[12px] font-semibold"
            style={{ color: C.clay }}
          >
            See all
          </button>
        </div>

        {isLoading && <HostelCardSkeleton />}

        {isError && (
          <DiscoverEmpty
            icon={Compass}
            title="Couldn't load hostels"
            body="Something went wrong reaching Stayo. Check your connection and try again."
            action={<PrimaryButton onClick={() => refetch()}>Try again</PrimaryButton>}
          />
        )}

        {!isLoading && !isError && (data?.results.length ?? 0) === 0 && (
          <DiscoverEmpty
            icon={Compass}
            title={city ? `No hostels in ${city} yet` : 'No hostels listed yet'}
            body="Stayo only shows hostels a human has verified, so this list starts small and grows. Check back soon."
            action={city ? <PrimaryButton onClick={() => setCity(null)}>Show everywhere</PrimaryButton> : undefined}
          />
        )}

        <div className="flex flex-col gap-4">
          {data?.results.map((hostel) => (
            <HostelCard
              key={hostel.id}
              hostel={hostel}
              saved={savedIds.has(hostel.id)}
              onOpen={openListing}
              onToggleSave={handleToggleSave}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function CityChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
      style={{
        background: active ? C.clayLight : 'rgba(255,255,255,.08)',
        color: active ? C.ink : '#E4DAD0',
      }}
    >
      {label}
    </button>
  );
}
