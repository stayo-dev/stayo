import { useState, useEffect, useCallback } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import apiClient from '@lib/api-client';
import { admissionsService } from '@features/admissions/api';
import { queryKeys } from '@lib/queryKeys';
import { ACTIONABLE_LEAD_STATUSES, SETTLED_LEAD_STATUSES } from '../leadInbox';

/**
 * The server caps `limit` at 50 (`listLeads`), so this is the largest page it
 * will actually honour — asking for more would silently get 50 back.
 */
const LEAD_PAGE_LIMIT = 50;

interface LeadPage {
  items?: DynamicLead[];
  pagination?: { page: number; limit: number; total: number; pages: number };
}

export type DynamicAlertCategory = 'leads' | 'admin' | 'renewals' | 'requests';

export interface DynamicAdminMessage {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  /** Present when this is a `service_request` notification — lets a click deep-link to the exact ticket's chat. */
  metadata?: { requestId?: string } | null;
}

export interface DynamicRenewal {
  id: string;
  name: string;
  detail: string;
  days: number;
  read: boolean;
}

export interface DynamicRequest {
  id: string;
  name: string;
  detail: string;
  type: string;
  status: string;
  read: boolean;
}

/** One `visitor_leads` row, shaped as `admissionsService.list()` returns it. */
export interface DynamicLead {
  id: string;
  student_name: string;
  student_phone: string | null;
  source: string;
  status: string;
  hostel_id: string;
  hostel?: { id: string; name: string };
  seeker_profile_id: string | null;
}

export function useAlerts(options?: { includeLeads?: boolean }) {
  const includeLeads = options?.includeLeads ?? false;
  const [adminMessages, setAdminMessages] = useState<DynamicAdminMessage[]>([]);
  const [renewals, setRenewals] = useState<DynamicRenewal[]>([]);
  const [requests, setRequests] = useState<DynamicRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await apiClient.get('/owner/alerts');
      setAdminMessages(response.data.adminMessages || []);
      setRenewals(response.data.renewals || []);
      setRequests(response.data.requests || []);
    } catch (err) {
      console.error('Failed to fetch alerts', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Leads have their own funnel elsewhere and don't need the 60s poll the
  // other three categories share — fetched via the shared admissions query
  // key, so Accept/Hold/Reject mutations in LeadDetailSheet can invalidate
  // it instead of this hook needing its own refetch plumbing.
  //
  // Fetched in **two halves**, not one page of 20. `listLeads` orders by
  // `lead_score desc`, and a brand-new enquiry scores low — so on a single
  // page it sorts *below* settled high-score leads and can fall off the end
  // entirely. An owner would simply never see it. Asking for the actionable
  // statuses as their own page is what makes that impossible.
  const actionableQuery = useQuery({
    queryKey: queryKeys.admissions.list({ set: 'actionable' }),
    queryFn: () =>
      admissionsService.list({
        statuses: ACTIONABLE_LEAD_STATUSES.join(','),
        limit: LEAD_PAGE_LIMIT,
      }) as Promise<LeadPage>,
    enabled: includeLeads,
  });

  /**
   * Settled leads are collapsed in the UI, so only the most recent page loads
   * up front and "Show older" fetches the next one.
   *
   * Paged rather than a growing `limit`: `listLeads` clamps `limit` to 50, so
   * asking for 100 would silently return 50 again and the button would appear
   * to do nothing.
   */
  const settledQuery = useInfiniteQuery({
    queryKey: queryKeys.admissions.list({ set: 'settled' }),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      admissionsService.list({
        statuses: SETTLED_LEAD_STATUSES.join(','),
        limit: LEAD_PAGE_LIMIT,
        page: pageParam,
      }) as Promise<LeadPage>,
    getNextPageParam: (last: LeadPage) => {
      const { page = 1, pages = 1 } = last.pagination ?? {};
      return page < pages ? page + 1 : undefined;
    },
    enabled: includeLeads,
  });

  const actionableLeads = actionableQuery.data?.items ?? [];
  const settledPages = settledQuery.data?.pages ?? [];
  const settledLeads = settledPages.flatMap((page) => page.items ?? []);
  const leads = [...actionableLeads, ...settledLeads];
  const leadsLoading = actionableQuery.isLoading || settledQuery.isLoading;

  const settledTotal = settledPages[0]?.pagination?.total ?? settledLeads.length;
  const actionableTotal = actionableQuery.data?.pagination?.total ?? actionableLeads.length;

  const markRead = async (cat: DynamicAlertCategory, id: string) => {
    // Optimistic UI update
    if (cat === 'admin') setAdminMessages((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));
    if (cat === 'renewals') setRenewals((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));
    if (cat === 'requests') setRequests((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));

    try {
      await apiClient.post('/owner/alerts', { category: cat, id });
    } catch (err) {
      console.error('Failed to mark read', err);
    }
  };

  return {
    adminMessages,
    renewals,
    requests,
    leads,
    leadsLoading,
    /** How many settled leads exist beyond the ones loaded. */
    settledNotLoaded: Math.max(0, settledTotal - settledLeads.length),
    canLoadMoreSettled: Boolean(settledQuery.hasNextPage),
    loadMoreSettled: () => settledQuery.fetchNextPage(),
    isLoadingMoreSettled: settledQuery.isFetchingNextPage,
    /**
     * True when there are more actionable leads than one page holds. Very
     * unlikely, and deliberately surfaced rather than silently truncated —
     * this is the half where a hidden lead actually costs the owner money.
     */
    actionableTruncated: actionableTotal > actionableLeads.length,
    markRead,
    loading,
    refetch: fetchAlerts,
  };
}
