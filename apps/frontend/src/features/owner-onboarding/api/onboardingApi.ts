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
  // `verification_required: false` means WhatsApp could not deliver a code and
  // the backend has already recorded the number as unverified — the caller
  // must skip its OTP step rather than wait for a code that will never arrive.
  sendPhoneOtp: async (phone: string) => {
    const response = await api.post('/auth/send-phone-otp', { phone });
    return response.data as {
      success: boolean;
      verification_required: boolean;
      expires_in_seconds?: number;
      reason?: string;
    };
  },
  verifyPhoneOtp: async (phone: string, otp: string) => {
    const response = await api.post('/auth/verify-phone-otp', { phone, otp });
    return response.data as { success: boolean; phone_verified: boolean };
  },
  ownerSignup: async (data: { name: string; email: string; password: string; phone: string; lead_token?: string }) => {
    const response = await api.post('/auth/owner-signup', data);
    return response.data;
  },
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
