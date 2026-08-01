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
 * `GET /api/tenants?status=INVITED` is hostel-scoped, so "all hostels" fans
 * out across every hostel the owner has — never a single assumed hostel. Each
 * tenant's step comes from its own `activation-state` read, which reuses the
 * backend state machine; nothing here re-derives a step.
 */
export function usePendingActivations() {
  const session = useOwnerSession();
  const hostelIds = useMemo(() => session.hostels.map((h) => h.id), [session.hostels]);

  const invitedQuery = useQuery({
    queryKey: ['owner', 'tenants', 'invited', [...hostelIds].sort()],
    queryFn: async () => {
      const perHostel = await Promise.all(
        hostelIds.map(async (id) => {
          const hostelName = session.hostels.find((h) => h.id === id)?.name ?? '';
          const raw = await tenantService.getAll(id, { status: 'INVITED' });
          return normalizeTenants(raw).map((t) => ({ ...t, hostelId: id, hostelName }));
        }),
      );
      return perHostel.flat();
    },
    enabled: session.isAuthenticated && hostelIds.length > 0,
    staleTime: 30_000,
  });

  const invited = invitedQuery.data ?? [];

  const stateQueries = useQueries({
    queries: invited.map((t) => ({
      queryKey: ['owner', 'tenant', t.id, 'activation-state'],
      queryFn: () => tenantService.getActivationState(t.id) as Promise<ActivationStateLike>,
      staleTime: 30_000,
      retry: false,
    })),
  });

  const rows: PendingActivationRow[] = useMemo(
    () =>
      invited
        .map((t, i) => {
          const state = (stateQueries[i]?.data as ActivationStateLike | undefined) ?? null;
          return {
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
          };
        })
        // Requirement: a tenant disappears from this queue the moment the
        // backend reports activation complete, without waiting for the list
        // query's status string to catch up.
        .filter((row) => isAwaitingActivation('INVITED', row.state)),
    [invited, stateQueries],
  );

  return {
    rows,
    count: rows.length,
    isLoading: session.isLoading || invitedQuery.isLoading,
    isError: invitedQuery.isError,
    refetch: invitedQuery.refetch,
  };
}
