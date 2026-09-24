import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const tenantFinancialsService = {
  getReadModel: async () => {
    const response = await api.get('/tenants/me/financial-read-model');
    return unwrap(response);
  },
  getBillingTimeline: async () => {
    const response = await api.get('/tenants/me/billing-timeline');
    return unwrap(response);
  },
  getBillingFrequency: async () => {
    const response = await api.get('/tenants/me/billing-frequency');
    return unwrap(response);
  },
  requestBillingFrequencyChange: async (data: { requested_frequency: string; reason?: string }) => {
    const response = await api.post('/tenants/me/billing-frequency', data);
    return unwrap(response);
  },
  getPaymentHistory: async () => {
    const response = await api.get('/tenants/me/payments/history');
    return unwrap(response);
  },
  /**
   * A link to the tenant's own UPI payment page.
   *
   * Replaces `POST /payments/create-intent`, which is `410 GATEWAY_DISCONNECTED`
   * (ADR-235). The endpoint fills in the tenant id from the session and refuses
   * an obligation id from a tenant, so there is nothing to pass.
   */
  generatePayLink: async () => {
    const response = await api.post('/payments/pay-link', {});
    return unwrap(response);
  },
};
