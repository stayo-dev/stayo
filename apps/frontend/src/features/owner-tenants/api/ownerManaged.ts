import api from '@lib/api-client';

/**
 * "Keep records myself" — taking over a tenancy whose invitation was ignored.
 *
 * Deliberately not an "activate" call. The tenant did not register; the backend
 * records the owner's assertion as an attestation and leaves the invitation
 * superseded rather than cancelled, so the tenant can still claim the tenancy.
 */

export interface AdoptTenantInput {
  tenantId: string;
  hostelId: string;
  displayName?: string;
  note?: string;
}

export const ownerManagedService = {
  adopt: async (input: AdoptTenantInput) => {
    const response = await api.post(`/tenants/${input.tenantId}/adopt`, {
      hostel_id: input.hostelId,
      display_name: input.displayName,
      note: input.note,
    });
    return response.data;
  },
};
