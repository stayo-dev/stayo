import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export interface TenantRoom {
  room_no: string;
  capacity: number;
  floor: string;
  wifi_name: string | null;
  wifi_password: string | null;
  notes: string | null;
}

export interface TenantRoommate {
  name: string;
}

export interface UtilityStatusRow {
  id: string;
  utility: 'WATER' | 'WIFI' | 'ELECTRICITY' | 'CLEANING';
  status: 'OK' | 'ISSUE' | 'OUTAGE';
  note: string | null;
  updated_at: string;
}

export interface HouseRuleSection {
  title: string;
  items: string[];
}

export type ServiceRequestType = 'MAINTENANCE' | 'ROOM_CHANGE' | 'CLEANING' | 'LOST_KEY' | 'VISITOR_PASS' | 'EXTRA_MATTRESS';
export type ServiceRequestStatus = 'RAISED' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';

export interface ServiceRequest {
  id: string;
  type: ServiceRequestType;
  category: string | null;
  description: string | null;
  photo_url: string | null;
  status: ServiceRequestStatus;
  assigned_to: string | null;
  eta: string | null;
  fee_amount: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ServiceRequestEvent {
  id: string;
  status: ServiceRequestStatus;
  note: string | null;
  actor_role: string;
  created_at: string;
}

export const tenantRoomService = {
  getRoom: async () => {
    const response = await api.get('/tenants/me/room');
    return unwrap(response) as {
      room: TenantRoom | null;
      roommates: TenantRoommate[];
      utilityStatus: UtilityStatusRow[];
      houseRules: HouseRuleSection[];
    };
  },
  getServiceRequests: async () => {
    const response = await api.get('/tenants/me/service-requests');
    return unwrap(response).requests as ServiceRequest[];
  },
  getServiceRequestDetail: async (id: string) => {
    const response = await api.get(`/tenants/me/service-requests/${id}`);
    return unwrap(response) as ServiceRequest & { tenant_service_request_events: ServiceRequestEvent[] };
  },
  createServiceRequest: async (data: { type: ServiceRequestType; category?: string; description?: string; photoUrl?: string }) => {
    const response = await api.post('/tenants/me/service-requests', data);
    return unwrap(response) as ServiceRequest;
  },
};
