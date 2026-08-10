import api from '@lib/api-client';

export const ownerService = {
    getProfile: async () => {
        const response = await api.get('/owner/me/profile');
        return response.data;
    },
    updateOwner: async (data) => {
        const response = await api.patch('/owner/me/profile', data);
        return response.data;
    },
    updateProfileSection: async (data) => {
        const response = await api.patch('/profile', data);
        return response.data;
    },
    updateHostel: async (data, hostelId) => {
        if (hostelId) {
            const response = await api.patch(`/hostels/${hostelId}`, data);
            return response.data;
        }
        const response = await api.patch('/owner/me/hostel', data);
        return response.data;
    },
    updatePreferences: async (data, hostelId) => {
        if (hostelId) {
            const response = await api.patch(`/hostels/${hostelId}/preferences`, data);
            return response.data;
        }
        const response = await api.patch('/owner/me/preferences', data);
        return response.data;
    },
    getHostelPreferences: async (hostelId) => {
        const response = await api.get(`/hostels/${hostelId}/preferences`);
        return response.data;
    },
    getHostels: async (includeArchived = false) => {
        const response = await api.get('/owner/hostels', { params: { include_archived: includeArchived } });
        return response.data;
    },
    createHostel: async (data) => {
        const response = await api.post('/owner/hostels', data);
        return response.data;
    },
    /**
     * Persist the owner's manual Home ordering. `orderedIds` must be the full
     * ordered list of the owner's ACTIVE/INACTIVE hostels — the backend
     * rejects a partial list with 409 STALE_ORDER rather than best-effort
     * applying it. See ADR-042.
     */
    reorderHostels: async (orderedIds) => {
        const response = await api.patch('/owner/hostels/reorder', { order: orderedIds });
        return response.data;
    },
    getHostelBillingDefaults: async (hostelId) => {
        const response = await api.get(`/hostels/${hostelId}/billing-defaults`);
        return response.data;
    },
    updateHostelBillingDefaults: async (hostelId, billingDefaults) => {
        const response = await api.patch(`/hostels/${hostelId}/billing-defaults`, { billing_defaults: billingDefaults });
        return response.data;
    },
    uploadLogo: async (file, hostelId) => {
        const formData = new FormData();
        formData.append('file', file);
        const endpoint = hostelId ? `/hostels/${hostelId}/logo` : '/owner/logo';
        const response = await api.post(endpoint, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    },
    removeLogo: async (hostelId) => {
        const endpoint = hostelId ? `/hostels/${hostelId}/logo` : '/owner/logo';
        const response = await api.delete(endpoint);
        return response.data;
    },
    archiveHostel: async (hostelId, reason) => {
        const response = await api.delete(`/hostels/${hostelId}`, { data: { reason } });
        return response.data;
    },
    reactivateHostel: async (hostelId) => {
        const response = await api.patch(`/hostels/${hostelId}`, { status: 'ACTIVE' });
        return response.data;
    },
    /**
     * Universal owner search — tenants, hostels and rooms, grouped and ranked
     * server-side. Replaces the old tenants-only `searchTenants`, which was
     * wired to this same path but never called from anywhere. See ADR-044.
     */
    universalSearch: async (query, limit = 8, signal) => {
        const response = await api.get('/owner/search', {
            params: { q: query, limit },
            signal
        });
        return response.data;
    },
    /**
     * Today's rent-collection work queue — grouped, prioritised and
     * explainable, built server-side. `hostelId` optional (portfolio-wide by
     * default). See ADR-045.
     */
    collectionQueue: async (hostelId, signal) => {
        const response = await api.get('/owner/collection-queue', {
            params: hostelId ? { hostelId } : {},
            signal
        });
        return response.data;
    },
    sendTestReminder: async (type = 'DUE_SOON', hostelId) => {
        const response = await api.post('/notifications/test-reminder', { type, hostel_id: hostelId });
        return response.data;
    },
    generateWhatsAppLinkCode: async () => {
        const response = await api.post('/owner/whatsapp/link-code');
        return response.data?.data ?? response.data;
    },
    getWhatsAppConnections: async () => {
        const response = await api.get('/owner/whatsapp/connections');
        return response.data?.data ?? response.data;
    },
    disconnectWhatsAppConnection: async (connectionId) => {
        const response = await api.delete(`/owner/whatsapp/connections/${connectionId}`);
        return response.data?.data ?? response.data;
    },
    updateSectionConfig: async (hostelId, section, data) => {
        const response = await api.patch(`/hostels/${hostelId}/${section}`, data);
        return response.data;
    },
    updateHostelPolicy: async (hostelId, policyPatch) => {
        const response = await api.patch(`/hostels/${hostelId}/preferences`, { policy: policyPatch });
        return response.data;
    },
    getFrequencyChangeRequests: async (params = {}) => {
        const response = await api.get('/owner/billing/frequency-requests', { params });
        return response.data?.data ?? response.data;
    },
    decideFrequencyChangeRequest: async (requestId, action, rejection_reason = '') => {
        const response = await api.post(`/owner/billing/frequency-requests/${requestId}/decision`, { action, rejection_reason });
        return response.data?.data ?? response.data;
    },
    changeFrequency: async (tenantId, { requested_frequency, reason, identityToken }) => {
        const response = await api.post(`/tenants/${tenantId}/change-frequency`, { requested_frequency, reason, identityToken });
        return response.data?.data ?? response.data;
    },
    setCustomInstallments: async (tenantId, { installments, reason, identityToken }) => {
        const response = await api.post(`/tenants/${tenantId}/change-frequency/custom`, { installments, reason, identityToken });
        return response.data?.data ?? response.data;
    },
    getAgreementTemplate: async (hostelId, type = "RESIDENCY") => {
        const response = await api.get(`/owner/hostels/${hostelId}/agreement-template`, { params: { type } });
        return response.data;
    },
    updateAgreementTemplate: async (hostelId, data) => {
        const response = await api.post(`/owner/hostels/${hostelId}/agreement-template`, data);
        return response.data;
    },
    uploadOwnerSignatureStamp: async (hostelId, file) => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await api.post(`/owner/hostels/${hostelId}/agreement-template/signature`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    },
    getAgreementTemplatePreview: async (hostelId, data) => {
        const response = await api.post(`/owner/hostels/${hostelId}/agreement-template/preview`, data, {
            responseType: 'blob'
        });
        return response.data;
    }
};

export const bulkImportService = {
    generateGoogleFormPrompt: async ({ hostelId, notes }) => {
        const response = await api.post('/bulk-import/google-form-prompt', {
            hostel_id: hostelId,
            notes,
        });
        return response.data;
    },
    uploadTenantIdentityFile: async (formData) => {
        const response = await api.post('/bulk-import/upload', formData);
        return response.data;
    },
    getBatchPreview: async (batchId) => {
        const response = await api.get(`/bulk-import/${batchId}/confirm`);
        return response.data;
    },
    revalidateRows: async (data) => {
        const response = await api.post('/bulk-import/revalidate', data);
        return response.data;
    },
    getBatchStatus: async (batchId) => {
        const response = await api.get(`/bulk-import/${batchId}`);
        return response.data;
    },
    confirmBatchImport: async (batchId) => {
        const response = await api.post(`/bulk-import/${batchId}/confirm`);
        return response.data;
    },
    confirmInvitationBatch: async (batchId, options = {}) => {
        const response = await api.post(`/bulk-import/${batchId}/confirm`, options);
        return response.data;
    },
    downloadTemplate: async () => {
        const response = await api.get('/bulk-import/template', { responseType: 'blob' });
        return response.data;
    },
};

export const activationService = {
    get: async () => {
        const response = await api.get('/owner/me/activation');
        return response.data;
    },
    persistStep: async (step, options = {}) => {
        const response = await api.patch('/owner/me/activation', { step, ...options });
        return response.data;
    },
};
