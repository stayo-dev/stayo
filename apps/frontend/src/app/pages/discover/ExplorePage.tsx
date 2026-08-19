import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  ChevronDown,
  Compass,
  MapPin,
  MessageSquareText,
  Search,
  ShieldCheck,
  UserRound,
  Utensils,
  Wallet,
} from 'lucide-react';

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
import { C, FONT, PAGE_SHELL, RESULTS_GRID } from './discoverTheme';

/** Shortcuts that map onto real filters — nothing here is decorative. */
const QUICK_FILTERS: { label: string; icon: typeof Search; patch: Partial<DiscoverFilters> }[] = [
  { label: 'With meals', icon: Utensils, patch: { foodIncluded: true } },
  { label: 'Beds free now', icon: ShieldCheck, patch: { hasVacancy: true } },
  { label: 'Girls', icon: Compass, patch: { hostelType: 'GIRLS' as HostelType } },
  { label: 'Boys', icon: Compass, patch: { hostelType: 'BOYS' as HostelType } },
  { label: 'Co-ed', icon: Compass, patch: { hostelType: 'CO_LIVING' as HostelType } },
];

/**
 * What Stayo is and why it is worth using, in the three claims the product
 * can actually back with a column in the database. A first-time visitor lands
 * here from a shared link with no idea what this site is; the hero says what,
 * this says why. Nothing here is a number we do not have.
 */
const VALUE_PROPS = [
  {
    icon: BadgeCheck,
    title: 'Checked before it is listed',
    body: 'A hostel only appears here once someone at Stayo has verified the place and its rooms. No ghost listings.',
  },
  {
    icon: Wallet,
    title: 'The real rent, up front',
    body: 'Prices and beds free today come from the hostel’s own live records — not from an advert written months ago.',
  },
  {
    icon: MessageSquareText,
    title: 'Straight to the hostel',
    body: 'Send a free enquiry and hear back from the owner directly. No broker in the middle, no commission.',
  },
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
  const openSearch = () => navigate('/discover/search');

  const pickCity = (next: string | null) => {
    setCity(next);
    setCityOpen(false);
  };

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

  /** The city list, in the two grounds it has to sit on. */
  const cityPicker = (tone: 'dark' | 'light') => (
    <>
      <CityChip label="Everywhere" tone={tone} active={city === null} onClick={() => pickCity(null)} />
      {cities.map(({ city: name, count }) => (
        <CityChip
          key={name}
          label={`${name} · ${count}`}
          tone={tone}
          active={city === name}
          onClick={() => pickCity(name)}
        />
      ))}
    </>
  );

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="relative overflow-hidden rounded-b-[28px] pb-5 pt-[max(3.5rem,env(safe-area-inset-top))] lg:rounded-b-[40px] lg:pb-14 lg:pt-0"
        style={{ background: C.ink }}
      >
        <div
          className="pointer-events-none absolute -right-12 -top-9 h-[170px] w-[170px] rounded-full lg:-right-24 lg:-top-24 lg:h-[520px] lg:w-[520px]"
          style={{ background: 'radial-gradient(circle,rgba(217,144,111,.24),transparent 70%)' }}
        />

        {/* Desktop top bar. A laptop visitor looks for the brand, the account
            and the owner door along the top edge — on a phone those live in
            the bottom nav and the hero, so this row is desktop-only rather
            than a second copy of navigation the phone already has. */}
        <div className="relative hidden lg:block" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div className={`${PAGE_SHELL} flex items-center justify-between py-4`}>
            <button type="button" onClick={() => navigate('/')} aria-label="Stayo home">
              <img src="/stayo-wordmark-white.svg" alt="Stayo" className="h-7 w-auto" />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/owners')}
                className="rounded-full px-4 py-2.5 text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white"
              >
                List your hostel
              </button>
              <button
                type="button"
                onClick={() => (isSeeker ? navigate('/profile') : openSignIn())}
                className="flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/10"
                style={{ borderColor: 'rgba(255,255,255,.18)' }}
              >
                <UserRound className="h-4 w-4" strokeWidth={1.8} />
                {isSeeker ? 'Profile' : 'Log in or sign up'}
              </button>
            </div>
          </div>
        </div>

        <div className={`${PAGE_SHELL} relative lg:pt-14 lg:text-center`}>
          {/* Home affordance. Discovery is reachable directly (shared links,
              WhatsApp buttons), so a seeker can land here with no way back to
              the front door — the owner landing page has had this all along.
              Desktop gets the same wordmark in the top bar instead. */}
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Stayo home"
            className="mb-3 flex items-center lg:hidden"
          >
            {/* Wordmark only — no separate text label beside it. */}
            <img src="/stayo-wordmark-white.svg" alt="Stayo" className="h-7 w-auto" />
          </button>

          {/* Desktop only. On a phone the wordmark sits three lines above it
              saying the same word, and it inserts a third type size between
              the wordmark and the headline for no new information. */}
          <p className="hidden text-[10.5px] font-bold uppercase tracking-[0.14em] lg:block" style={{ color: '#8C8177' }}>
            Discover on Stayo
          </p>

          {/* The phone's city control lives in the filter row below, not here
              — see the note there. On a laptop it is the search bar's "Where"
              field, where a desk user expects to change it. */}
          <h1
            className="mt-1 text-[26px] font-extrabold leading-[1.2] tracking-[-0.02em] text-white lg:mt-3 lg:text-[44px] lg:leading-[1.1]"
            style={{ fontFamily: FONT.display }}
          >
            Find a hostel that
            <br />
            feels like home.
          </h1>

          <p
            className="mt-2 text-[12.5px] leading-[1.6] lg:mx-auto lg:mt-4 lg:max-w-[46ch] lg:text-[15px]"
            style={{ color: '#B6ABA0' }}
          >
            Real rent, beds free today, owner at the other end.
          </p>

          {/* Phone: one tap opens the full search screen. */}
          <button
            type="button"
            onClick={openSearch}
            className="mt-5 flex w-full items-center gap-2.5 rounded-[15px] bg-white px-4 py-4 text-left lg:hidden"
            style={{ boxShadow: '0 8px 22px rgba(0,0,0,.22)' }}
          >
            {/* One line. The second line used to list the cities that have
                hostels, directly under a control that showed the selected
                city — two location readouts, neither obviously the current
                one. The city list is a picker now, not a caption. */}
            <Search className="h-[17px] w-[17px] flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: C.inkSoft }}>
              Search area, college or hostel
            </span>
          </button>

          {/* Laptop: a two-field bar — where, then what — because at this
              width there is room to show that city and query are separate
              choices instead of hiding both behind one placeholder. */}
          <div className="relative mx-auto mt-9 hidden w-full max-w-[760px] lg:block">
            <div
              className="flex items-center gap-1 rounded-full bg-white p-2 text-left"
              style={{ boxShadow: '0 18px 40px rgba(0,0,0,.28)' }}
            >
              <button
                type="button"
                onClick={() => setCityOpen((open) => !open)}
                aria-expanded={cityOpen}
                disabled={cities.length === 0}
                className="flex min-w-[210px] flex-col items-start rounded-full px-6 py-2 text-left transition-colors hover:bg-[#F7F3EF] disabled:hover:bg-transparent"
              >
                <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}>
                  Where
                </span>
                <span className="flex items-center gap-1.5 text-[14.5px] font-bold" style={{ color: C.text }}>
                  {city ?? 'Everywhere'}
                  {cities.length > 0 && <ChevronDown className="h-3.5 w-3.5" style={{ color: C.textGhost }} />}
                </span>
              </button>

              <span className="h-9 w-px flex-none" style={{ background: C.line }} />

              <button
                type="button"
                onClick={openSearch}
                className="flex min-w-0 flex-1 flex-col items-start rounded-full px-6 py-2 text-left transition-colors hover:bg-[#F7F3EF]"
              >
                <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}>
                  What
                </span>
                <span className="truncate text-[14.5px] font-semibold" style={{ color: C.textFaint }}>
                  Area, college or hostel name
                </span>
              </button>

              <button
                type="button"
                onClick={openSearch}
                aria-label="Search hostels"
                className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full transition-transform hover:scale-105"
                style={{ background: C.clayDeep }}
              >
                <Search className="h-5 w-5 text-white" strokeWidth={2.2} />
              </button>
            </div>

            {cityOpen && cities.length > 0 && (
              <div
                className="absolute left-0 right-0 top-[calc(100%+12px)] z-30 flex flex-wrap justify-center gap-2 rounded-[24px] bg-white p-4 text-left"
                style={{ boxShadow: '0 20px 44px rgba(0,0,0,.22)' }}
              >
                {cityPicker('light')}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Where + quick filters ──────────────────────────────────────── */}
      <div className={`${PAGE_SHELL} pb-1 pt-4 lg:pt-7`}>
        <div className="flex gap-2.5 overflow-x-auto [scrollbar-width:none] lg:flex-wrap lg:justify-center lg:gap-3 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
          {/* The city picker, phone only, first in the row. It used to be an
              18px bold line in the hero, which made it compete with the
              headline for the one thing a phone screen can emphasise — and
              "where" is a filter, so it belongs with the filters. */}
          {cities.length > 0 && (
            <button
              type="button"
              onClick={() => setCityOpen((open) => !open)}
              aria-expanded={cityOpen}
              className="flex flex-none items-center gap-1.5 rounded-full border px-3.5 py-2.5 lg:hidden"
              style={{
                background: city ? C.ink : '#fff',
                borderColor: city ? C.ink : '#EAE1D8',
                boxShadow: '0 1px 2px rgba(40,30,20,.04)',
              }}
            >
              <MapPin
                className="h-[15px] w-[15px]"
                strokeWidth={1.8}
                style={{ color: city ? C.clayPale : C.textMuted }}
              />
              <span className="text-[12.5px] font-semibold" style={{ color: city ? '#fff' : C.textBody }}>
                {city ?? 'Everywhere'}
              </span>
              <ChevronDown className="h-3.5 w-3.5" style={{ color: city ? C.clayPale : C.textGhost }} />
            </button>
          )}

          {QUICK_FILTERS.map(({ label, icon: Icon, patch }) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                navigate('/discover/search', { state: { patch, city: city ?? undefined } })
              }
              className="flex flex-none items-center gap-1.5 rounded-full border bg-white px-3.5 py-2.5 transition-colors hover:border-[#D9C7B6] lg:px-5"
              style={{ borderColor: '#EAE1D8', boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
            >
              <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} style={{ color: C.textMuted }} />
              <span className="text-[12.5px] font-semibold" style={{ color: C.textBody }}>{label}</span>
            </button>
          ))}
        </div>

        {cityOpen && cities.length > 0 && (
          <div
            className="mt-2.5 flex flex-wrap gap-2 rounded-[18px] border bg-white p-3 lg:hidden"
            style={{ borderColor: C.line }}
          >
            {cityPicker('light')}
          </div>
        )}
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <section className={`${PAGE_SHELL} pb-8 pt-5 lg:pt-8`}>
        <div className="mb-3 flex items-baseline justify-between lg:mb-5">
          <div>
            <h2
              className="text-[17px] font-extrabold tracking-[-0.02em] lg:text-[24px]"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {city ? `Hostels in ${city}` : 'Verified hostels'}
            </h2>
            <p className="mt-0.5 text-[11.5px] lg:text-[13px]" style={{ color: C.textMuted }}>
              {isLoading
                ? 'Looking…'
                : `${data?.total ?? 0} ${data?.total === 1 ? 'hostel' : 'hostels'} on Stayo`}
            </p>
          </div>
          <button
            type="button"
            onClick={openSearch}
            className="flex-none text-[12px] font-semibold lg:rounded-full lg:border lg:px-4 lg:py-2.5 lg:text-[13px] lg:transition-colors lg:hover:bg-white"
            style={{ color: C.clay, borderColor: '#EAE1D8' }}
          >
            See all
          </button>
        </div>

        {isLoading && <HostelCardSkeleton count={4} className={RESULTS_GRID} />}

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

        <div className={RESULTS_GRID}>
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

      {/* ── What Stayo is ──────────────────────────────────────────────── */}
      <section className={`${PAGE_SHELL} pb-10 lg:pb-16`}>
        <div
          className="rounded-[24px] border bg-white p-5 lg:p-9"
          style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
        >
          <h2
            className="text-[15px] font-extrabold tracking-[-0.01em] lg:text-center lg:text-[20px]"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            Why look here and not on a listings site
          </h2>
          <div className="mt-4 grid gap-4 lg:mt-8 lg:grid-cols-3 lg:gap-8">
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3.5 lg:flex-col lg:gap-3 lg:text-center">
                <span
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-[13px] lg:mx-auto lg:h-12 lg:w-12"
                  style={{ background: C.clayPaleBg }}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.8} style={{ color: C.clayDeep }} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[13.5px] font-bold lg:text-[15px]" style={{ fontFamily: FONT.display, color: C.text }}>
                    {title}
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-[1.6] lg:text-[13px]" style={{ color: C.textMuted }}>
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CityChip({
  label,
  active,
  onClick,
  tone = 'dark',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** `dark` sits on the ink header, `light` inside the desktop popover. */
  tone?: 'dark' | 'light';
}) {
  const dark = tone === 'dark';
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
      style={{
        background: active ? C.clayLight : dark ? 'rgba(255,255,255,.08)' : C.chipBg,
        color: active ? C.ink : dark ? '#E4DAD0' : C.textBody,
      }}
    >
      {label}
    </button>
  );
}
