import { Bell, Search, Plus } from 'lucide-react';
import { StatCard } from '@shared/ui-patterns/StatCard';
import { DarkHeroCard } from '@shared/ui-patterns/DarkHeroCard';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { PropertyList } from '../property-order/PropertyList';
import {
  mockOwnerName,
  mockActionCenter,
  mockSnapshot,
  mockCollection,
  mockProperties,
  mockAlertCount,
  type MockProperty,
} from '@shared/mocks/dashboard';

type ActionCenterData = typeof mockActionCenter;
type SnapshotData = typeof mockSnapshot;
type CollectionData = typeof mockCollection;

interface OwnerHomeDashboardProps {
  ownerName?: string;
  properties?: MockProperty[];
  alertCount?: number;
  actionCenter?: ActionCenterData;
  snapshot?: SnapshotData;
  collection?: CollectionData;
  onSelectProperty?: (hostelId: string) => void;
  onOpenAlerts?: () => void;
  onOpenQuickActions?: () => void;
  onViewAllActions?: () => void;
  onPropertyMenu?: (hostelId: string) => void;
  onAddHostel?: () => void;
  /** Full ordered list of hostel ids after a manual reorder. See ADR-042. */
  onReorderProperties?: (orderedIds: string[]) => void;
  /** Opens Universal Search. See ADR-044. */
  onOpenSearch?: () => void;
  /** Opens today's prioritised collection queue. See ADR-045. */
  onOpenCollectionQueue?: () => void;
}

/**
 * Home-tab dashboard content, per Stayo App.dc.html — greeting, Action
 * Center, Snapshot, monthly collection progress, and the draggable property
 * list. Pure presentational: takes data via props (defaulting to
 * mockDashboardData) so it's a straight swap-in — see
 * `hooks/useOwnerDashboard.ts` for the real data source now used at `/owner/home`.
 */
export function OwnerHomeDashboard({
  ownerName = mockOwnerName,
  properties = mockProperties,
  alertCount = mockAlertCount,
  actionCenter = mockActionCenter,
  snapshot = mockSnapshot,
  collection = mockCollection,
  onSelectProperty,
  onOpenAlerts,
  onOpenQuickActions,
  onViewAllActions,
  onPropertyMenu,
  onAddHostel,
  onReorderProperties,
  onOpenSearch,
  onOpenCollectionQueue,
}: OwnerHomeDashboardProps) {
  return (
    <div className="flex flex-col gap-7 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-foreground">
            Good morning, {ownerName}
          </h1>
          <p className="mt-1.5 text-[13px] font-medium text-muted-foreground">{properties.length} hostels · {collection.month}</p>
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
          <StatCard variant="action" label="Review Agreements" value={actionCenter.reviewAgreements.value} caption={actionCenter.reviewAgreements.caption} />
          <StatCard variant="action" label="Activate Tenants" value={actionCenter.activateTenants.value} caption={actionCenter.activateTenants.caption} />
          <StatCard variant="action" label="Fill Vacant Beds" value={actionCenter.fillVacantBeds.value} caption={actionCenter.fillVacantBeds.caption} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Snapshot</h2>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Beds" value={snapshot.beds.value} caption={snapshot.beds.caption} />
          <StatCard
            label="Outstanding"
            value={<span className="text-destructive">{snapshot.outstanding.value}</span>}
            caption={snapshot.outstanding.caption}
          />
          <StatCard
            label="Today's revenue"
            value={<span className="text-success">{snapshot.todaysRevenue.value}</span>}
            caption={snapshot.todaysRevenue.caption}
          />
        </div>
      </section>

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

      <PropertyList
        properties={properties}
        onSelectProperty={onSelectProperty}
        onPropertyMenu={onPropertyMenu}
        onAddHostel={onAddHostel}
        onReorder={onReorderProperties}
      />

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
