import { useMatch } from 'react-router-dom';
import { Users } from 'lucide-react';
import { MasterDetail } from '@/app/layouts/MasterDetail';
import { TenantsPage } from './TenantsPage';

/**
 * The `/owner/tenants` workspace ([[Decisions#ADR-171|ADR-171]] Phase 2.1).
 *
 * On `lg+` it is a master-detail: `TenantsPage` (the list) on the left, the
 * selected tenant's profile — `/owner/tenants/:tenantId`, a nested route
 * rendered through `<Outlet/>` — on the right, or an empty-state prompt when
 * nothing is selected.
 *
 * Below `lg` `<MasterDetail>` renders only the branch the URL is on: the list at
 * `/owner/tenants`, or the full-screen `TenantDetailPage` takeover at
 * `/owner/tenants/:tenantId` (with `OwnerAppShell` shedding its bottom nav /
 * frame for that path — see `isOwnerFullBleedPath`). Either way it is exactly
 * the pre-Phase-2.1 experience.
 *
 * Selection lives only in the URL. `TenantsPage` and `TenantDetailPage` are
 * unchanged.
 */
export function TenantsWorkspace() {
  // `TenantsWorkspace` only renders on `/owner/tenants` and `/owner/tenants/<id>`
  // (the sibling `.../verifications` and `.../activations` routes out-rank the
  // nested `:tenantId` and render their own pages), so this match is
  // unambiguous — null on the list, set on a detail route.
  const detailMatch = useMatch('/owner/tenants/:tenantId');
  const selectedTenantId = detailMatch?.params.tenantId ?? null;

  return (
    <MasterDetail
      hasSelection={detailMatch != null}
      list={<TenantsPage selectedTenantId={selectedTenantId} />}
      emptyState={
        <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
            <Users className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <p className="max-w-[260px] text-sm text-muted-foreground">
            Select a tenant to see their profile, payments and documents.
          </p>
        </div>
      }
    />
  );
}
