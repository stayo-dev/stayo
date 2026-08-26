import api from '@lib/api-client';

/**
 * Moving a tenant to a room in a **different** hostel.
 *
 * `POST /api/tenants/transfer` is, per its service's own comment, "the ONLY
 * sanctioned way to move a tenant between hostels" — direct allocation
 * manipulation would leave `tenants.hostel_id` pointing at the old property and
 * write no audit row. It closes the old allocation, opens the new one, updates
 * the tenant's hostel and records a `tenant_transfer_logs` entry, atomically.
 *
 * It refuses a same-hostel move by design; that is `allocationService.shift`.
 * `planRoomMove` decides which of the two applies.
 */

export interface TransferTenantInput {
  tenantId: string;
  targetRoomId: string;
  reason?: string;
  notes?: string;
}

export const tenantTransferService = {
  transfer: async (input: TransferTenantInput) => {
    const response = await api.post('/tenants/transfer', input);
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
};
