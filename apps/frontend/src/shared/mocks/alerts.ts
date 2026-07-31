/**
 * Centralized Alerts-tab mock data — shared/mocks/, not per-feature. Ports
 * Stayo App.dc.html's `leadsData`/`adminMsgData`/`renewalsData`/`requestsData`
 * verbatim. The design has no read/unread concept at all — `read` is a new
 * field added per explicit request, seeded with a plausible mixed state
 * rather than "everything unread" or "everything read".
 */

export type AlertCategory = 'leads' | 'admin' | 'renewals' | 'requests';

export interface MockLead {
  id: string;
  name: string;
  detail: string;
  stage: string;
  read: boolean;
}

export interface MockAdminMessage {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

export interface MockRenewal {
  id: string;
  name: string;
  detail: string;
  days: number;
  read: boolean;
}

export interface MockRequest {
  id: string;
  name: string;
  detail: string;
  type: string;
  read: boolean;
}

export const mockLeads: MockLead[] = [
  { id: 'lead-1', name: 'Praveen Kumar', detail: 'Enquired via website · Boys Hostel-1', stage: 'New', read: false },
  { id: 'lead-2', name: 'Sowmya Reddy', detail: 'Walk-in visit scheduled tomorrow', stage: 'Visit set', read: false },
  { id: 'lead-3', name: 'Arjun Vardhan', detail: 'Asked about Girls Hostel pricing', stage: 'Follow up', read: true },
];

export const mockAdminMessages: MockAdminMessage[] = [
  { id: 'admin-1', title: 'Payout scheduled', body: 'Your July payout of ₹4.1L will be credited by 25th.', time: '2h ago', read: false },
  { id: 'admin-2', title: 'Verify GST details', body: 'Update your GST number to keep invoicing compliant.', time: '1d ago', read: true },
  { id: 'admin-3', title: 'New feature: Quick Collect', body: 'Record payments faster with instant obligation settlement.', time: '3d ago', read: true },
];

export const mockRenewals: MockRenewal[] = [
  { id: 'renewal-1', name: 'Dongari Vamshi Nadh', detail: 'Room 301 · agreement ends in 4 days', days: 4, read: false },
  { id: 'renewal-2', name: 'K. Ashish', detail: 'No room assigned · agreement ends in 9 days', days: 9, read: true },
  { id: 'renewal-3', name: 'Mohammed Afreed', detail: 'Room G4 · agreement ends in 12 days', days: 12, read: true },
];

export const mockRequests: MockRequest[] = [
  { id: 'request-1', name: 'Rahul Verma', detail: 'Asked to extend agreement by 6 months', type: 'Extension', read: false },
  { id: 'request-2', name: 'Rohan Reddy', detail: 'Requested room change to Room 210', type: 'Room change', read: false },
  { id: 'request-3', name: 'Rishi Singh Raj Purohit', detail: 'Asked about early move-out on 30 Aug', type: 'Move-out', read: true },
];

export const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  leads: 'Leads',
  admin: 'Admin',
  renewals: 'Renewals',
  requests: 'Requests',
};
