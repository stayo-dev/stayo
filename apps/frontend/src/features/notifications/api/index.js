import api from '@lib/api-client';

export const notificationService = {
    // GET /notifications responds { success, data: [...] } (array body) —
    // unwrap it so callers get the list directly, not the envelope.
    getAll: async () => {
        const response = await api.get('/notifications');
        return response.data?.data ?? response.data;
    },
    markAsRead: async (id) => {
        const response = await api.post(`/notifications/${id}/read`);
        return response.data;
    }
};

export const reminderService = {
    sendToTenant: async (tenantId) => {
        const response = await api.post('/notifications/send-reminder', { tenant_id: tenantId });
        return response.data;
    },
    sendBulk: async (tenants) => {
        const results = await Promise.allSettled(
            tenants.map(id => api.post('/notifications/send-reminder', { tenant_id: id }).then(r => r.data))
        );
        const sent = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
        const noCredits = results.some(r => r.status === 'rejected' && (r.reason?.response?.data?.error?.code || r.reason?.response?.data?.code) === 'NO_REMINDERS_LEFT');
        if (noCredits) {
            const err = new Error('No reminder credits left');
            err.response = { data: { error: { code: 'NO_REMINDERS_LEFT' } } };
            throw err;
        }
        const failed = results.length - sent;
        return { sent, failed, total: results.length };
    },
};

export const sseService = {
    getToken: async () => {
        const response = await api.get('/events-token');
        return response.data.token;
    }
};
