import api from '@lib/api-client';

const unwrap = (response) => {
    if (response.data?.success !== undefined) {
        return response.data.data !== undefined ? response.data.data : response.data;
    }
    return response.data;
};

export const tenantService = {
    getAll: async (hostelId, params = {}) => {
        const response = await api.get('/tenants', { params: { ...params, hostelId } });
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getById: async (id) => {
        const response = await api.get(`/tenants/${id}`);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getOwnerTenantOverview: async (id) => {
        const response = await api.get(`/tenants/owner/tenants/${id}/overview`);
        return unwrap(response);
    },
    getFull: async (id) => {
        const response = await api.get(`/tenants/${id}/full`);
        return unwrap(response);
    },
    getDocuments: async (tenantId) => {
        try {
            const response = await api.get(`/tenants/${tenantId}/documents`);
            const data = unwrap(response);
            return data?.documents ?? (Array.isArray(data) ? data : []);
        } catch {
            const full = await tenantService.getFull(tenantId);
            return full?.identification_documents ?? full?.documents ?? [];
        }
    },
    verifyDocument: async (tenantId, docId) => {
        const response = await api.patch(`/tenants/${tenantId}/documents/${docId}/verify`);
        return unwrap(response);
    },
    verifyAllDocuments: async (tenantId) => {
        const response = await api.patch(`/tenants/${tenantId}/documents/bulk-verify`);
        return unwrap(response);
    },
    rejectDocument: async (tenantId, docId, reason) => {
        const response = await api.patch(`/tenants/${tenantId}/documents/${docId}/reject`, { reason });
        return unwrap(response);
    },
    postDocumentMessage: async (tenantId, docId, message) => {
        const response = await api.post(`/tenants/${tenantId}/documents/${docId}/message`, { message });
        return unwrap(response);
    },
    activate: async (token) => {
        const response = await api.get('/tenants/activate', { params: { token } });
        return unwrap(response);
    },
    getActivationContext: async (token) => {
        const response = await api.get('/tenants/activate/context', { params: { token } });
        return unwrap(response);
    },
    updateActivationWorkflow: async ({ token, step, data }) => {
        const response = await api.patch('/tenants/activate', { token, step, data });
        return unwrap(response);
    },
    sendPhoneOtp: async ({ phone, purpose }) => {
        const response = await api.post('/auth/send-phone-otp', { phone, purpose });
        return unwrap(response);
    },
    verifyPhoneOtp: async ({ phone, otp, purpose }) => {
        const response = await api.post('/auth/verify-phone-otp', { phone, otp, purpose });
        return unwrap(response);
    },
    uploadActivationPhoto: async (token, file) => {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        const response = await api.post('/tenants/activate/photo', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return unwrap(response);
    },
    activateAccount: async (data) => {
        const response = await api.post('/tenants/activate', data);
        return unwrap(response);
    },
    getByProfileId: async (profileId) => {
        const response = await api.get(`/tenants/by-profile/${profileId}`);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getMyProfile: async () => {
        const response = await api.get('/tenants/me/profile');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    updateMyProfile: async (data) => {
        const response = await api.patch('/tenants/me/profile', data);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    completeMyProfile: async (data, profilePhotoFile = null) => {
        const formData = new FormData();
        formData.append('profile_data', JSON.stringify(data));
        if (profilePhotoFile) formData.append('profile_photo', profilePhotoFile);
        try {
            const response = await api.post('/tenants/me/complete-profile', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
        } catch (error) {
            if (error?.response?.status === 404) {
                const fallback = await api.post('/profiles/complete', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                return fallback.data;
            }
            throw error;
        }
    },
    getMyDocuments: async () => {
        const response = await api.get('/tenants/me/documents');
        return response.data?.documents || response.data || [];
    },
    getMyPaymentHistory: async () => {
        const response = await api.get('/tenants/me/payments/history');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getMyRoom: async () => {
        const response = await api.get('/tenants/me/room');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getMyOnboardingSettings: async () => {
        const response = await api.get('/tenants/me/onboarding-settings');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getMyScore: async () => {
        const response = await api.get('/tenants/me/score');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    /**
     * Where an invited tenant is stuck, for the owner. Read-only — the
     * backend reuses the same `computeState()` the tenant's own activation
     * wizard runs on, without `getContext()`'s side effects.
     */
    getActivationState: async (tenantId) => {
        const response = await api.get(`/tenants/${tenantId}/activation-state`);
        const data = response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
        return data?.activation_state ?? data;
    },
    getTenantScore: async (tenantId) => {
        const response = await api.get(`/tenants/${tenantId}/score`);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getMyFinancialLedger: async () => {
        const response = await api.get('/tenants/me/financial-ledger');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getMyBillingFrequency: async () => {
        const response = await api.get('/tenants/me/billing-frequency');
        return unwrap(response);
    },
    requestBillingFrequencyChange: async (data) => {
        const response = await api.post('/tenants/me/billing-frequency', data);
        return unwrap(response);
    },
    getMyBillingTimeline: async () => {
        const response = await api.get('/tenants/me/billing-timeline');
        return unwrap(response);
    },
    getTenantBillingTimeline: async (tenantId) => {
        const response = await api.get(`/tenants/${tenantId}/billing-timeline`);
        return unwrap(response);
    },
    create: async (data) => {
        const response = await api.post('/tenants', data);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    update: async (id, data) => {
        const response = await api.put(`/tenants/${id}`, data);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    delete: async (id) => {
        const response = await api.delete(`/tenants/${id}`);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    reactivate: async (id, data) => {
        const response = await api.post(`/tenants/${id}/reactivate`, data);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    requestReactivation: async () => {
        const response = await api.post('/tenants/me/reactivation-request');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getReactivationRequests: async () => {
        const response = await api.get('/tenants/owner/reactivation-requests');
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    decideReactivationRequest: async (requestId, action, notes = '') => {
        const response = await api.post(`/tenants/owner/reactivation-requests/${requestId}/decision`, { action, notes });
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    invite: async (data) => {
        const response = await api.post('/owners/invitations', data);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    /**
     * Read-only pre-submit tenancy-eligibility check — same rule and OWN/OTHER
     * disclosure scoping as the 409 `invite()` can return, offered before the
     * owner fills out the rest of the form. Never creates or mutates anything.
     */
    checkEligibility: async (phone, email) => {
        const response = await api.get('/owners/invitations/eligibility', {
            params: { phone, ...(email ? { email } : {}) },
        });
        return unwrap(response);
    },
    /**
     * Read-only. "This tenant already lives here and has already paid me some
     * of it — what exactly will you record?", answered by the same backend
     * module that does the recording, so the wizard never does money
     * arithmetic of its own. Creates nothing. See ADR-141.
     */
    previewInviteSettlement: async (payload) => {
        const response = await api.post('/owners/invitations/settlement-preview', payload);
        return unwrap(response);
    },
    resendInvitation: async (identifier, overrides = {}) => {
        const body = {
            identifier,
            ...overrides
        };
        const response = await api.post('/tenants/resend-invitation', body);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    cancelInvitation: async (id) => {
        const response = await api.post(`/tenants/${id}/cancel-invitation`);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    runComplianceAction: async (id, action) => {
        const response = await api.post(`/tenants/${id}/compliance-action`, { action });
        return unwrap(response);
    },
    getFinancialLedger: async (tenantId) => {
        const response = await api.get(`/tenants/${tenantId}/financial-ledger`);
        return unwrap(response);
    },
    getFinancialTimeline: async (tenantId, hostelId) => {
        const response = await api.get(`/tenants/${tenantId}/financial-timeline`, {
            params: hostelId ? { hostelId } : {},
        });
        return unwrap(response);
    },
    getPendingDocuments: async (hostelId = '') => {
        const response = await api.get('/tenants/pending-documents', { params: { hostelId } });
        return unwrap(response);
    },
    uploadActivationSignature: async (token, file, type = 'tenant') => {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        formData.append('type', type);
        const response = await api.post('/tenants/activate/signature', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return unwrap(response);
    },
    exportMasterCsv: async ({ hostelId } = {}) => {
        const response = await api.get('/tenants/export', {
            params: hostelId ? { hostelId } : {},
            responseType: 'blob',
        });
        return response.data;
    },
    getNotes: async (tenantId) => {
        const response = await api.get(`/tenants/${tenantId}/notes`);
        return unwrap(response);
    },
    addNote: async (tenantId, content) => {
        const response = await api.post(`/tenants/${tenantId}/notes`, { content });
        return unwrap(response);
    },
    deleteNote: async (tenantId, noteId) => {
        const response = await api.delete(`/tenants/${tenantId}/notes`, { params: { noteId } });
        return unwrap(response);
    },
    changeRent: async (tenantId, { hostelId, newRentAmount, effectiveFromMonth, reason, identityToken }) => {
        const response = await api.post(`/tenants/${tenantId}/change-rent`, {
            hostelId, newRentAmount, effectiveFromMonth, reason, identityToken,
        });
        return unwrap(response);
    },
};
