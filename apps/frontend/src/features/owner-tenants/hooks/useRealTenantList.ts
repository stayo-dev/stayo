import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { tenantService } from '@features/tenants/api';
import { normalizeTenants, getInitials, type NormalizedTenant } from '@features/tenants/utils/normalize';
import type { MockTenant } from '@shared/mocks/tenants';
import type { TenantFilterChip } from '../types';

export function toTenantListItem(t: NormalizedTenant, hostelId: string, hostelName: string): MockTenant {
  const isInvited = t.status === 'INVITED';
  const isOverdue = !isInvited && t.outstandingAmount > 0 && ['OVERDUE', 'PARTIAL', 'PENDING'].includes(t.paymentStatus.toUpperCase());
  let status: MockTenant['status'];
  let statusLabel: string;
  if (isInvited) {
    status = 'invited';
    statusLabel = 'Invited';
  } else if (isOverdue) {
    status = 'overdue';
    statusLabel = 'Overdue';
  } else if (!t.documentVerified) {
    status = 'pending-docs';
    statusLabel = 'Docs Pending';
  } else {
    status = 'active';
    statusLabel = 'Active';
  }

  return {
    id: t.id,
    name: t.name,
    initials: getInitials(t.name),
    // Already produced by the normalizer and already on every list endpoint —
    // this mapping was the only thing dropping it.
    photoUrl: t.photoUrl ?? null,
    phone: t.phone,
    hostelId,
    hostelName,
    room: t.room === 'N/A' ? '—' : t.room,
    rent: t.rent,
    status,
    statusLabel,
    outstanding: t.outstandingAmount,
    overdueMonths: t.overdueDays,
    joinedDate: t.joinDate ?? '',
    riskScore: t.score ?? 0,
    riskLabel: '',
    riskInsight: '',
    paymentRatePercent: 0,
    agreementStatus: t.hasAgreement ? 'Signed' : 'Pending',
    kycStatus: t.documentVerified ? 'Verified' : 'Pending',
    obligations: [],
    activity: [],
    documents: [],
    stay: {
      hostelName,
      roomBed: t.room,
      moveInDate: t.joinDate ?? '',
      agreementPeriod: '',
      monthlyRent: t.rent,
      deposit: t.securityDeposit,
      billingFrequency: '',
    },
  };
}

/**
 * Real tenant list, replacing `useTenantFilters`'s `mockTenants` source.
 * `GET /api/tenants` is hostel-scoped — "All Hostels" fans out in parallel
 * across every real hostel the owner has (never a single assumed hostel,
 * per the CLAUDE.md invariant) and merges client-side.
 */
export function useRealTenantList() {
  const session = useOwnerSession();
  const [hostelId, setHostelId] = useState('all');
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<TenantFilterChip>('all');

  const hostelOptions = useMemo(
    () => [{ id: 'all', name: 'All Hostels' }, ...session.hostels.map((h) => ({ id: h.id, name: h.name }))],
    [session.hostels],
  );

  const targetHostelIds = useMemo(
    () => (hostelId === 'all' ? session.hostels.map((h) => h.id) : [hostelId]),
    [hostelId, session.hostels],
  );

  const listQuery = useQuery({
    queryKey: ['owner', 'tenants', 'list-merged', [...targetHostelIds].sort()],
    queryFn: async () => {
      const results = await Promise.all(
        targetHostelIds.map(async (id) => {
          const hostelName = session.hostels.find((h) => h.id === id)?.name ?? '';
          const raw = await tenantService.getAll(id, {});
          return normalizeTenants(raw).map((t) => toTenantListItem(t, id, hostelName));
        }),
      );
      return results.flat();
    },
    enabled: session.isAuthenticated && targetHostelIds.length > 0,
    staleTime: 60_000,
  });

  const allTenants = listQuery.data ?? [];

  const counts = useMemo(
    () => ({
      all: allTenants.length,
      overdue: allTenants.filter((t) => t.status === 'overdue').length,
      invited: allTenants.filter((t) => t.status === 'invited').length,
    }),
    [allTenants],
  );

  const tenants = useMemo(() => {
    let list = allTenants;
    if (chip === 'overdue') list = list.filter((t) => t.status === 'overdue');
    if (chip === 'invited') list = list.filter((t) => t.status === 'invited');
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.room.toLowerCase().includes(q) || t.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
      );
    }
    return list;
  }, [allTenants, chip, search]);

  const selectedHostelName = hostelOptions.find((h) => h.id === hostelId)?.name ?? 'All Hostels';

  return {
    hostelOptions,
    hostelId,
    setHostelId,
    selectedHostelName,
    search,
    setSearch,
    chip,
    setChip,
    counts,
    tenants,
    isLoading: session.isLoading || listQuery.isLoading,
  };
}
