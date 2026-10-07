import api from '@lib/api-client';
import type { ReceivedPayment, ReceivedSummary } from '../components/collections/received';

/**
 * Money → Collections → Received. The only layer that knows this endpoint's
 * shape. Every rupee figure here is the server's — the screen never adds up
 * the ledger itself.
 */
export type RentReceivedParams = {
  hostelId: string | null;
  from: string | null;
  to: string | null;
  method: string | null;
  q: string;
};

export type RentReceivedPage = {
  payments: ReceivedPayment[];
  summary: ReceivedSummary;
  hasMore: boolean;
};

export const rentReceivedService = {
  async list(params: RentReceivedParams, offset: number, limit = 20): Promise<RentReceivedPage> {
    const res = await api.get('/owner/rent-received', {
      params: {
        ...(params.hostelId ? { hostelId: params.hostelId } : {}),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        ...(params.method ? { method: params.method } : {}),
        ...(params.q.trim() ? { q: params.q.trim() } : {}),
        limit,
        offset,
      },
    });
    const body = res.data?.data ?? res.data;
    return {
      payments: body?.payments ?? [],
      summary: body?.summary ?? { count: 0, total: 0, reversedCount: 0 },
      hasMore: Boolean(body?.hasMore),
    };
  },
};
