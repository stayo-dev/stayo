import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { portfolioService } from '@features/dashboard/api';
import { tenantService } from '@features/tenants/api';
import { agreementService } from '@features/agreements/api';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { useAlerts } from '@features/owner-alerts/hooks/useAlerts';
import { queryKeys } from '@lib/queryKeys';
import type { MockProperty } from '@shared/mocks/dashboard';
import { leftLabel, monthCash } from '../monthCash';

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
  status?: string;
}

interface PortfolioSummaryResponse {
  aggregate: PortfolioAggregate;
  hostels: PortfolioHostelCard[];
  /**
   * Has this owner ever recorded a payment, across every hostel and every
   * month. Composed in the route beside `month_spend`. Drives the checklist's
   * third step, which previously read *this month's* collection and therefore
   * needed a stored latch to survive the 1st. See ADR-139.
   */
  has_ever_collected?: boolean;
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
    queryKey: [...queryKeys.portfolio.summary(), { includeArchived: true }],
    queryFn: () => portfolioService.getSummary(true) as Promise<PortfolioSummaryResponse>,
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

  // Powers the "Activate Tenants — N awaiting activation" tile below. Used to
  // query `status: 'INVITED'`, which went to zero forever once a tenancy
  // became ACTIVE from the moment it's invited (see createInvitation's
  // owner-managed adoption) — who hasn't taken charge of their account yet is
  // `access_mode = OWNER_MANAGED` now, not `status = INVITED`.
  const invitedQuery = useQuery({
    queryKey: queryKeys.owner.invitedCounts(hostelIds),
    queryFn: async () => {
      const counts = await Promise.all(
        hostelIds.map((hostelId) =>
          tenantService
            .getAll(hostelId, { accessMode: 'OWNER_MANAGED', limit: 1 })
            .then((r: any) => Number(r?.total ?? r?.tenants?.length ?? 0)),
        ),
      );
      return counts.reduce((sum, n) => sum + n, 0);
    },
    enabled: hostelIds.length > 0,
    staleTime: 120_000,
  });

  // Gates the Renewal Agreements card — reuses the existing per-hostel
  // "Agreement Required" setting (ADR-059) rather than a new dashboard-only
  // toggle. See ADR-063. Resolves to hidden while loading, since this
  // controls whether the whole card exists, not just a number inside it.
  const policyQuery = useHostelPolicy(session.primaryHostelId);
  const showRenewalAgreements = policyQuery.isSuccess
    ? policyQuery.data?.policy?.tenant_rules?.agreement_required !== false
    : false;

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
        status: h.status,
        // Null until the owner answers "who stays here?". Drives the Hostels
        // tab's prompt, and decides whether every tenant of this hostel is
        // asked their gender during onboarding.
        hostelType: (h as any).hostel_type ?? null,
        activeTenants: h.active_tenants,
        // Zero beds means no rooms exist yet — the signal that a hostel's
        // build was never finished. Derived, not a stored setup flag.
        totalCapacity: h.total_capacity,
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
    // No daily-granularity revenue field exists on the backend (confirmed
    // during the readiness audit, only monthly) — labeled honestly as MTD
    // rather than mislabeled "today's".
    todaysRevenue: { value: formatLakh(aggregate?.rent_collected_this_month ?? 0), caption: 'Collected this month' },
    showRenewalAgreements,
  };

  const collected = aggregate?.rent_collected_this_month ?? 0;
  const target = collected + (aggregate?.pending_dues ?? 0);

  /**
   * Money in *and* money out. Home used to show only what came in, which
   * never answered the question an owner opens the app with — am I ahead this
   * month? See `monthCash.ts`, and note the label is "Left", never "profit":
   * this is cash received minus cash spent, blind to unpaid dues and deposits
   * held.
   */
  const spend = (portfolioQuery.data as any)?.month_spend ?? null;
  const cash = monthCash({ collected, spent: Number(spend?.this_month ?? 0), target });
  const collection = {
    month: new Date().toLocaleDateString('en-US', { month: 'long' }),
    percent: Math.round(aggregate?.collection_rate ?? 0),
    collected: formatINR(collected),
    target: formatINR(target),
    /** Null until the spend call returns — the card renders in/out only when it has both. */
    spent: spend ? formatINR(cash.spent) : null,
    left: spend ? formatINR(Math.abs(cash.left)) : null,
    leftLabel: leftLabel(cash),
    overspent: cash.overspent,
    spentShareOfCollected: cash.spentShareOfCollected,
  };

  /**
   * One line about spending, only in a month where something moved. Null the
   * rest of the time — the Action Center is for work, and an ordinary spend
   * month is not work.
   */
  const spendAnomaly = spend?.anomaly
    ? {
        category: String(spend.anomaly.category),
        changePct: Number(spend.anomaly.changePct),
        riseAmount: formatINR(Number(spend.anomaly.riseAmount)),
      }
    : null;

  const alerts = useAlerts();
  const alertCount = 
    alerts.adminMessages.filter(a => !a.read).length + 
    alerts.renewals.filter(r => !r.read).length + 
    alerts.requests.filter(r => !r.read).length;

  const roomCapacity = Number(aggregate?.total_capacity ?? 0);
  // An invited tenant counts: the owner has done the work, and waiting on
  // the tenant to accept is not a step they can take again.
  const tenantCount = Number(aggregate?.active_tenants ?? 0) + Number(invitedQuery.data ?? 0);

  return {
    ownerId: session.ownerId,
    ownerName: session.ownerName?.split(' ')[0] || 'Owner',
    properties,
    actionCenter,
    collection,
    spendAnomaly,
    alertCount,
    /**
     * Raw figures behind the new-owner walkthrough. Exposed as numbers rather
     * than letting the card re-parse the formatted strings above — "₹1,32,600"
     * does not compare to zero.
     */
    gettingStartedSignals: {
      roomCapacity,
      tenantCount,
      hasEverCollected: Boolean(portfolioQuery.data?.has_ever_collected),
    },
    /**
     * Which cards on Home have earned the right to render. Same raw figures,
     * different question — see `homeSections.ts` for why a brand-new owner is
     * shown a growing screen rather than a dashboard full of zeros.
     */
    homeSectionSignals: {
      hostelCount: properties.length,
      roomCapacity,
      tenantCount,
      collectedThisMonth: collected,
      monthTarget: target,
    },
    // policyQuery is included so the Renewal Agreements card's appearance
    // isn't a visible pop-in after the rest of the page has already
    // rendered (it's a small, 5-min-cached fetch, so this costs nothing
    // on repeat visits). See ADR-063.
    isLoading: session.isLoading || portfolioQuery.isLoading || policyQuery.isLoading,
  };
}
