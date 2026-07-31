import api from '@lib/api-client';
import { ownerService } from '@features/owners/api';

export interface CreatedHostel {
  id: string;
  name: string;
}

export interface CreatedFloor {
  id: string;
  name: string;
}

export interface CreatedRoom {
  id: string;
  room_no: string;
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
  createHostel: async (data: { name: string; address: string; city?: string; state?: string; pincode?: string; phone?: string }): Promise<CreatedHostel> => {
    const result = await ownerService.createHostel(data);
    return result.hostel;
  },
  createFloor: async (data: { hostelId: string; name: string; sort_order?: number }): Promise<CreatedFloor> => {
    const response = await api.post('/floors', data);
    return response.data.data;
  },
  createRoom: async (data: { hostelId: string; room_no: string; capacity: number; floor_id?: string; room_type?: string; base_rent?: number }): Promise<CreatedRoom> => {
    const response = await api.post('/rooms', data);
    return response.data.data;
  },
};
