import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bed, Building2, ChevronRight, Megaphone, Plus, Settings2, Users } from 'lucide-react';
import { useOwnerDashboard } from '../hooks/useOwnerDashboard';
import { useHostelOrder } from '../property-order/useHostelOrder';
import { moveItem } from '../property-order/hostelSort';
import { PropertyList } from '../property-order/PropertyList';
import { HostelOptionsSheet } from '../components/HostelOptionsSheet';
import { hostelsTabMode, singleHostelOverview } from '../hostelsTab';

const card =
  'rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/**
 * The Hostels tab.
 *
 * It takes the bottom-nav slot Profile used to hold. Profile was four
 * rarely-opened rows with a fifth of the app's navigation to itself, while
 * hostels — the thing an owner manages every day — sat at the very bottom of
 * Home, below the rent card, three action tiles, today's revenue and the
 * month's collection summary. The most-managed object in the product was the
 * furthest scroll on the screen.
 *
 * The tab changes shape with the account, and `hostelsTab.ts` decides which
 * (asserted there, without rendering):
 *
 * - **One hostel** — the tab *is* that hostel. A list of one is a menu with a
 *   single item: a tap spent on nothing. Its numbers show directly, and the
 *   drilldown's own tabs are one tap away.
 * - **More than one** — `PropertyList`, unchanged, with its Active/Archived
 *   tabs, manual ordering (ADR-042) and Add. Its card already carries
 *   occupancy, revenue, dues and vacancy, which is also everything a ranking
 *   would need whenever one is added.
 * - **None** — the ADR-139 guarantee, moved here: "+ Add hostel" must always
 *   be reachable, or an account with no hostel is a dead end. It is now a
 *   permanent tab rather than a button below a screenful of scrolling.
 */
export function HostelsPage() {
  const navigate = useNavigate();
  const dash = useOwnerDashboard();
  const reorder = useHostelOrder();
  const [hostelMenuFor, setHostelMenuFor] = useState<string | null>(null);

  const properties = dash.properties;
  const mode = hostelsTabMode(properties);
  const single = singleHostelOverview(properties);

  const orderedIds = useMemo(
    () =>
      [...properties]
        .sort((a, b) => (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity))
        .map((p) => p.id),
    [properties],
  );

  const menuHostel = properties.find((p) => p.id === hostelMenuFor) ?? null;
  const menuIndex = hostelMenuFor ? orderedIds.indexOf(hostelMenuFor) : -1;

  const moveHostel = (hostelId: string, direction: 1 | -1) => {
    const from = orderedIds.indexOf(hostelId);
    if (from === -1) return;
    const next = moveItem(orderedIds, from, from + direction);
    if (next !== orderedIds) reorder.mutate(next);
    setHostelMenuFor(null);
  };

  const openHostel = (hostelId: string) => navigate(`/owner/hostels/${hostelId}/overview`);

  const drilldownRows = single
    ? [
        { key: 'rooms', label: single.needsRooms ? 'Add rooms' : 'Rooms & beds', icon: Bed },
        { key: 'tenants', label: 'Tenants', icon: Users },
        { key: 'marketing', label: 'Listing', icon: Megaphone },
        { key: 'settings', label: 'Settings', icon: Settings2 },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">
          {mode === 'single' ? 'Your hostel' : 'Hostels'}
        </h1>
        {mode === 'list' && (
          <button
            type="button"
            onClick={() => navigate('/owner/hostels/new')}
            className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-bold text-primary-foreground"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            Add
          </button>
        )}
      </div>

      {mode === 'single' && single && (
        <>
          <button
            type="button"
            onClick={() => openHostel(single.id)}
            className={`${card} flex flex-col gap-3.5 p-4 text-left`}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-secondary text-primary">
                <Building2 className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[16px] font-extrabold text-foreground">{single.name}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{single.location}</div>
              </div>
              <ChevronRight className="mt-2 h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
            </div>

            {/* Occupancy as a bar as well as a figure: "26%" is a number to
                decode, a bar is a glance. */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-muted-foreground">{single.beds}</span>
                <span className="font-display text-[13px] font-bold tabular-nums text-foreground">
                  {single.needsRooms ? '—' : single.occupancyLabel}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, single.occupancyPercent))}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium text-muted-foreground">Collected</span>
                <span className="font-display text-[13px] font-bold tabular-nums text-foreground">{single.revenue}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium text-muted-foreground">Dues</span>
                <span
                  className={`font-display text-[13px] font-bold tabular-nums ${single.hasDues ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {single.outstanding}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium text-muted-foreground">Vacant</span>
                <span className="font-display text-[13px] font-bold tabular-nums text-foreground">{single.vacant}</span>
              </div>
            </div>
          </button>

          {/*
            Unset type is not a cosmetic gap: while it is null, every tenant of
            this hostel is asked their gender during onboarding, because nothing
            can derive it. Every hostel created before the builder started
            asking is in this state, and only the owner knows the answer — so it
            is prompted rather than guessed from the name.
          */}
          {single.needsType && (
            <button
              type="button"
              onClick={() => navigate(`/owner/more/hostel?hostelId=${single.id}`)}
              className={`${card} flex items-center gap-3 border-primary/30 bg-primary/5 p-4 text-left`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[13.5px] font-bold text-foreground">Who stays here?</span>
                <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-muted-foreground">
                  Set this and your tenants stop being asked their gender when they join.
                </span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
            </button>
          )}

          {/* Without these the tab would show numbers and offer nothing to do
              about them. Same destinations as the drilldown's own tabs. */}
          <div className={`${card} overflow-hidden`}>
            {drilldownRows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                onClick={() => navigate(`/owner/hostels/${single.id}/${row.key}`)}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${i === 0 ? '' : 'border-t border-border/60'}`}
              >
                <row.icon className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{row.label}</span>
                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => navigate('/owner/hostels/new')}
            className="flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-card px-4 py-3.5 text-[13.5px] font-semibold text-muted-foreground"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Add another hostel
          </button>
        </>
      )}

      {mode !== 'single' && (
        <PropertyList
          properties={properties}
          onSelectProperty={openHostel}
          onPropertyMenu={(hostelId) => setHostelMenuFor(hostelId)}
          onAddHostel={() => navigate('/owner/hostels/new')}
          onReorder={(ids) => reorder.mutate(ids)}
        />
      )}

      <HostelOptionsSheet
        open={Boolean(hostelMenuFor)}
        onClose={() => setHostelMenuFor(null)}
        hostelId={hostelMenuFor}
        hostelName={menuHostel?.name ?? 'Hostel'}
        index={menuIndex}
        total={properties.length}
        onMove={moveHostel}
      />
    </div>
  );
}
