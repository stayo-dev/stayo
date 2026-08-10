import { useState, useEffect } from 'react';
import apiClient from '@lib/api-client';

export type DynamicAlertCategory = 'admin' | 'renewals' | 'requests';

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

export function useAlerts() {
  const [category, setCategory] = useState<DynamicAlertCategory>('admin');
  const [adminMessages, setAdminMessages] = useState<DynamicAdminMessage[]>([]);
  const [renewals, setRenewals] = useState<DynamicRenewal[]>([]);
  const [requests, setRequests] = useState<DynamicRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const response = await apiClient.get('/owner/alerts');
        setAdminMessages(response.adminMessages || []);
        setRenewals(response.renewals || []);
        setRequests(response.requests || []);
      } catch (err) {
        console.error('Failed to fetch alerts', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAlerts();
  }, []);

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
    counts: { 
      admin: adminMessages.length, 
      renewals: renewals.length, 
      requests: requests.length 
    },
    markRead,
    loading
  };
}
