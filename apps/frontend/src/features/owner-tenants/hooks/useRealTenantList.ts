import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { tenantService } from '@features/tenants/api';
import { normalizeTenants, getInitials, type NormalizedTenant } from '@features/tenants/utils/normalize';
import type { MockTenant } from '@shared/mocks/tenants';
import { useSearchParams } from 'react-router-dom';
import {
  countTenants,
  filterTenants,
  inviteStageLabel,
  inviteStageOf,
  parseFilterParams,
  type SubFilter,
  type TenantView,
} from '../tenantListFilters';

export function toTenantListItem(t: NormalizedTenant, hostelId: string, hostelName: string): MockTenant {
  // A tenancy is ACTIVE from the moment it's invited (see createInvitation), so
  // `status` alone no longer says "hasn't taken charge of their account yet".
  // `access_mode === 'OWNER_MANAGED'` covers both a new-model tenant who has
  // not personally accepted (`acceptanceStatus === 'PENDING'`) and a
  // grandfathered owner-managed row. The label distinguishes the two.
  const isInvited = t.accessMode === 'OWNER_MANAGED';
  const isAwaitingAcceptance = t.acceptanceStatus === 'PENDING';
  // Genuinely past due — `paymentStatus` is OVERDUE only when an obligation's
  // due_date has passed. A tenant with this month's rent generated but not yet
  // due is PENDING with a balance, which is "Dues", not "Overdue".
  const isOverdue = !isInvited && t.paymentStatus.toUpperCase() === 'OVERDUE';
  const hasDues = !isInvited && !isOverdue && t.outstandingAmount > 0;
  let status: MockTenant['status'];
  let statusLabel: string;
  // Every invited tenant has a stage; `no-link` covers one added without a link.
  const inviteStage = isInvited ? inviteStageOf(t.latestInvitation) : undefined;
  if (isInvited) {
    status = 'invited';
    // The stage says more than "Invited" ever did: is the link dead, unopened,
    // half-way through sign-up? A legacy row with no link keeps the old label.
    statusLabel = inviteStage && inviteStage !== 'no-link'
      ? inviteStageLabel(inviteStage)
      : isAwaitingAcceptance ? 'Awaiting acceptance' : 'Invited';
  } else if (isOverdue) {
    status = 'overdue';
    statusLabel = 'Overdue';
  } else if (hasDues) {
    status = 'dues';
    statusLabel = 'Payment Due';
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
    // Days in, days out. This line used to rename the API's `overdue_days`
    // to `overdueMonths`, and the row downstream multiplied it by 30.
    overdueDays: t.overdueDays,
    paymentOverdue: t.paymentStatus.toUpperCase() === 'OVERDUE',
    overdueAmount: t.overdueAmount,
    overdueRentCount: t.overdueRentCount,
    inviteStage,
    joinedDate: t.joinDate ?? '',
    agreementStatus: t.hasAgreement ? 'Signed' : 'Pending',
    kycStatus: t.documentVerified ? 'Verified' : 'Pending',
    accessMode: t.accessMode,
    acceptanceStatus: t.acceptanceStatus,
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
 *
 * `hostelScopeOverride` (ADR-171 Phase 2.8): when passed (`'all'` or a real
 * hostel id), it drives the scope instead of the internal `hostelId` state —
 * the owner desktop console passes `useSelectedHostel()` here so the sidebar
 * `HostelSwitcher` is the single hostel control. Omit it (mobile) and the
 * in-page selector drives the local state exactly as before. The fan-out /
 * merge / query-key logic is identical either way.
 */
export function useRealTenantList(hostelScopeOverride?: string) {
  const session = useOwnerSession();
  const [localHostelId, setLocalHostelId] = useState('all');
  const hostelId = hostelScopeOverride ?? localHostelId;
  const setHostelId = setLocalHostelId;
  const [search, setSearch] = useState('');
  // Filter lives in the URL so Back from a tenant's profile lands on the same
  // filtered list rather than resetting to All.
  const [searchParams, setSearchParams] = useSearchParams();
  const { view, sub } = parseFilterParams(searchParams);
  const setFilter = useCallback(
    (nextView: TenantView, nextSub: SubFilter = 'any') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextView === 'all') next.delete('view');
          else next.set('view', nextView);
          if (nextSub === 'any') next.delete('show');
          else next.set('show', nextSub);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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

  /** Every invite whose link has lapsed, in the current hostel scope — ignores search and chips. */
  const expiredInvites = useMemo(
    () => allTenants.filter((t) => t.status === 'invited' && t.inviteStage === 'expired'),
    [allTenants],
  );

  const counts = useMemo(() => countTenants(allTenants), [allTenants]);

  const tenants = useMemo(() => filterTenants(allTenants, { view, sub, search }), [allTenants, view, sub, search]);

  const selectedHostelName = hostelOptions.find((h) => h.id === hostelId)?.name ?? 'All Hostels';

  return {
    hostelOptions,
    hostelId,
    setHostelId,
    selectedHostelName,
    search,
    setSearch,
    view,
    sub,
    setFilter,
    counts,
    tenants,
    expiredInvites,
    /** Re-reads the list after a bulk resend so tenants move to their new stage. */
    refresh: () => listQuery.refetch(),
    isLoading: session.isLoading || listQuery.isLoading,
  };
}
