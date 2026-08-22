import api from '@lib/api-client';
import type { PayoutSummary } from '@features/owner-money/payouts/payoutState';

/**
 * The owner's view of money Stayo is holding for them.
 *
 * The only layer that knows these endpoint shapes, per the architecture rule.
 * Note there is no `ownerId` parameter anywhere here: the backend takes it from
 * the session, and offering one would invite a caller to pass the wrong owner's.
 */

const unwrap = (response: any) => {
  if (response.data?.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
};

export type OwnerPayout = {
  id: string;
  amount: number;
  status: string;
  expectedPayoutDate: string | null;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  failureReason: string | null;
  paymentCount: number;
};

export type OwnerPayoutBreakdown = {
  payout: OwnerPayout;
  /** Always 0. Stayo passes rent through in full and says so, every time. */
  fee: 0;
  collected: number;
  tenants: {
    tenantId: string | null;
    name: string;
    room: string;
    hostelId: string | null;
    hostelName: string;
    amount: number;
    capturedAt: string;
  }[];
  byHostel: { hostelId: string; hostelName: string; amount: number }[];
  bank: { name: string | null; masked: string | null } | null;
};

export const ownerPayoutService = {
  /** Facts for the Money tab's strip — the screen picks the sentence. */
  async getSummary(): Promise<PayoutSummary> {
    return unwrap(await api.get('/owner/payouts/summary'));
  },

  /** Payout history. `q` matches a UTR, an amount, a method, or a tenant name. */
  async list(q?: string): Promise<OwnerPayout[]> {
    const res = unwrap(await api.get('/owner/payouts', { params: q ? { q } : undefined }));
    return res?.payouts ?? [];
  },

  /** Which tenants make up one payout — fetched lazily, when a row is opened. */
  async getBreakdown(itemId: string): Promise<OwnerPayoutBreakdown> {
    return unwrap(await api.get(`/owner/payouts/${itemId}`));
  },
};
