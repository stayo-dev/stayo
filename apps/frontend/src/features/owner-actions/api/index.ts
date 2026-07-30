import api from '@lib/api-client';

export interface OwnerActionSummary {
  actionId: string;
  entity: string;
  category: 'EDIT' | 'WORKFLOW' | 'CORRECTION' | 'VIEW';
  label: string;
  available: boolean;
}

const unwrap = (response: any) => {
  if (response.data?.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
};

export const ownerActionsService = {
  listForTenant: async (tenantId: string): Promise<OwnerActionSummary[]> => {
    const response = await api.get('/owner-actions', { params: { entity: 'tenant', tenantId } });
    return unwrap(response);
  },
};
