import api from '@lib/api-client';
import { toAmendmentOutcome, type AmendmentOutcome } from '../profile/amendmentOutcome';

/**
 * Amending a tenant's agreement terms.
 *
 * Goes to the same `PUT /api/tenants/:id` every other tenant edit uses, so the
 * change-management facade still classifies and routes it — the frontend does
 * not decide whether a change needs tenant approval, and must not try to.
 *
 * Unlike `tenantService.update`, this keeps the HTTP status, because 200 and
 * 202 are how the backend distinguishes "applied" from "waiting on the
 * tenant" and the generic wrapper throws that away.
 *
 * `monthly_rent` is deliberately not amendable here. Rent has its own
 * endpoint (`POST /api/tenants/:id/change-rent`) which is identity-confirmed
 * and reprices unpaid obligations; routing rent through this path would both
 * contradict the documented owner-only rule and skip the repricing.
 */

export interface AgreementAmendment {
  agreement_duration_months?: number;
  agreement_start_date?: string;
  security_deposit?: number;
  maintenance_charge?: number;
  maintenance_type?: 'MONTHLY' | 'ONE_TIME' | 'NONE';
}

export const agreementAmendmentService = {
  submit: async (
    tenantId: string,
    changes: AgreementAmendment,
    reason: string,
    hostelId: string,
  ): Promise<AmendmentOutcome> => {
    const response = await api.put(`/tenants/${tenantId}`, { ...changes, reason, hostelId });
    const body = response.data?.data !== undefined ? response.data.data : response.data;
    return toAmendmentOutcome(response.status, body);
  },
};
