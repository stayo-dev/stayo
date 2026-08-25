import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpDown, ChevronLeft, Search, SlidersHorizontal, X } from 'lucide-react';

import type { DiscoverCard, DiscoverFilters, DiscoverSort, HostelType } from '@features/discover/api';
import {
  useDiscoverSearch,
  useIsSeeker,
  useSavedHostels,
  useToggleSaved,
} from '@features/discover/hooks/useDiscover';

import { useDiscoverAuth } from './DiscoverAuthContext';
import { useShareHostel } from '@shared/hooks/useShareHostel';
import { FootprintTrail } from './components/FootprintTrail';
import { HostelCard } from './components/HostelCard';
import { DiscoverEmpty, HostelCardSkeleton, PrimaryButton } from './components/DiscoverShell';
import { AUDIENCE_LABEL, C, FONT, PAGE_SHELL, RESULTS_GRID, formatRupees } from './discoverTheme';

const SHARING_OPTIONS = [1, 2, 3, 4, 6];
const AUDIENCE_OPTIONS: HostelType[] = ['BOYS', 'GIRLS', 'CO_LIVING', 'WORKING_PROS'];

const SORT_LABEL: Record<DiscoverSort, string> = {
  recommended: 'Recommended',
  price_low: 'Lowest price',
  newest: 'Newest',
};

const BUDGET_MIN = 2000;
const BUDGET_MAX = 20000;

export function SearchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSeeker } = useIsSeeker();
  const { openSignIn } = useDiscoverAuth();
  const { share } = useShareHostel();

  // Quick filters on Explore hand their patch through router state.
  const seeded = (location.state ?? {}) as { patch?: Partial<DiscoverFilters>; city?: string };

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sort, setSort] = useState<DiscoverSort>('recommended');
  const [draft, setDraft] = useState<DiscoverFilters>(() => ({
    city: seeded.city,
    ...seeded.patch,
  }));
  const [applied, setApplied] = useState<DiscoverFilters>(() => ({
    city: seeded.city,
    ...seeded.patch,
  }));

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    document.title = 'Search hostels — Stayo';
  }, []);

  const filters = useMemo<DiscoverFilters>(
    () => ({ ...applied, q: debouncedQuery || undefined, sort, limit: 30 }),
    [applied, debouncedQuery, sort],
  );

  const { data, isLoading, isError, refetch } = useDiscoverSearch(filters);
  const { data: saved } = useSavedHostels();
  const toggleSaved = useToggleSaved();
  const savedIds = useMemo(() => new Set((saved ?? []).map((item) => item.id)), [saved]);

  const activeCount =
    (applied.sharing?.length ? 1 : 0) +
    (applied.hostelType ? 1 : 0) +
    (applied.foodIncluded ? 1 : 0) +
    (applied.hasVacancy ? 1 : 0) +
    (applied.maxPrice != null ? 1 : 0) +
    (applied.city ? 1 : 0);

  const handleToggleSave = (hostel: DiscoverCard) => {
    if (!isSeeker) {
      openSignIn({
        onDone: () => toggleSaved.mutate({ hostelId: hostel.id, saved: false, card: hostel }),
      });
      return;
    }
    toggleSaved.mutate({ hostelId: hostel.id, saved: savedIds.has(hostel.id), card: hostel });
  };

  const openSheet = () => {
    setDraft(applied);
    setSheetOpen(true);
  };

  const cycleSort = () => {
    const order: DiscoverSort[] = ['recommended', 'price_low', 'newest'];
    setSort(order[(order.indexOf(sort) + 1) % order.length]);
  };

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
      <div className="relative z-[1] flex min-h-[100dvh] flex-col">
      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b pb-3 pt-[max(3.25rem,env(safe-area-inset-top))] lg:pt-4"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        {/* Full-bleed bar, capped contents — same page width as Explore, so
            arriving here from "See all" does not change the column the
            results sit in. */}
        <div className={PAGE_SHELL}>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate(-1)}
            className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
            style={{ background: '#F4EEE7' }}
          >
            <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
          </button>
          <div
            className="flex flex-1 items-center gap-2.5 rounded-[13px] bg-white px-3.5 py-2.5"
            style={{ border: `1.5px solid ${C.clay}` }}
          >
            <Search className="h-[15px] w-[15px] flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Area, college or hostel"
              aria-label="Search hostels"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold outline-none"
              style={{ color: C.inkSoft }}
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X className="h-4 w-4" style={{ color: C.textGhost }} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={openSheet}
            className="flex flex-none items-center gap-1.5 rounded-full border px-3.5 py-2"
            style={{
              background: activeCount ? C.ink : '#fff',
              borderColor: activeCount ? C.ink : C.lineInput,
            }}
          >
            <SlidersHorizontal className="h-[13px] w-[13px]" style={{ color: activeCount ? '#fff' : C.textBody }} />
            <span className="text-[12px] font-semibold" style={{ color: activeCount ? '#fff' : C.textBody }}>
              Filters{activeCount ? ` · ${activeCount}` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={cycleSort}
            className="flex flex-none items-center gap-1.5 rounded-full border bg-white px-3.5 py-2"
            style={{ borderColor: C.lineInput }}
          >
            <ArrowUpDown className="h-[13px] w-[13px]" style={{ color: C.textMuted }} />
            <span className="text-[12px] font-semibold" style={{ color: C.textBody }}>{SORT_LABEL[sort]}</span>
          </button>

          <ToggleChip
            label="Beds free"
            active={Boolean(applied.hasVacancy)}
            onClick={() => setApplied((f) => ({ ...f, hasVacancy: !f.hasVacancy }))}
          />
          <ToggleChip
            label="Meals"
            active={Boolean(applied.foodIncluded)}
            onClick={() => setApplied((f) => ({ ...f, foodIncluded: !f.foodIncluded }))}
          />
        </div>
        </div>
      </header>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <main className={`${PAGE_SHELL} flex-1 pb-8 pt-4`}>
        <p className="mb-3 text-[13px] font-bold" style={{ color: C.textBody }}>
          {isLoading ? 'Searching…' : `${data?.total ?? 0} ${data?.total === 1 ? 'hostel' : 'hostels'}`}
        </p>

        {isLoading && <HostelCardSkeleton count={4} className={RESULTS_GRID} />}

        {isError && (
          <DiscoverEmpty
            icon={Search}
            title="Search didn't load"
            body="Something went wrong reaching Stayo. Check your connection and try again."
            action={<PrimaryButton onClick={() => refetch()}>Try again</PrimaryButton>}
          />
        )}

        {!isLoading && !isError && (data?.results.length ?? 0) === 0 && (
          <DiscoverEmpty
            icon={Search}
            title="Nothing matched"
            body="Try widening your budget, clearing a filter, or searching a different area."
            action={
              activeCount ? (
                <PrimaryButton onClick={() => setApplied({})}>Clear all filters</PrimaryButton>
              ) : undefined
            }
          />
        )}

        <div className={RESULTS_GRID}>
          {data?.results.map((hostel) => (
            <HostelCard
              key={hostel.id}
              hostel={hostel}
              saved={savedIds.has(hostel.id)}
              onOpen={(slug) => navigate(`/discover/h/${slug}`)}
              onToggleSave={handleToggleSave}
              onShare={(card) =>
                card.slug ? share({ name: card.name, slug: card.slug, city: card.city }) : undefined
              }
            />
          ))}
        </div>
      </main>

      {/* ── Filter sheet ───────────────────────────────────────────────── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:items-center lg:justify-center lg:p-6">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0"
            style={{ background: 'rgba(34,30,26,.42)' }}
          />
          {/* A bottom sheet is a thumb-reach shape. On a laptop the same
              content becomes a centred dialog — a panel hugging the bottom
              edge of a 900px-tall window is a long way from where the
              pointer already is. */}
          <div
            className="relative flex max-h-[85%] flex-col rounded-t-[24px] lg:w-full lg:max-w-[560px] lg:rounded-[24px] lg:shadow-[0_28px_60px_rgba(20,14,10,.4)]"
            style={{ background: C.paper }}
          >
            <div className="flex-none px-5 pb-1.5 pt-3.5">
              <div className="mx-auto mb-3 h-1 w-9 rounded-full lg:hidden" style={{ background: '#D9CFC3' }} />
              <div className="flex items-center justify-between">
                <h2 className="text-[19px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
                  Filters
                </h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setSheetOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: '#EDE5DB' }}
                >
                  <X className="h-3.5 w-3.5" style={{ color: '#6B6259' }} />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-auto px-5 py-4">
              <FilterGroup label="Sharing type">
                <div className="flex flex-wrap gap-2">
                  {SHARING_OPTIONS.map((capacity) => {
                    const on = draft.sharing?.includes(capacity) ?? false;
                    return (
                      <SheetChip
                        key={capacity}
                        label={capacity === 1 ? 'Single' : `${capacity}-bed`}
                        active={on}
                        onClick={() =>
                          setDraft((f) => ({
                            ...f,
                            sharing: on
                              ? (f.sharing ?? []).filter((value) => value !== capacity)
                              : [...(f.sharing ?? []), capacity],
                          }))
                        }
                      />
                    );
                  })}
                </div>
              </FilterGroup>

              <FilterGroup
                label="Monthly budget"
                trailing={
                  <span className="text-[14px] font-extrabold" style={{ fontFamily: FONT.display, color: C.clay }}>
                    {draft.maxPrice ? `up to ₹${formatRupees(draft.maxPrice)}` : 'Any'}
                  </span>
                }
              >
                <input
                  type="range"
                  min={BUDGET_MIN}
                  max={BUDGET_MAX}
                  step={500}
                  value={draft.maxPrice ?? BUDGET_MAX}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    // Sliding to the top means "no ceiling", not "≤ ₹20,000" —
                    // otherwise the most expensive hostels vanish silently.
                    setDraft((f) => ({ ...f, maxPrice: value >= BUDGET_MAX ? undefined : value }));
                  }}
                  className="w-full"
                  style={{ accentColor: C.clay }}
                  aria-label="Maximum monthly budget"
                />
                <div className="mt-1 flex justify-between text-[10.5px]" style={{ color: C.textGhost }}>
                  <span>₹{formatRupees(BUDGET_MIN)}</span>
                  <span>No limit</span>
                </div>
              </FilterGroup>

              <FilterGroup label="Who it's for">
                <div className="flex flex-wrap gap-2">
                  {AUDIENCE_OPTIONS.map((type) => (
                    <SheetChip
                      key={type}
                      label={AUDIENCE_LABEL[type]}
                      active={draft.hostelType === type}
                      onClick={() =>
                        setDraft((f) => ({ ...f, hostelType: f.hostelType === type ? null : type }))
                      }
                    />
                  ))}
                </div>
              </FilterGroup>

              <FilterGroup label="Must have">
                <div className="flex flex-wrap gap-2">
                  <SheetChip
                    label="Meals included"
                    active={Boolean(draft.foodIncluded)}
                    onClick={() => setDraft((f) => ({ ...f, foodIncluded: !f.foodIncluded }))}
                  />
                  <SheetChip
                    label="Beds free now"
                    active={Boolean(draft.hasVacancy)}
                    onClick={() => setDraft((f) => ({ ...f, hasVacancy: !f.hasVacancy }))}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-[1.5]" style={{ color: C.textFaint }}>
                  Amenity filters like Wi-Fi and laundry arrive once owners can list them.
                </p>
              </FilterGroup>
            </div>

            <div
              className="flex flex-none items-center gap-3 border-t px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3"
              style={{ background: C.cardWarm, borderColor: C.line }}
            >
              <button
                type="button"
                onClick={() => setDraft({})}
                className="px-1 py-2 text-[13px] font-semibold"
                style={{ color: '#6E6459' }}
              >
                Clear all
              </button>
              <div className="flex-1">
                <PrimaryButton
                  full
                  onClick={() => {
                    setApplied(draft);
                    setSheetOpen(false);
                  }}
                >
                  Show results
                </PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
          {label}
        </h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function SheetChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-[11px] px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors"
      style={{
        background: active ? C.clayPaleBg : '#fff',
        border: active ? `1.5px solid ${C.clay}` : `1px solid ${C.lineInput}`,
        color: active ? '#A4482F' : C.textBody,
      }}
    >
      {label}
    </button>
  );
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-none rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-colors"
      style={{
        background: active ? C.clayPaleBg : '#fff',
        borderColor: active ? C.clay : C.lineInput,
        color: active ? '#A4482F' : C.textBody,
      }}
    >
      {label}
    </button>
  );
}
