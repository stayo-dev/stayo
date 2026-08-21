import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@lib/api-client';
import { admissionsService } from '@features/admissions/api';
import { queryKeys } from '@lib/queryKeys';

export type DynamicAlertCategory = 'leads' | 'admin' | 'renewals' | 'requests';

export interface DynamicAdminMessage {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
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

export function useAlerts() {
  const [category, setCategory] = useState<DynamicAlertCategory>('leads');
  const [adminMessages, setAdminMessages] = useState<DynamicAdminMessage[]>([]);
  const [renewals, setRenewals] = useState<DynamicRenewal[]>([]);
  const [requests, setRequests] = useState<DynamicRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAlerts() {
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
    }
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Leads have their own funnel elsewhere and don't need the 60s poll the
  // other three categories share — fetched via the shared admissions query
  // key, so Accept/Hold/Reject mutations in LeadDetailSheet can invalidate
  // it instead of this hook needing its own refetch plumbing.
  const leadsQuery = useQuery({
    queryKey: queryKeys.admissions.list({ limit: 20 }),
    queryFn: () => admissionsService.list({ limit: 20 }) as Promise<{ items?: DynamicLead[] }>,
    enabled: category === 'leads',
  });
  const leads = leadsQuery.data?.items ?? [];
  const leadsLoading = leadsQuery.isLoading;

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
    category,
    setCategory,
    adminMessages,
    renewals,
    requests,
    leads,
    leadsLoading,
    counts: {
      leads: leads.length,
      admin: adminMessages.length,
      renewals: renewals.length,
      requests: requests.length,
    },
    markRead,
    loading
  };
}
