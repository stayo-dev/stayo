import { publicApi } from '@/infrastructure/api/client';

export interface VerificationDetails {
  id: string;
  receipt_number: string;
  amount: number;
  payment_method: string;
  transaction_id: string | null;
  issued_at: string;
  tenant_name: string;
  room_no: string | null;
  room_floor: number | null;
  hostel_name: string;
  outstanding_dues: number;
  future_credit: number;
}

export async function verifyReceipt(token: string): Promise<VerificationDetails> {
  const { data } = await publicApi.get<{ data: VerificationDetails }>(`/verify/receipt?token=${token}`);
  return data.data;
}
