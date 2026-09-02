import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, Plus, UtensilsCrossed, ChevronRight, TrendingUp } from 'lucide-react';
import { StatCard } from '@shared/ui-patterns/StatCard';
import { DarkHeroCard } from '@shared/ui-patterns/DarkHeroCard';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useFoodSchedule } from '@features/owner-food/hooks/useFoodSchedule';
import { useMealTimings } from '@features/owner-food/hooks/useMealTimings';
import { cellAt, dayKeyFor, isFilled } from '@features/owner-food/weekGrid';
import { currentAndNextMeal } from '@features/food/mealTimings';
import { GettingStartedCard } from '../getting-started/GettingStartedCard';
import type { GettingStarted, StepId, VerificationStatus } from '../getting-started/gettingStarted';
import type { HomeSections } from '../homeSections';
import {
  mockOwnerName,
  mockActionCenter,
  mockCollection,
  mockProperties,
  mockAlertCount,
  type MockProperty,
} from '@shared/mocks/dashboard';

type ActionCenterData = typeof mockActionCenter;
/**
 * Stated rather than inferred from `mockCollection`, which predates the
 * spending half of this card and would otherwise silently narrow the type back
 * to collection-only.
 *
 * The spend fields are nullable on purpose: the month-spend query is composed
 * into the dashboard response and deliberately allowed to fail on its own
 * (`portfolio/summary/route.ts`), so the card renders collection alone rather
 * than showing "Spent ₹0" — which would be a claim, not an absence.
 */
type CollectionData = typeof mockCollection & {
  spent?: string | null;
  left?: string | null;
  leftLabel?: string;
  overspent?: boolean;
  spentShareOfCollected?: number;
};

interface OwnerHomeDashboardProps {
  ownerName?: string;
  properties?: MockProperty[];
  alertCount?: number;
  actionCenter?: ActionCenterData;
  collection?: CollectionData;
  /**
   * One category that rose sharply this month, or null in an ordinary month.
   * Deliberately absent most of the time — the Action Center is for work, and
   * spending being normal is not work. See `expense-anomaly.ts`.
   */
  spendAnomaly?: { category: string; changePct: number; riseAmount: string } | null;
  onOpenAlerts?: () => void;
  onOpenQuickActions?: () => void;
  onViewAllActions?: () => void;
  /** A hostel that exists but still has floors without rooms. */
  hostelInProgress?: { name: string; summary: string } | null;
  /** New-owner walkthrough. Absent once all three steps are satisfied. */
  gettingStarted?: { state: GettingStarted; verification: VerificationStatus; onStep: (id: StepId) => void } | null;
  /**
   * Which cards have earned the right to render. A brand-new owner used to be
   * shown the entire dashboard with nothing in it — "Collect Rent ₹0", three
   * zero tiles, "₹0 of ₹0" — which reads as broken software to someone
   * non-technical and buries the one thing they should do. See
   * `homeSections.ts` and ADR-139. Defaults to everything visible so the
   * mock-data preview and any other caller renders the full screen.
   */
  sections?: HomeSections;
  /** Spotlight anchors, so the tour points at real elements not selectors. */
  gettingStartedRef?: React.Ref<HTMLElement>;
  actionCenterRef?: React.Ref<HTMLDivElement>;
  searchRef?: React.Ref<HTMLButtonElement>;
  /** Opens Profile. The avatar replaced the bottom-nav tab. */
  onOpenProfile: () => void;
  ownerPhotoUrl?: string | null;
  ownerInitials: string;
  /** Full ordered list of hostel ids after a manual reorder. See ADR-042. */
  /** Opens Universal Search. See ADR-044. */
  onOpenSearch?: () => void;
  /** Opens today's prioritised collection queue. See ADR-045. */
  onOpenCollectionQueue?: () => void;
  /** The remaining three Action Center queues. See ADR-046. */
  onOpenAgreements?: () => void;
  onOpenActivations?: () => void;
  onOpenVacancies?: () => void;
  /** Opens the owner Money page. See ADR-063. */
  onOpenRevenue?: () => void;
}

/**
 * Home-tab dashboard content, per Stayo App.dc.html — greeting, Action
 * Center, Snapshot, monthly collection progress, and the draggable property
 * list. Mostly presentational: takes data via props (defaulting to
 * mockDashboardData) so it's a straight swap-in — see
 * `hooks/useOwnerDashboard.ts` for the real data source now used at `/owner/home`.
 *
 * One exception: the "current meal" row below self-fetches via
 * `useFoodSchedule`/`useOwnerSession` and self-navigates, rather than taking
 * props — Home is a portfolio-level screen and per-hostel food is ambiguous
 * there, so it deliberately reads `session.primaryHostelId` directly instead
 * of threading a hostel selection through this component's props.
 */
export function OwnerHomeDashboard({
  ownerName = mockOwnerName,
  properties = mockProperties,
  alertCount = mockAlertCount,
  actionCenter = mockActionCenter,
  collection = mockCollection,
  spendAnomaly = null,
  sections = { search: true, actionCenter: true, monthCard: true, hostels: true, setupMode: false },
  onOpenAlerts,
  onOpenQuickActions,
  onViewAllActions,
  hostelInProgress,
  gettingStarted,
  gettingStartedRef,
  actionCenterRef,
  searchRef,
  onOpenProfile,
  ownerPhotoUrl,
  ownerInitials,
  onOpenSearch,
  onOpenCollectionQueue,
  onOpenAgreements,
  onOpenActivations,
  onOpenVacancies,
  onOpenRevenue,
}: OwnerHomeDashboardProps) {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const foodSchedule = useFoodSchedule(session.primaryHostelId, new Date().toISOString().slice(0, 7));
  const mealTimings = useMealTimings(session.primaryHostelId);
  const foodToday = useMemo(() => {
    const { current } = currentAndNextMeal(mealTimings.mealTimings, new Date());
    const cell = cellAt(foodSchedule.weekGrid, dayKeyFor(new Date()), current);
    return isFilled(cell) ? { slot: current, name: cell!.item_name } : null;
  }, [foodSchedule.weekGrid, mealTimings.mealTimings]);
  const foodHostelName = session.hostels.find((h) => h.id === session.primaryHostelId)?.name ?? '';

  return (
    <div className="flex flex-col gap-7 px-4 pb-8 pt-6 sm:px-6">
      {/*
        One row doing three jobs: identity, search and alerts.

        This was three stacked elements — a wordmark, "Good morning, <name>"
        and "1 hostel · September" — above a separate search row, spending
        roughly 100px before any content. The wordmark named the app the owner
        had already opened, the greeting said nothing that ever changes, and
        the hostel count now has a tab of its own. Collapsing them lifts the
        rent card and all three action tiles above the fold, which is the only
        thing on this screen worth that space.

        The avatar is where Profile lives now that it has left the bottom nav.
        Home only: two taps from the other tabs, which is the right price for a
        screen an owner opens rarely.
      */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Your profile"
          className="h-10 w-10 flex-none overflow-hidden rounded-full border border-[#EAE1D8] bg-primary"
        >
          {ownerPhotoUrl ? (
            <img src={ownerPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-[13px] font-bold text-primary-foreground">
              {ownerInitials}
            </span>
          )}
        </button>

        {/* Was a non-interactive <div>+<span> — looked like a search field,
            did nothing. Now opens Universal Search (ADR-044). Hidden until the
            account has somebody in it: searching an empty hostel returns
            nothing, and offering it on day one implies data that isn't there.
            While hidden the row is avatar and bell alone. */}
        {sections.search ? (
          <button
            ref={searchRef}
            type="button"
            onClick={onOpenSearch}
            aria-label="Search tenants, rooms and hostels"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#EAE1D8] bg-card px-3.5 py-[11px] text-left transition-colors active:bg-muted"
          >
            <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.6} />
            <span className="truncate text-[13px] text-muted-foreground">Search tenant, room, phone…</span>
          </button>
        ) : (
          <div className="flex-1" />
        )}

        <button
          type="button"
          onClick={onOpenAlerts}
          className="relative flex h-11 w-11 flex-none items-center justify-center rounded-full border border-[#EAE1D8] bg-card"
        >
          <Bell className="h-5 w-5 text-[#4A423B]" strokeWidth={1.7} />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border-2 border-background bg-destructive px-1 font-display text-[10px] font-bold text-white">
              {alertCount}
            </span>
          )}
        </button>
      </div>

      {gettingStarted && (
        <GettingStartedCard
          ref={gettingStartedRef}
          state={gettingStarted.state}
          verification={gettingStarted.verification}
          onStep={gettingStarted.onStep}
        />
      )}

      {/* Every tile in here is structurally zero until a tenant exists — no
          rent can be overdue, nobody can await activation, no revenue can
          have landed. Shown to a new owner it was four zeros and a dark card
          reading "Collect Rent ₹0", which teaches nothing and looks broken.
          See `homeSections.ts`. */}
      {sections.actionCenter && (
      <section className="flex flex-col gap-3" ref={actionCenterRef}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Action Center</h2>
          <button type="button" onClick={onViewAllActions} className="text-[12.5px] font-semibold text-primary">
            View all
          </button>
        </div>
        {/* The card showed a "›" chevron but had no handler — it went nowhere.
            It now opens today's prioritised collection queue (ADR-045). */}
        <button type="button" onClick={onOpenCollectionQueue} className="text-left">
          <DarkHeroCard className="rounded-[20px] px-5 py-[18px] shadow-[0_10px_28px_rgba(34,30,26,0.22)]">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-background/70">Collect Rent</span>
              <span className="text-background/55">›</span>
            </div>
            <div className="mt-1 font-display text-3xl font-extrabold tabular-nums tracking-tight">
              {actionCenter.collectRent.amount}
            </div>
            <div className="mt-1 text-xs font-medium text-background/65">{actionCenter.collectRent.caption}</div>
          </DarkHeroCard>
        </button>
        {/* Only in a month where something moved. `detectSpendAnomaly` holds a
            much higher bar than the Money screen's per-row annotation — on
            Home this is the single thing said about money going out, so a
            false alarm costs trust in the whole surface. */}
        {spendAnomaly && (
          <button
            type="button"
            onClick={() => navigate('/owner/money?tab=expenses')}
            className="flex min-h-[44px] items-center gap-2.5 rounded-[14px] border border-warning/30 bg-warning-bg/60 px-3.5 py-2.5 text-left"
          >
            <TrendingUp className="h-4 w-4 flex-none text-warning" strokeWidth={2} />
            <span className="flex-1 text-[12.5px] leading-snug text-foreground">
              <span className="font-semibold">{spendAnomaly.category}</span> up {spendAnomaly.changePct}% on
              last month — {spendAnomaly.riseAmount} more
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          {/* All were non-interactive: StatCard had no onClick prop at all,
              so they sat beside a tappable hero card doing nothing. Each now
              opens its own work queue, same model as Collect Rent (ADR-046).
              Renewal Agreements is conditional — only shown when the hostel
              requires agreements (ADR-063).

              Today's Revenue fills whatever space that leaves, so the row is
              always complete: with Agreements on it is a full-width card
              below three (1-3-1), with Agreements off it becomes the third
              card in the row itself (1-3). It previously always spanned the
              row, which left a visible gap beside Activate Tenants and Fill
              Vacant Beds whenever agreements were switched off. */}
          <StatCard variant="action" label="Activate Tenants" value={actionCenter.activateTenants.value} caption={actionCenter.activateTenants.caption} onClick={onOpenActivations} ariaLabel="Activate tenants" />
          {actionCenter.showRenewalAgreements && (
            <StatCard variant="action" label="Review Agreements" value={actionCenter.reviewAgreements.value} caption={actionCenter.reviewAgreements.caption} onClick={onOpenAgreements} ariaLabel="Review agreements" />
          )}
          <StatCard variant="action" label="Fill Vacant Beds" value={actionCenter.fillVacantBeds.value} caption={actionCenter.fillVacantBeds.caption} onClick={onOpenVacancies} ariaLabel="Fill vacant beds" />
          <StatCard
            variant="action"
            label="Today's revenue"
            value={<span className="text-success">{actionCenter.todaysRevenue.value}</span>}
            caption={actionCenter.todaysRevenue.caption}
            onClick={onOpenRevenue}
            ariaLabel="Today's revenue"
            className={actionCenter.showRenewalAgreements ? 'col-span-3' : undefined}
          />
        </div>
      </section>
      )}

      {/* Current meal, one line — only when there's something to say. A food
          gap belongs in the Action Center (Phase 2), not as an empty card
          here, so this renders nothing when today's slot is unset. */}
      {foodToday && (
        <button
          type="button"
          onClick={() => navigate('/owner/food')}
          className="flex min-h-[44px] items-center gap-2.5 rounded-[18px] border border-border bg-card px-4 py-3 text-left"
        >
          <UtensilsCrossed className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.75} />
          <span className="flex-1 text-[13px] text-foreground">
            <span className="font-semibold">{MEAL_CATEGORY_META[foodToday.slot].label}</span>
            {' · '}
            {foodToday.name}
            {/* Home is portfolio-level and this row is one hostel's meal, so
                say whose it is the moment there is more than one. */}
            {session.hostels.length > 1 && (
              <span className="text-muted-foreground"> · {foodHostelName}</span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
        </button>
      )}

      {/* Money in *and* money out.
          This card used to be collection-only — "₹16,000 of ₹57,000" — which
          answers how much came in but never what the owner actually opens the
          app to find out: am I ahead this month. ₹16,000 collected means one
          thing against ₹4,200 of spending and quite another against ₹30,000.
          See `monthCash.ts`. The figure is labelled "Left", never profit: it
          is cash received minus cash spent, blind to unpaid dues and deposits
          held, and this codebase does not dress a partial number as a whole
          one. */}
      {sections.monthCard && (
      <section className="rounded-2xl border border-border bg-card p-4.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-foreground">{collection.month}</h2>
          <span className="rounded-full bg-success/10 px-2.5 py-1 font-display text-xs font-bold tabular-nums text-success">
            {collection.percent}% collected
          </span>
        </div>

        <dl className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[12.5px] text-muted-foreground">Collected</dt>
            <dd className="font-display text-[13.5px] font-bold tabular-nums text-foreground">
              {collection.collected}
              <span className="ml-1 font-normal text-muted-foreground">of {collection.target}</span>
            </dd>
          </div>

          {collection.spent != null && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[12.5px] text-muted-foreground">Spent</dt>
              <dd className="font-display text-[13.5px] font-bold tabular-nums text-foreground">
                {collection.spent}
              </dd>
            </div>
          )}

          {collection.left != null && (
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <dt className="font-display text-[13px] font-bold text-foreground">{collection.leftLabel ?? 'Left'}</dt>
              <dd
                className={`font-display text-lg font-extrabold tabular-nums ${
                  collection.overspent ? 'text-destructive' : 'text-success'
                }`}
              >
                {collection.left}
              </dd>
            </div>
          )}
        </dl>

        {/* Collected fills the bar; what has already gone out is shown eaten
            out of it, so the remaining colour is money still in hand. */}
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="flex h-full" style={{ width: `${collection.percent}%` }}>
            <div
              className="h-full bg-success"
              style={{ width: `${100 - (collection.spentShareOfCollected ?? 0)}%` }}
            />
            <div
              className="h-full bg-warning/70"
              style={{ width: `${collection.spentShareOfCollected ?? 0}%` }}
            />
          </div>
        </div>
      </section>
      )}

      <button
        type="button"
        aria-label="Add"
        onClick={onOpenQuickActions}
        className="fixed bottom-[6.5rem] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-[0_10px_24px_rgba(180,106,85,0.4)] sm:right-[calc(50%-240px+1.25rem)]"
      >
        <Plus className="h-5.5 w-5.5 text-primary-foreground" strokeWidth={2.2} />
      </button>
    </div>
  );
}
