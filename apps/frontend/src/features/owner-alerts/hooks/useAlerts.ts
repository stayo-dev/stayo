import { useState } from 'react';
import {
  mockLeads,
  mockAdminMessages,
  mockRenewals,
  mockRequests,
  type AlertCategory,
  type MockLead,
  type MockAdminMessage,
  type MockRenewal,
  type MockRequest,
} from '@shared/mocks/alerts';

/** Category filter + local read/unread state for the Alerts tab — session-local only, resets on reload (matches the rest of this mock journey). */
export function useAlerts() {
  const [category, setCategory] = useState<AlertCategory>('leads');
  const [leads, setLeads] = useState<MockLead[]>(mockLeads);
  const [adminMessages, setAdminMessages] = useState<MockAdminMessage[]>(mockAdminMessages);
  const [renewals, setRenewals] = useState<MockRenewal[]>(mockRenewals);
  const [requests, setRequests] = useState<MockRequest[]>(mockRequests);

  const markRead = (cat: AlertCategory, id: string) => {
    if (cat === 'leads') setLeads((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));
    if (cat === 'admin') setAdminMessages((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));
    if (cat === 'renewals') setRenewals((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));
    if (cat === 'requests') setRequests((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)));
  };

  return {
    category,
    setCategory,
    leads,
    adminMessages,
    renewals,
    requests,
    counts: { leads: leads.length, admin: adminMessages.length, renewals: renewals.length, requests: requests.length },
    markRead,
  };
}
