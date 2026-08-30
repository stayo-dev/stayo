import api from '@lib/api-client';

export interface CreatedHostel {
  id: string;
  name: string;
}

export type HostelTypeCode = 'BOYS' | 'GIRLS' | 'CO_LIVING' | 'WORKING_PROS';

export interface ProvisionHostelInput {
  name: string;
  type?: HostelTypeCode;
  address: string;
  city?: string;
  food_included: boolean;
  security_deposit: number;
  floors: number;
  rooms_per_floor: number;
  beds_per_room: number;
  base_rent: number;
  publish: 'now' | 'draft';
}

export interface ProvisionHostelResult {
  hostel: CreatedHostel;
  floors_created: number;
  rooms_created: number;
}

export const onboardingApi = {
  /**
   * Creates the hostel, its floors and all of its rooms in ONE request, which
   * the backend runs inside a single transaction.
   *
   * This replaces the old publish sequence — `createHostel` then one
   * `createFloor` per floor then one `createRoom` per room, i.e. 45 sequential
   * requests for a 4×10 property. A failure partway through that sequence left
   * a half-built hostel committed and every retry blocked by the duplicate-name
   * guard, stranding the owner on the wizard's last step.
   */
  provisionHostel: async (data: ProvisionHostelInput): Promise<ProvisionHostelResult> => {
    const response = await api.post('/owner/hostels/provision', data);
    return response.data as ProvisionHostelResult;
  },
};
