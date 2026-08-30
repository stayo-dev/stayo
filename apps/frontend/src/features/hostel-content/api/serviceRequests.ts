import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export interface OwnerServiceRequestEvent {
  id: string;
  /** Null for a pure chat message — set only when this entry is an actual status change. */
  status: string | null;
  note: string | null;
  actor_role: string;
  created_at: string;
}

export interface OwnerServiceRequest {
  id: string;
  type: string;
  category: string | null;
  description: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  tenants: { id: string; profiles: { name: string } | null };
  /** Most recent timeline/chat entry, if any — used to flag "awaiting owner reply." */
  tenant_service_request_events?: OwnerServiceRequestEvent[];
}

export const ownerServiceRequestsService = {
  list: async (hostelId: string, status?: string) => {
    const response = await api.get('/service-requests', { params: { hostelId, status } });
    return unwrap(response).requests as OwnerServiceRequest[];
  },
  updateStatus: async (id: string, data: { status: string; note?: string; assignedTo?: string }) => {
    const response = await api.patch(`/service-requests/${id}/status`, data);
    return unwrap(response);
  },
  getMessages: async (id: string) => {
    const response = await api.get(`/service-requests/${id}/messages`);
    return unwrap(response) as OwnerServiceRequest & { tenant_service_request_events: OwnerServiceRequestEvent[] };
  },
  sendMessage: async (id: string, message: string) => {
    const response = await api.post(`/service-requests/${id}/messages`, { message });
    return unwrap(response) as OwnerServiceRequestEvent;
  },
};

/** Awaiting the owner's reply: the ticket's most recent timeline entry was sent by the tenant. */
export function hasUnreadFromTenant(request: OwnerServiceRequest): boolean {
  const latest = request.tenant_service_request_events?.[0];
  return latest?.actor_role === 'TENANT';
}

/** Next status in the owner-driven flow; `null` means terminal (nothing left to advance to). */
export const STATUS_FLOW: Record<string, string | null> = {
  RAISED: 'ASSIGNED',
  ASSIGNED: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
  RESOLVED: null,
  REJECTED: null,
};

export const NEXT_ACTION_LABEL: Record<string, string> = {
  ASSIGNED: 'Mark assigned',
  IN_PROGRESS: 'Mark in progress',
  RESOLVED: 'Mark resolved',
};

/** Human-readable label for each `ServiceRequestType` — the single place this mapping lives. */
export const SERVICE_REQUEST_TYPE_LABEL: Record<string, string> = {
  MAINTENANCE: 'Maintenance',
  ROOM_CHANGE: 'Room change',
  CLEANING: 'Cleaning',
  LOST_KEY: 'Lost key',
  VISITOR_PASS: 'Visitor pass',
  EXTRA_MATTRESS: 'Extra mattress',
};
