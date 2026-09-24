import api from '@lib/api-client';
import type { PaymentClaim } from '../components/collections/paymentClaims';

/**
 * Tenant UPI payment claims. The only layer that knows these endpoint shapes.
 *
 * With the gateway disconnected this is the whole reconciliation path: nothing
 * enters the ledger until an owner confirms a claim here (ADR-235).
 */
export const paymentClaimsService = {
  async list(params: { state?: string; hostelId?: string | null }): Promise<PaymentClaim[]> {
    const res = await api.get('/owner/payment-claims', {
      params: {
        state: params.state ?? 'PENDING',
        ...(params.hostelId ? { hostelId: params.hostelId } : {}),
      },
    });
    const body = res.data;
    return (body?.claims ?? body?.data?.claims ?? []) as PaymentClaim[];
  },

  /** Records the rent, through the same settlement path as any other payment. */
  async confirm(claimId: string) {
    const res = await api.post(`/owner/payment-claims/${claimId}`, { action: 'confirm' });
    return res.data;
  },

  /** Closes the claim. The obligation is never touched. */
  async reject(claimId: string, reason?: string) {
    const res = await api.post(`/owner/payment-claims/${claimId}`, { action: 'reject', reason });
    return res.data;
  },
};
