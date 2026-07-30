import api from '@lib/api-client';

const unwrap = (response) => {
    if (response.data && response.data.success === true && response.data.data !== undefined) {
        return response.data.data;
    }
    return response.data;
};

export const paymentService = {
    getAll: async (hostelId, params = {}) => {
        const response = await api.get('/payments', { params: { ...params, hostelId } });
        return unwrap(response);
    },
    getAllDues: async (hostelId, params = {}) => {
        const response = await api.get('/payments/dues', { params: { ...params, hostelId } });
        return unwrap(response);
    },
    getTenantDues: async (tenantId, hostelId) => {
        const response = await api.get('/payments/tenant-dues', { params: { tenant_id: tenantId, hostelId } });
        return unwrap(response);
    },
    payDues: async (data) => {
        const response = await api.post('/payments/pay-dues', data);
        return unwrap(response);
    },
    getTenantHistory: async (tenantId, hostelId) => {
        try {
            // No tenantId -> self-service tenant fetching their own history
            // (handled by the fallback at the bottom of this try block).
            // tenantId given -> an owner fetching a specific tenant's
            // ledger. This used to also branch on ownerUser/tenantUser
            // localStorage (removed, ADR-031) to short-circuit the
            // self-service case slightly earlier — that branch had gone
            // stale (always false) and this function has no live caller
            // today, so it never actually misbehaved in production; fixed
            // in passing since the fallback path already covers the same
            // case correctly.
            if (tenantId) {
                // Owner fetches a tenant-scoped ledger from payments service
                const [dues, paymentsResult] = await Promise.all([
                    api.get('/payments/dues', { params: { tenant_id: tenantId, hostelId } }),
                    api.get('/payments', { params: { tenant_id: tenantId, limit: 500, hostelId } })
                ]);

                const obligations = (dues.data || []).filter((o) => o.tenant_id === tenantId);
                const payments = (paymentsResult.data?.payments || []).map((p) => ({
                    id: p.id,
                    obligation_id: p.obligation_id,
                    amount_paid: Number(p.amount_paid || 0),
                    payment_date: p.payment_date,
                    payment_method: p.payment_method,
                    reference_number: p.reference_number,
                    transaction_id: p.reference_number || p.id,
                    rent_month: p.rent_month
                }));

                const totalDue = obligations.reduce((sum, o) => sum + Number(o.amount || 0), 0);
                const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);

                return {
                    tenant_id: tenantId,
                    obligations: obligations.map((o) => ({
                        id: o.obligation_id || o.id,
                        rent_month: o.rent_month,
                        due_date: o.due_date,
                        amount: Number(o.amount || 0),
                        status: o.status,
                        remaining_due: Number(o.outstanding || 0),
                        payments: payments
                            .filter((p) => p.obligation_id === (o.obligation_id || o.id))
                            .map((p) => ({
                                id: p.id,
                                amount_paid: Number(p.amount_paid || 0),
                                payment_date: p.payment_date,
                                method: p.payment_method,
                                transaction_id: p.transaction_id
                            }))
                    })),
                    payments: payments.sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()),
                    total_due: totalDue,
                    total_paid: totalPaid,
                    outstanding_balance: Math.max(totalDue - totalPaid, 0)
                };
            }

            const fallbackMe = await api.get('/tenants/me/payments/history');
            return unwrap(fallbackMe);
        } catch (error) {
            if (error?.response?.status === 404) {
                const fallback = await api.get('/tenants/me/payments/history');
                return unwrap(fallback);
            }
            throw error;
        }
    },
    recordPayment: async (data) => {
        const response = await api.post('/payments/record-offline', data);
        return unwrap(response);
    },
    recordOfflinePayment: async ({ identityToken, obligationId, amountPaid, paymentMethod, referenceNumber, paymentDate, note, hostelId }) => {
        const response = await api.post('/payments/record-offline', {
            identity_token: identityToken,
            obligation_id: obligationId,
            amount_paid: amountPaid,
            payment_method: paymentMethod,
            reference_number: referenceNumber,
            payment_date: paymentDate,
            note,
            hostelId,
        });
        return unwrap(response);
    },
    initiatePayment: async (data) => {
        const response = await api.post('/payments/initiate', data);
        return unwrap(response);
    },
    verifyPayment: async (data) => {
        const response = await api.post('/payments/verify', data);
        return unwrap(response);
    },
    reconcilePayments: async (paymentIds, hostelId, paymentDomain) => {
        const body = paymentIds ? { payment_ids: paymentIds } : {};
        if (hostelId) body.hostelId = hostelId;
        if (paymentDomain) body.paymentDomain = paymentDomain;
        const response = await api.post('/payments/reconcile', body);
        return unwrap(response);
    },
    createIntent: async (data) => {
        const response = await api.post('/payments/create-intent', data);
        return unwrap(response);
    },
    createTestIntent: async (data) => {
        const response = await api.post('/payments/test-intent', data);
        return response.data;
    },
    getAttempt: async (attemptId) => {
        const response = await api.get(`/payments/attempts/${attemptId}`);
        return unwrap(response);
    },
    submitUpiReference: async (data) => {
        const response = await api.post('/payments/submit-reference', data);
        return unwrap(response);
    },
    confirmPayment: async (attemptId) => {
        const response = await api.post('/payments/confirm', { attempt_id: attemptId, action: 'confirm' });
        return unwrap(response);
    },
    rejectPayment: async (attemptId) => {
        const response = await api.post('/payments/confirm', { attempt_id: attemptId, action: 'reject' });
        return unwrap(response);
    },
    getPendingVerifications: async (hostelId) => {
        const response = await api.get('/payments/pending-verification', { params: { hostelId } });
        return unwrap(response);
    },
    manualConfirmPayment: async (attemptId) => {
        const response = await api.post('/payments/manual-confirm', { attempt_id: attemptId });
        return unwrap(response);
    },
    generateRent: async (hostelId, month) => {
        const response = await api.post('/rent/generate', { month, hostelId });
        return unwrap(response);
    },
    previewGenerateRent: async (hostelId, month) => {
        const response = await api.get('/rent/generate', { params: { month, hostelId } });
        return unwrap(response);
    },
    waive: async (obligationId, reason) => {
        const response = await api.post(`/payments/obligations/${obligationId}/waive`, { reason });
        return unwrap(response);
    },
    getDetail: async (obligationId, hostelId) => {
        const response = await api.get(`/payments/${obligationId}`, { params: { hostelId } });
        return response.data?.data ?? response.data;
    },
    getObligationHistory: async (obligationId) => {
        const response = await api.get(`/payments/obligations/${obligationId}/history`);
        return unwrap(response);
    },
    downloadReceipt: async (paymentId) => {
        const response = await api.get(`/payments/${paymentId}/receipt`, {
            responseType: 'blob'
        });

        const blob = response.data;
        if (blob.type && blob.type.includes('application/json')) {
            const text = await blob.text();
            let detail = 'Unknown error';
            try {
                const parsed = JSON.parse(text);
                detail = parsed?.error?.message || parsed?.detail || parsed?.error || text;
            } catch {
                detail = text;
            }
            const err = new Error(detail);
            err.response = { status: response.status, data: { detail } };
            throw err;
        }

        return blob;
    },
    downloadInvoice: async (paymentId) => {
        const response = await api.get(`/invoices/${paymentId}`);
        if (response.data && response.data.success === true) {
            if (response.data.data && response.data.data.url) {
                window.open(response.data.data.url, '_blank');
            }
        } else if (response.data && response.data.url) {
            window.open(response.data.url, '_blank');
        }
        return true;
    },
    exportReport: async (params = {}) => {
        const response = await api.get('/payments/export', {
            params,
            responseType: 'blob'
        });
        return {
            blob: response.data,
            contentDisposition: response.headers?.['content-disposition'] || ''
        };
    },
    bulkGenerate: async (data) => {
        const response = await api.post('/payments/bulk-generate', data);
        return unwrap(response);
    },
    previewPayment: async (obligationIds, hostelId) => {
        const response = await api.get('/payments/preview', { 
            params: { ids: obligationIds.join(','), ...(hostelId ? { hostelId } : {}) }
        });
        return unwrap(response);
    },
    /**
     * V2: Settlement Preview — dry-run showing where money would be allocated.
     * Used by both Owner (RecordPaymentModal) and Tenant (custom payment) UIs.
     */
    settlementPreview: async (tenantId, amount, hostelId, allowedObligationIds) => {
        const response = await api.get('/payments/settlement-preview', {
            params: {
                tenant_id: tenantId,
                amount,
                ...(hostelId ? { hostelId } : {}),
                ...(allowedObligationIds ? { allowed_obligation_ids: allowedObligationIds.join(',') } : {})
            }
        });
        return unwrap(response);
    },
    /**
     * V2: Unified tenant-level payment recording (no obligation_id required).
     * Settlement engine auto-allocates across all outstanding obligations.
     */
    recordTenantPayment: async ({ identityToken, tenantId, amountPaid, paymentMethod, referenceNumber, paymentDate, note, hostelId, idempotencyKey, allowedObligationIds }) => {
        const response = await api.post('/payments/record-offline', {
            identity_token: identityToken,
            tenant_id: tenantId,
            amount_paid: amountPaid,
            payment_method: paymentMethod,
            reference_number: referenceNumber,
            payment_date: paymentDate,
            note,
            hostelId,
            idempotency_key: idempotencyKey,
            allowed_obligation_ids: allowedObligationIds,
        });
        return unwrap(response);
    },
    quickCollectSearch: async (search) => {
        const response = await api.get('/payments/quick-collect/search', {
            params: { search }
        });
        return unwrap(response);
    },
    generatePayLink: async ({ tenantId, obligationId }) => {
        const response = await api.post('/payments/pay-link', { tenantId, obligationId });
        return unwrap(response);
    }
};

export const rentService = {
    preview: async (hostelId, month) => {
        const params = { ...(month ? { month } : {}), hostelId };
        const response = await api.get('/rent/generate', { params });
        return unwrap(response);
    },
    generate: async (hostelId, month) => {
        const response = await api.post('/rent/generate', { ...(month ? { month } : {}), hostelId });
        return unwrap(response);
    }
};
