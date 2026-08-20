import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRealTenantList } from '../hooks/useRealTenantList';
import { TenantFilters } from '../components/TenantFilters';
import { TenantList } from '../components/TenantList';
import { InviteTenantWizard } from '../invite/InviteTenantWizard';
import { admissionsService } from '@features/admissions/api';
import { queryKeys } from '@lib/queryKeys';
import { leadToInviteWizardData } from '../leadPrefill';
import type { InviteWizardData } from '../types';
import type { MockTenant } from '@shared/mocks/tenants';

function TenantsLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-6 sm:px-6">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-11 animate-pulse rounded-[11px] bg-muted" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/** Tenants tab — list screen, per Stayo App.dc.html. Thin orchestrator: real data via `useRealTenantList`, the invite flow is its own self-contained wizard (still mock this slice). */
export function TenantsPage() {
  const navigate = useNavigate();
  const filters = useRealTenantList();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Reached from a Lead's Accept action (`?fromLead=<id>`) — fetched by id
  // rather than carried via router state so a refresh still re-prefills
  // instead of opening the wizard blank.
  const fromLeadId = searchParams.get('fromLead');
  const leadQuery = useQuery({
    queryKey: queryKeys.admissions.detail(fromLeadId ?? ''),
    queryFn: () => admissionsService.detail(fromLeadId),
    enabled: Boolean(fromLeadId),
  });

  useEffect(() => {
    if (fromLeadId && leadQuery.data) setInviteOpen(true);
  }, [fromLeadId, leadQuery.data]);

  const closeInvite = () => {
    setInviteOpen(false);
    if (fromLeadId) {
      const next = new URLSearchParams(searchParams);
      next.delete('fromLead');
      setSearchParams(next, { replace: true });
    }
  };

  const goToTenant = (tenant: MockTenant) => navigate(tenant.id);

  if (filters.isLoading) return <TenantsLoadingSkeleton />;

  const leadInitialData: Partial<InviteWizardData> | undefined = leadQuery.data ? leadToInviteWizardData(leadQuery.data) : undefined;

  return (
    <div className="flex flex-col gap-4 px-5 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Tenants</h1>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="rounded-xl bg-primary px-4 py-2.5 font-display text-[13px] font-bold text-primary-foreground"
        >
          + Invite
        </button>
      </div>

      <TenantFilters filters={filters} />
      <TenantList tenants={filters.tenants} onSelect={goToTenant} onInvite={() => setInviteOpen(true)} showHostel={filters.hostelId === 'all'} />

      <InviteTenantWizard
        open={inviteOpen}
        onClose={closeInvite}
        initialData={fromLeadId ? leadInitialData : undefined}
        leadId={fromLeadId ?? undefined}
      />
    </div>
  );
}
