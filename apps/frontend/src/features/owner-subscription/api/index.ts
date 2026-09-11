import api from '@lib/api-client';

/**
 * Owner subscription/billing endpoints (ADR-172, Phase 2/3 backend).
 *
 * This is the ONLY layer allowed to know these endpoint shapes
 * (scripts/check-architecture.mjs). Every value here is produced by the
 * backend — the frontend never computes a price, a proration amount, plan
 * eligibility, or capacity; it displays what the backend returns and submits
 * only the identifiers the existing APIs need. The session identifies the
 * owner; no ownerId is ever sent.
 */

const unwrap = (r: { data: any }) => r.data?.data ?? r.data;

export type SubscriptionStatus =
  | 'TRIAL'
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'PAUSED'
  | 'CANCELLED';

export type PaymentStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type PaymentMethod = 'UPI_MANUAL' | 'CASH';

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  price_paise: number;
  currency: string;
  billing_cycle: string;
  capacity_min: number | null;
  capacity_max: number | null; // null = unlimited (FOUNDING)
  /** Beds included at `price_paise`, no extra charge (business rules, 2026-09-10). */
  included_beds: number | null;
  /** Max PAID extra beds beyond `included_beds`. null = no ceiling (FOUNDING). 0 = not offered yet (Portfolio). */
  max_extra_beds: number | null;
  /** Paise per extra bed. null when extra beds aren't offered on this plan. */
  extra_bed_price_paise: number | null;
  is_public: boolean;
}

export interface SubscriptionUsage {
  plan_code: string | null;
  used: number;
  capacity_max: number | null; // null = unlimited
  available: number | null;
  at_limit: boolean;
}

export interface OwnerSubscription {
  id: string;
  status: SubscriptionStatus;
  plan: {
    id: string;
    code: string;
    name: string;
    price_paise: number;
    currency: string;
    capacity_max: number | null;
    included_beds: number | null;
    max_extra_beds: number | null;
    extra_bed_price_paise: number | null;
  } | null;
  /** Currently active PAID extra beds (business rules, 2026-09-10). 0 when none. */
  extra_beds: number;
  pending_plan: { id: string; code: string; name: string; price_paise: number } | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_renewal_at: string | null;
  started_at: string | null;
  cancelled_at: string | null;
}

export interface SubscriptionPayment {
  id: string;
  plan_id: string;
  amount_paise: number;
  extra_beds: number;
  currency: string;
  payment_method: string;
  transaction_reference: string | null;
  status: PaymentStatus;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface SubscriptionInvoice {
  id: string;
  invoice_number: string;
  plan_name: string | null;
  /** Total charged — plan_amount_paise + extra_bed_amount_paise + tax_paise. */
  amount_paise: number;
  /** The subscription's resulting extra-bed TOTAL after this invoice (business rules, 2026-09-10) — not the incremental delta bought this time. */
  extra_beds: number;
  /** Portion of amount_paise for the plan itself (Phase 6.6). */
  plan_amount_paise: number;
  /** Per-bed price snapshotted at invoice time. null when extra_beds is 0. */
  extra_bed_unit_price_paise: number | null;
  /** Portion of amount_paise actually charged for extra beds THIS invoice — priced on the incremental beds for a same-plan top-up. */
  extra_bed_amount_paise: number;
  tax_paise: number;
  currency: string;
  billing_period_start: string;
  billing_period_end: string;
  payment_method: string;
  issued_at: string;
  /** The PDF is fetched through `downloadInvoice(id)`; this only says whether it has been generated. */
  document_ready: boolean;
}

export interface SubscriptionOverview {
  subscription: OwnerSubscription;
  payments: SubscriptionPayment[];
  invoices: SubscriptionInvoice[];
  usage: SubscriptionUsage | null;
}

export interface PlansResponse {
  plans: PlanSummary[];
}

export interface PaymentContext {
  currency: string;
  methods: PaymentMethod[];
  payee: {
    upi_vpa: string | null;
    qr_image_url: string | null;
    account_name: string | null;
    note: string | null;
    bank: Record<string, unknown> | null;
  } | null;
  payee_configured: boolean;
}

export interface UpgradePreview {
  current_plan: { id: string; code: string; name: string; price_paise: number };
  target_plan: { id: string; code: string; name: string; price_paise: number };
  days_in_period: number;
  days_remaining: number;
  extra_beds: number;
  extra_bed_price_paise: number;
  amount_paise: number;
  currency: string;
  effective: string;
  next_renewal_price_paise: number;
}

export interface SubmitPaymentInput {
  plan_id: string;
  amount_paise: number;
  payment_method: PaymentMethod;
  transaction_reference?: string;
  proof_file_url?: string;
  /** Extra beds beyond the plan's included_beds — validated server-side. */
  extra_beds?: number;
}

export const ownerSubscriptionApi = {
  getOverview: async (): Promise<SubscriptionOverview> => {
    const r = await api.get('/owner/subscription');
    return unwrap(r) as SubscriptionOverview;
  },

  getPlans: async (): Promise<PlansResponse> => {
    const r = await api.get('/owner/subscription/plans');
    return unwrap(r) as PlansResponse;
  },

  getPaymentContext: async (): Promise<PaymentContext> => {
    const r = await api.get('/owner/subscription/payment-context');
    return unwrap(r) as PaymentContext;
  },

  getUpgradePreview: async (planId: string, extraBeds?: number): Promise<UpgradePreview> => {
    const r = await api.get('/owner/subscription/upgrade-preview', {
      params: { plan_id: planId, ...(extraBeds != null ? { extra_beds: extraBeds } : {}) },
    });
    return unwrap(r) as UpgradePreview;
  },

  /** Two-step: upload the proof, then submit the payment with the returned URL. */
  uploadProof: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('file', file);
    const r = await api.post('/owner/subscription/payments/proof', form);
    return unwrap(r) as { url: string };
  },

  submitPayment: async (input: SubmitPaymentInput): Promise<SubscriptionPayment> => {
    const r = await api.post('/owner/subscription/payments', {
      plan_id: input.plan_id,
      amount_paise: input.amount_paise,
      currency: 'INR',
      payment_method: input.payment_method,
      transaction_reference: input.transaction_reference,
      proof_file_url: input.proof_file_url,
      extra_beds: input.extra_beds,
    });
    return unwrap(r) as SubscriptionPayment;
  },

  /** Schedule a switch to a cheaper plan — effective next renewal, no payment now. */
  scheduleDowngrade: async (planId: string): Promise<{ current_plan: { name: string }; pending_plan: { name: string }; current_period_end: string | null }> => {
    const r = await api.post('/owner/subscription/downgrade', { plan_id: planId });
    return unwrap(r);
  },

  cancelDowngrade: async (): Promise<{ pending_plan: null }> => {
    const r = await api.delete('/owner/subscription/downgrade');
    return unwrap(r);
  },

  /**
   * Download one of the owner's own subscription invoices as a PDF. The backend
   * proxies the document and enforces `invoice.owner_id === session owner` — the
   * raw storage URL is never handed to the client.
   */
  downloadInvoice: async (invoiceId: string): Promise<{ blob: Blob; filename: string }> => {
    const r = await api.get(`/owner/subscription/invoices/${invoiceId}`, { responseType: 'blob' });
    const disposition = String(r.headers?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: r.data as Blob, filename: match?.[1] ?? `${invoiceId}.pdf` };
  },
};
