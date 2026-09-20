import api from '@lib/api-client';

/**
 * Generic owner-payment endpoints — one-off charges Stayo collects from an
 * owner that are NOT a subscription payment (see
 * `apps/backend/src/services/owner-billing/*`). Deliberately a separate
 * feature module from `features/owner-subscription/api` (different backend
 * routes, `/api/owner/payments*`, not `/api/owner/subscription*`) — this is
 * the ONLY layer allowed to know these endpoint shapes
 * (scripts/check-architecture.mjs). The owner never computes an amount or a
 * status; it only displays what the backend returns.
 */

const unwrap = (r: { data: any }) => r.data?.data ?? r.data;

export type OwnerPaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER';
export type OwnerPaymentStatus = 'RECORDED' | 'VOIDED';

export interface OwnerPaymentInvoiceSummary {
  id: string;
  invoice_number: string;
  amount_paise: number;
  issued_at: string;
}

export interface OwnerPayment {
  id: string;
  amount_paise: number;
  payment_method: OwnerPaymentMethod;
  description: string;
  status: OwnerPaymentStatus;
  created_at: string;
  invoice: OwnerPaymentInvoiceSummary | null;
}

export interface OwnerPaymentsResponse {
  payments: OwnerPayment[];
}

export const ownerPaymentsApi = {
  list: async (): Promise<OwnerPaymentsResponse> => {
    const r = await api.get('/owner/payments');
    return unwrap(r) as OwnerPaymentsResponse;
  },

  /**
   * Download one of the owner's own generic-payment invoices as a PDF. The
   * backend proxies the document and enforces `invoice.owner_id === session
   * owner` — the raw storage URL is never handed to the client.
   */
  downloadInvoice: async (invoiceId: string): Promise<{ blob: Blob; filename: string }> => {
    const r = await api.get(`/owner/payments/invoices/${invoiceId}`, { responseType: 'blob' });
    const disposition = String(r.headers?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: r.data as Blob, filename: match?.[1] ?? `${invoiceId}.pdf` };
  },
};
