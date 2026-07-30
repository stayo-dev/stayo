import api from '@lib/api-client';

/**
 * Thin wrapper around the Correction Case platform's `/api/recovery/cases/*`
 * endpoints. See `backend-next/src/services/recovery/types.ts` for the
 * canonical `CorrectionCase` shape this mirrors.
 */

const unwrap = (response: any) => {
  if (response.data?.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
};

export interface EntityRef {
  type: string;
  id: string;
}

export interface BalanceChange {
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

export interface ObligationChange {
  obligationId: string;
  before: unknown;
  after: unknown;
}

export interface LedgerEntryPreview {
  direction: 'DEBIT' | 'CREDIT';
  reason: string;
  amount: number;
  tenantId: string;
}

export interface ImpactReport {
  balanceChanges: BalanceChange[];
  obligationChanges: ObligationChange[];
  ledgerEntries: LedgerEntryPreview[];
  affectedReports: string[];
  notifications: unknown[];
  warnings: string[];
}

export interface CorrectionCase {
  id: string;
  hostelId: string;
  domain: string;
  caseType: string;
  tier: string;
  status: string;
  entityRefs: EntityRef[];
  reason: string;
  previewImpact: ImpactReport | null;
  executionResult: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateCaseParams {
  hostelId: string;
  caseType: string;
  reason: string;
  input: Record<string, unknown>;
}

export const recoveryService = {
  /**
   * Create a correction case and immediately preview it (the backend route
   * combines create+preview into one round trip). Returns the case with
   * `previewImpact` populated and `status: "PREVIEW"`.
   */
  createCase: async (params: CreateCaseParams): Promise<CorrectionCase> => {
    const response = await api.post('/recovery/cases', params);
    return unwrap(response);
  },

  /**
   * Run policy/dependency checks against a previewed case. Resolves with the
   * validated case on success; throws (422) if policy rejects the case.
   */
  validate: async (caseId: string): Promise<CorrectionCase> => {
    const response = await api.post(`/recovery/cases/${caseId}/validate`);
    return unwrap(response);
  },

  /**
   * Execute a validated case. Returns the execution result
   * (`{ reversalPaymentId, ledgerEntryId, obligationId, newSettlementStatus }`
   * for PAYMENT_REVERSAL cases).
   */
  execute: async (caseId: string): Promise<Record<string, unknown>> => {
    const response = await api.post(`/recovery/cases/${caseId}/execute`);
    return unwrap(response);
  },

  /**
   * Fetch a case by id (e.g. to read the final COMPLETED case object after
   * execute).
   */
  getById: async (caseId: string): Promise<CorrectionCase> => {
    const response = await api.get(`/recovery/cases/${caseId}`);
    return unwrap(response);
  },
};
