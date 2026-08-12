import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, Plus, UtensilsCrossed, ChevronRight } from 'lucide-react';
import { StatCard } from '@shared/ui-patterns/StatCard';
import { DarkHeroCard } from '@shared/ui-patterns/DarkHeroCard';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useFoodSchedule } from '@features/owner-food/hooks/useFoodSchedule';
import { cellAt, dayKeyFor, isFilled, mealSlotAt } from '@features/owner-food/weekGrid';
import { PropertyList } from '../property-order/PropertyList';
import { FirstHostelCard } from './FirstHostelCard';
import {
  mockOwnerName,
  mockActionCenter,
  mockCollection,
  mockProperties,
  mockAlertCount,
  type MockProperty,
} from '@shared/mocks/dashboard';

type ActionCenterData = typeof mockActionCenter;
type CollectionData = typeof mockCollection;

interface OwnerHomeDashboardProps {
  ownerName?: string;
  properties?: MockProperty[];
  alertCount?: number;
  actionCenter?: ActionCenterData;
  collection?: CollectionData;
  onSelectProperty?: (hostelId: string) => void;
  onOpenAlerts?: () => void;
  onOpenQuickActions?: () => void;
  onViewAllActions?: () => void;
  onPropertyMenu?: (hostelId: string) => void;
  onAddHostel?: () => void;
  /** A hostel that exists but still has floors without rooms. */
  hostelInProgress?: { name: string; summary: string } | null;
  /** Full ordered list of hostel ids after a manual reorder. See ADR-042. */
  onReorderProperties?: (orderedIds: string[]) => void;
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
  onSelectProperty,
  onOpenAlerts,
  onOpenQuickActions,
  onViewAllActions,
  onPropertyMenu,
  onAddHostel,
  hostelInProgress,
  onReorderProperties,
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
  const foodToday = useMemo(() => {
    const { current } = mealSlotAt(new Date());
    const cell = cellAt(foodSchedule.weekGrid, dayKeyFor(new Date()), current);
    return isFilled(cell) ? { slot: current, name: cell!.item_name } : null;
  }, [foodSchedule.weekGrid]);
  const foodHostelName = session.hostels.find((h) => h.id === session.primaryHostelId)?.name ?? '';

  return (
    <div className="flex flex-col gap-7 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-foreground">
            Good morning, {ownerName}
          </h1>
          <p className="mt-1.5 text-[13px] font-medium text-muted-foreground">
            {properties.length === 0
              ? 'Let\u2019s get your first hostel set up'
              : `${properties.length} ${properties.length === 1 ? 'hostel' : 'hostels'} · ${collection.month}`}
          </p>
        </div>
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

      {/* Was a non-interactive <div>+<span> — looked like a search field,
          did nothing. Now opens Universal Search (ADR-044). */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search tenants, rooms and hostels"
        className="flex items-center gap-2 rounded-xl border border-[#EAE1D8] bg-card px-3.5 py-[11px] text-left transition-colors active:bg-muted"
      >
        <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.6} />
        <span className="text-[13px] text-muted-foreground">Search tenant, room, phone…</span>
      </button>

      <section className="flex flex-col gap-3">
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
        <div className="grid grid-cols-3 gap-2">
          {/* All were non-interactive: StatCard had no onClick prop at all,
              so they sat beside a tappable hero card doing nothing. Each now
              opens its own work queue, same model as Collect Rent (ADR-046).
              Renewal Agreements is conditional — only shown when the hostel
              requires agreements (ADR-063). Today's Revenue was moved in
              from the old Snapshot section, made clickable, and always spans
              the full row as its own "big card" regardless of how many
              cards sit above it. */}
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
            className="col-span-3"
          />
        </div>
      </section>

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

      <section className="rounded-2xl border border-border bg-card p-4.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-foreground">{collection.month} Collection</h2>
          <span className="rounded-full bg-success/10 px-2.5 py-1 font-display text-xs font-bold tabular-nums text-success">
            {collection.percent}%
          </span>
        </div>
        <p className="mb-3 text-[13px] font-semibold tabular-nums text-foreground/70">
          {collection.collected} <span className="font-normal text-muted-foreground">of</span> {collection.target}
        </p>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${collection.percent}%` }} />
        </div>
      </section>

      {properties.length === 0 ? (
        <FirstHostelCard onStart={() => onAddHostel?.()} inProgress={hostelInProgress} />
      ) : (
        <>
          {hostelInProgress && <FirstHostelCard onStart={() => onAddHostel?.()} inProgress={hostelInProgress} />}
          <PropertyList
            properties={properties}
            onSelectProperty={onSelectProperty}
            onPropertyMenu={onPropertyMenu}
            onAddHostel={onAddHostel}
            onReorder={onReorderProperties}
          />
        </>
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
