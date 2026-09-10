import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import { masterDetailBranch } from './masterDetailBranch';

interface MasterDetailProps {
  /** The list column — a `<Route>`-agnostic list of rows that link to detail routes. */
  list: ReactNode;
  /**
   * Whether a detail route is currently active (a row is "selected"). The caller
   * knows this from its own route params — `<MasterDetail>` holds no selection
   * state of its own; the URL is the single source of truth.
   */
  hasSelection: boolean;
  /** Shown in the detail pane at `lg+` when nothing is selected. */
  emptyState?: ReactNode;
  /**
   * The detail content. Defaults to `<Outlet/>` — the detail route renders
   * through here once Phase 2 nests the routes. A caller can pass an explicit
   * node instead (e.g. while the routes are still siblings).
   */
  detail?: ReactNode;
}

/**
 * The one desktop list-and-detail layout, shared by Owner Tenants / Hostels /
 * work queues / Alerts→Leads and Tenant Complaints / Profile.
 *
 * At `lg+`: fixed list column (`380px`, `420px` at `xl`) + a detail pane that
 * fills the rest. Below `lg`: renders **only** the branch matching the current
 * route — the list *or* the takeover, never both — which is exactly today's
 * behaviour. Not resizable in v1.
 *
 * Introduced in Phase 0; nothing imports it yet.
 */
export function MasterDetail({ list, hasSelection, emptyState, detail }: MasterDetailProps) {
  const isDesktop = useIsDesktop();
  const branch = masterDetailBranch({ isDesktop, hasSelection });
  const detailNode = detail ?? <Outlet />;

  if (branch === 'list') return <>{list}</>;
  if (branch === 'detail') return <>{detailNode}</>;

  return (
    // `h-full`, not `flex-1` — the console's `<main>` has a definite height
    // (it is a bounded flex child), so each pane can own its own scroll rather
    // than the whole thing scrolling as one column.
    <div className="flex h-full min-h-0">
      <div className="w-[380px] flex-none overflow-y-auto border-r border-border xl:w-[420px]">{list}</div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {hasSelection ? detailNode : (emptyState ?? <MasterDetailEmpty />)}
      </div>
    </div>
  );
}

function MasterDetailEmpty() {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center">
      <p className="text-sm text-muted-foreground">Select an item to see its details.</p>
    </div>
  );
}
