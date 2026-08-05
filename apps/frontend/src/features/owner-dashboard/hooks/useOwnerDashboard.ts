import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { portfolioService } from '@features/dashboard/api';
import { tenantService } from '@features/tenants/api';
import { agreementService } from '@features/agreements/api';
import { queryKeys } from '@lib/queryKeys';
import type { MockProperty } from '@shared/mocks/dashboard';

function formatINR(value: number) {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function formatLakh(value: number) {
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  return formatINR(value);
}

interface PortfolioAggregate {
  total_capacity: number;
  active_tenants: number;
  vacant_beds: number;
  rent_collected_this_month: number;
  pending_dues: number;
  overdue_total: number;
  overdue_count: number;
  collection_rate: number;
}

interface PortfolioHostelCard {
  hostel_id: string;
  name: string;
  city: string | null;
  occupancy_rate: number;
  collected_revenue: number;
  pending_dues: number;
  total_capacity: number;
  active_tenants: number;
  /** Owner's manual Home position; null = never reordered. See ADR-042. */
  display_order: number | null;
}

interface PortfolioSummaryResponse {
  aggregate: PortfolioAggregate;
  hostels: PortfolioHostelCard[];
}

/**
 * Real data for the owner Home dashboard — composes the already-real, already-
 * ready endpoints found during the backend readiness audit (portfolio/summary
 * for the per-hostel + aggregate figures, pending-documents + renewal-queue
 * for two Action Center items, one parallel per-hostel fan-out for the third
 * — see the CLAUDE.md invariant on never falling back to "first hostel":
 * owner-wide counts here are always a real sum across every hostel, not a
 * single hostel's numbers). No field here is invented — anything the backend
 * genuinely doesn't track (e.g. "reminders sent") is labeled honestly rather
 * than faked.
 */
export function useOwnerDashboard() {
  const session = useOwnerSession();

  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary() as Promise<PortfolioSummaryResponse>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const pendingDocsQuery = useQuery({
    queryKey: queryKeys.owner.pendingDocuments(),
    queryFn: () => tenantService.getPendingDocuments() as Promise<unknown[]>,
    enabled: session.isAuthenticated,
    staleTime: 120_000,
  });

  const renewalsQuery = useQuery({
    queryKey: queryKeys.owner.renewalQueue(),
    queryFn: () => agreementService.getRenewalQueue() as Promise<{ counts: { total: number } }>,
    enabled: session.isAuthenticated,
    staleTime: 120_000,
  });

  const hostelIds = useMemo(
    () => (portfolioQuery.data?.hostels ?? []).map((h) => h.hostel_id),
    [portfolioQuery.data],
  );

  const invitedQuery = useQuery({
    queryKey: queryKeys.owner.invitedCounts(hostelIds),
    queryFn: async () => {
      const counts = await Promise.all(
        hostelIds.map((hostelId) =>
          tenantService
            .getAll(hostelId, { status: 'INVITED', limit: 1 })
            .then((r: any) => Number(r?.total ?? r?.tenants?.length ?? 0)),
        ),
      );
      return counts.reduce((sum, n) => sum + n, 0);
    },
    enabled: hostelIds.length > 0,
    staleTime: 120_000,
  });

  const aggregate = portfolioQuery.data?.aggregate;

  const properties: MockProperty[] = useMemo(
    () =>
      (portfolioQuery.data?.hostels ?? []).map((h) => ({
        id: h.hostel_id,
        name: h.name,
        location: h.city || '—',
        occupancyLabel: `${Math.round(h.occupancy_rate)}%`,
        revenue: formatINR(h.collected_revenue),
        outstanding: formatINR(h.pending_dues),
        vacant: Math.max(0, h.total_capacity - h.active_tenants),
        // Raw values for sorting — the formatted strings above can't be
        // compared numerically. See ADR-042.
        occupancyPercent: h.occupancy_rate,
        revenueValue: h.collected_revenue,
        outstandingValue: h.pending_dues,
        displayOrder: h.display_order ?? null,
      })),
    [portfolioQuery.data],
  );

  const pendingDocsCount = Array.isArray(pendingDocsQuery.data) ? pendingDocsQuery.data.length : 0;
  const renewalsCount = renewalsQuery.data?.counts?.total ?? 0;

  const actionCenter = {
    collectRent: {
      amount: formatINR(aggregate?.overdue_total ?? 0),
      caption: `${aggregate?.overdue_count ?? 0} tenants overdue`,
    },
    reviewAgreements: { value: renewalsCount, caption: 'Due for renewal' },
    activateTenants: { value: invitedQuery.data ?? 0, caption: 'Awaiting activation' },
    fillVacantBeds: { value: aggregate?.vacant_beds ?? 0, caption: 'Vacant beds' },
    verifyKyc: { value: pendingDocsCount, caption: 'Tenant document pending' },
    // No "reminder sent" tracking exists on the backend (confirmed during the
    // readiness audit) — overdue count is the honest real number available,
    // captioned accordingly rather than claiming something we can't know.
    sendReminders: { value: aggregate?.overdue_count ?? 0, caption: 'Overdue tenants' },
  };

  const snapshot = {
    beds: {
      value: `${aggregate?.active_tenants ?? 0}/${aggregate?.total_capacity ?? 0}`,
      caption: `${aggregate?.vacant_beds ?? 0} vacant`,
    },
    outstanding: { value: formatLakh(aggregate?.pending_dues ?? 0), caption: 'Due till today' },
    // No daily-granularity revenue field exists on the backend (confirmed
    // during the readiness audit, only monthly) — labeled honestly as MTD
    // rather than mislabeled "today's".
    todaysRevenue: { value: formatLakh(aggregate?.rent_collected_this_month ?? 0), caption: 'Collected this month' },
  };

  const collected = aggregate?.rent_collected_this_month ?? 0;
  const target = collected + (aggregate?.pending_dues ?? 0);
  const collection = {
    month: new Date().toLocaleDateString('en-US', { month: 'long' }),
    percent: Math.round(aggregate?.collection_rate ?? 0),
    collected: formatINR(collected),
    target: formatINR(target),
  };

  const alertCount = renewalsCount + pendingDocsCount + (aggregate?.overdue_count ?? 0);

  return {
    ownerName: session.ownerName?.split(' ')[0] || 'Owner',
    properties,
    actionCenter,
    snapshot,
    collection,
    alertCount,
    isLoading: session.isLoading || portfolioQuery.isLoading,
  };
}
