import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { tenantService } from '@features/tenants/api';
import { normalizeTenants } from '@features/tenants/utils/normalize';
import {
  currentStepLabel,
  isAwaitingActivation,
  waitingSinceLabel,
  type ActivationStateLike,
} from '../activation/activationProgress';

export interface PendingActivationRow {
  tenantId: string;
  name: string;
  phone: string;
  room: string;
  hostelName: string;
  currentStep: string;
  currentLabel: string;
  waitingSince: string | null;
  waitingLabel: string | null;
  documentVerified: boolean;
  state: ActivationStateLike | null;
}

/**
 * Every tenant still working through activation, with the step each one is
 * stuck on.
 *
 * `GET /api/tenants?accessMode=OWNER_MANAGED` is hostel-scoped, so "all
 * hostels" fans out across every hostel the owner has — never a single
 * assumed hostel. Each tenant's step comes from its own `activation-state`
 * read, which reuses the backend state machine; nothing here re-derives a
 * step.
 *
 * Used to query `status=INVITED`. That stopped working once a tenancy became
 * `ACTIVE` from the moment it's invited (see `createInvitation`) — the query
 * would come back empty forever, and this whole queue (and the dashboard's
 * "Activate Tenants" tile that links here) would silently read zero. Who
 * hasn't taken charge of their account yet is `access_mode = OWNER_MANAGED`
 * now, not `status = INVITED`.
 */
export function usePendingActivations() {
  const session = useOwnerSession();
  const hostelIds = useMemo(() => session.hostels.map((h) => h.id), [session.hostels]);

  const ownerManagedQuery = useQuery({
    queryKey: ['owner', 'tenants', 'owner-managed', [...hostelIds].sort()],
    queryFn: async () => {
      const perHostel = await Promise.all(
        hostelIds.map(async (id) => {
          const hostelName = session.hostels.find((h) => h.id === id)?.name ?? '';
          // OWNER_MANAGED covers both new-model PENDING tenancies and
          // grandfathered rows; `isAwaitingActivation` below narrows it.
          const raw = await tenantService.getAll(id, { accessMode: 'OWNER_MANAGED' });
          return normalizeTenants(raw).map((t) => ({ ...t, hostelId: id, hostelName }));
        }),
      );
      return perHostel.flat();
    },
    enabled: session.isAuthenticated && hostelIds.length > 0,
    staleTime: 30_000,
  });

  const ownerManaged = ownerManagedQuery.data ?? [];

  const stateQueries = useQueries({
    queries: ownerManaged.map((t) => ({
      queryKey: ['owner', 'tenant', t.id, 'activation-state'],
      queryFn: () => tenantService.getActivationState(t.id) as Promise<ActivationStateLike>,
      staleTime: 30_000,
      retry: false,
    })),
  });

  const rows: PendingActivationRow[] = useMemo(
    () =>
      ownerManaged
        .map((t, i) => ({ t, state: (stateQueries[i]?.data as ActivationStateLike | undefined) ?? null }))
        // Requirement: a tenant disappears from this queue the moment the
        // backend reports activation complete, without waiting for the list
        // query's access-mode string to catch up.
        .filter(({ t, state }) => isAwaitingActivation({ accessMode: t.accessMode, acceptanceStatus: t.acceptanceStatus }, state))
        .map(({ t, state }) => ({
          tenantId: t.id,
          name: t.name,
          phone: t.phone,
          room: t.room === 'N/A' ? '—' : t.room,
          hostelName: (t as { hostelName?: string }).hostelName ?? '',
          currentStep: String(state?.current_step ?? ''),
          currentLabel: currentStepLabel(state),
          waitingSince: state?.activation_started_at ?? null,
          waitingLabel: waitingSinceLabel(state?.activation_started_at ?? t.joinDate ?? null),
          documentVerified: Boolean(t.documentVerified),
          state,
        })),
    [ownerManaged, stateQueries],
  );

  return {
    rows,
    count: rows.length,
    isLoading: session.isLoading || ownerManagedQuery.isLoading,
    isError: ownerManagedQuery.isError,
    refetch: ownerManagedQuery.refetch,
  };
}
