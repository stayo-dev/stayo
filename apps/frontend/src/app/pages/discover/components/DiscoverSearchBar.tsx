import type { ReactNode } from 'react';
import { ChevronDown, MapPin, Search } from 'lucide-react';

import { C } from '../discoverTheme';

type Variant = 'hero' | 'sticky';

type Props = {
  /** Currently chosen city, or `null` for "everywhere". */
  city: string | null;
  /** How many cities have hostels — the "Where" field is inert when zero. */
  cityCount: number;
  cityOpen: boolean;
  /** `setCityOpen(o => !o)` from the page. */
  onToggleCity: () => void;
  /** Opens the full `/discover/search` screen. */
  onOpenSearch: () => void;
  /** `() => cityPicker('light')` — the same chip list the page renders elsewhere. */
  renderCityPicker: () => ReactNode;
  /**
   * Navigate home. When set, the pinned bar shows the Stayo logomark on the
   * left of the phone row (the desktop wordmark is placed by the page itself).
   */
  onHome?: () => void;
  variant?: Variant;
};

/**
 * The Explore page's search affordance — a one-tap pill on a phone, a two-field
 * "Where / What" bar on a laptop — in the two places it now appears:
 *
 *  - `hero`   inside the dark header, full size;
 *  - `sticky` in the slim bar that pins to the top of the viewport once the
 *             hero has scrolled away.
 *
 * Both share the same handlers and the same city popover; only the proportions
 * differ. Keeping it in one component is what stops the pinned bar and the hero
 * bar drifting apart.
 */
export function DiscoverSearchBar({
  city,
  cityCount,
  cityOpen,
  onToggleCity,
  onOpenSearch,
  renderCityPicker,
  onHome,
  variant = 'hero',
}: Props) {
  const compact = variant === 'sticky';
  const hasCities = cityCount > 0;

  return (
    <>
      {/* ── Phone ──────────────────────────────────────────────────────── */}
      {compact ? (
        // Pinned: a city chip sits beside the pill, because the filter row that
        // normally carries the city control has scrolled away with the hero.
        <div className="lg:hidden">
          <div className="flex items-center gap-2">
            {onHome && (
              <button
                type="button"
                onClick={onHome}
                aria-label="Stayo home"
                className="flex-none"
              >
                <img src="/stayo-icon.png" alt="Stayo" className="h-8 w-8 rounded-[9px]" />
              </button>
            )}
            {hasCities && (
              <button
                type="button"
                onClick={onToggleCity}
                aria-expanded={cityOpen}
                className="flex flex-none items-center gap-1.5 rounded-full border px-3 py-2.5"
                style={{
                  background: city ? C.ink : '#fff',
                  borderColor: city ? C.ink : '#EAE1D8',
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
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[13px] bg-white px-3.5 py-2.5 text-left"
              style={{ border: `1px solid ${C.line}` }}
            >
              <Search className="h-[17px] w-[17px] flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: C.inkSoft }}>
                Search area, college or hostel
              </span>
            </button>
          </div>
          {cityOpen && hasCities && (
            <div
              className="mt-2.5 flex flex-wrap gap-2 rounded-[18px] border bg-white p-3"
              style={{ borderColor: C.line }}
            >
              {renderCityPicker()}
            </div>
          )}
        </div>
      ) : (
        // In the hero: one tap opens the full search screen.
        <button
          type="button"
          onClick={onOpenSearch}
          className="mt-5 flex w-full items-center gap-2.5 rounded-[15px] bg-white px-4 py-4 text-left lg:hidden"
          style={{ boxShadow: '0 8px 22px rgba(0,0,0,.22)' }}
        >
          <Search className="h-[17px] w-[17px] flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: C.inkSoft }}>
            Search area, college or hostel
          </span>
        </button>
      )}

      {/* ── Laptop: a two-field bar — where, then what. ─────────────────── */}
      <div
        className={`relative mx-auto hidden w-full lg:block ${
          compact ? 'max-w-[620px]' : 'mt-9 max-w-[760px]'
        }`}
      >
        <div
          className={`flex items-center gap-1 rounded-full bg-white text-left ${compact ? 'p-1.5' : 'p-2'}`}
          style={{
            boxShadow: compact ? '0 2px 10px rgba(40,30,20,.12)' : '0 18px 40px rgba(0,0,0,.28)',
          }}
        >
          <button
            type="button"
            onClick={onToggleCity}
            aria-expanded={cityOpen}
            disabled={!hasCities}
            className={`flex flex-col items-start rounded-full text-left transition-colors hover:bg-[#F7F3EF] disabled:hover:bg-transparent ${
              compact ? 'min-w-[160px] px-4 py-1' : 'min-w-[210px] px-6 py-2'
            }`}
          >
            <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}>
              Where
            </span>
            <span className="flex items-center gap-1.5 text-[14.5px] font-bold" style={{ color: C.text }}>
              {city ?? 'Everywhere'}
              {hasCities && <ChevronDown className="h-3.5 w-3.5" style={{ color: C.textGhost }} />}
            </span>
          </button>

          <span className={`w-px flex-none ${compact ? 'h-7' : 'h-9'}`} style={{ background: C.line }} />

          <button
            type="button"
            onClick={onOpenSearch}
            className={`flex min-w-0 flex-1 flex-col items-start rounded-full text-left transition-colors hover:bg-[#F7F3EF] ${
              compact ? 'px-4 py-1' : 'px-6 py-2'
            }`}
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
            onClick={onOpenSearch}
            aria-label="Search hostels"
            className={`flex flex-none items-center justify-center rounded-full transition-transform hover:scale-105 ${
              compact ? 'h-10 w-10' : 'h-[52px] w-[52px]'
            }`}
            style={{ background: C.clayDeep }}
          >
            <Search className={compact ? 'h-4 w-4 text-white' : 'h-5 w-5 text-white'} strokeWidth={2.2} />
          </button>
        </div>

        {cityOpen && hasCities && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+12px)] z-30 flex flex-wrap justify-center gap-2 rounded-[24px] bg-white p-4 text-left"
            style={{ boxShadow: '0 20px 44px rgba(0,0,0,.22)' }}
          >
            {renderCityPicker()}
          </div>
        )}
      </div>
    </>
  );
}
