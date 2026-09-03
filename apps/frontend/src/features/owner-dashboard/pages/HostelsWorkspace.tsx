import { useMatch } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { MasterDetail } from '@/app/layouts/MasterDetail';
import { HostelsPage } from './HostelsPage';

/**
 * The `/owner/hostels` workspace ([[Decisions#ADR-171|ADR-171]] Phase 2.3).
 *
 * On `lg+` it is a master-detail: `HostelsPage` (the property list / single-hostel
 * overview) on the left, the selected hostel's drilldown — `/owner/hostels/:hostelId/*`,
 * a nested route rendered through `<Outlet/>` — on the right, carrying its own
 * Overview/Rooms/Tenants/Settings tab row inside the pane. An empty-state prompt
 * shows when nothing is selected.
 *
 * Below `lg` `<MasterDetail>` renders only the branch the URL is on: the list at
 * `/owner/hostels`, or the full-screen `HostelDrilldownLayout` takeover at
 * `/owner/hostels/:hostelId/*` (with `OwnerAppShell` shedding its bottom nav /
 * frame for that path — see `isOwnerFullBleedPath`). Either way it is exactly
 * the pre-Phase-2.3 experience.
 *
 * The builder routes (`/owner/hostels/new`, `/owner/hostels/:hostelId/build`)
 * are declared outside `OwnerAppShell` and never reach here. Selection lives
 * only in the URL.
 */
export function HostelsWorkspace() {
  // Matches `/owner/hostels/<id>` and any drilldown sub-tab
  // (`/owner/hostels/<id>/overview` …). `null` on the bare `/owner/hostels`
  // list. The builder's `new` / `:hostelId/build` paths resolve to their own
  // standalone routes outside this workspace, so this match is unambiguous.
  const detailMatch = useMatch('/owner/hostels/:hostelId/*');

  return (
    <MasterDetail
      hasSelection={detailMatch != null}
      list={<HostelsPage />}
      emptyState={
        <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
            <Building2 className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <p className="max-w-[260px] text-sm text-muted-foreground">
            Select a hostel to see its rooms, tenants and settings.
          </p>
        </div>
      }
    />
  );
}
