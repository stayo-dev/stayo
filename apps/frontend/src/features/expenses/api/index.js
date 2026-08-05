import api from '@lib/api-client';

export const expenseService = {
    getAll: async (hostelId, params = {}) => {
        const requestParams = { ...params };
        if (hostelId && hostelId !== 'all') requestParams.hostelId = hostelId;
        const response = await api.get('/expenses', { params: requestParams });
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    getSuggestions: async () => {
        const response = await api.get('/expenses', { params: { mode: 'suggestions' } });
        const data = response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
        return data?.frequent_expenses || [];
    },
    /**
     * Expense memory — the owner's own history shaped into defaults for their
     * next entry (ADR-047). Omit `q` to browse what they record most often.
     */
    getMemory: async (q, limit = 8, signal) => {
        const response = await api.get('/expenses', {
            params: { mode: 'memory', ...(q ? { q } : {}), limit },
            signal,
        });
        const data = response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
        return { entries: data?.entries ?? [], dueNow: data?.dueNow ?? [] };
    },
    getTitleSummary: async (title) => {
        const response = await api.get('/expenses', { params: { mode: 'title_summary', title } });
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    create: async (_hostelId, data) => {
        let payload = {
            ...data,
            expense_scope: 'BUSINESS',
        };
        // Remove hostelId from payload — expenses are portfolio-level
        delete payload.hostelId;

        if (data?.receipt_image instanceof File) {
            const { receipt_image, ...expenseData } = payload;
            const formData = new FormData();
            formData.append('expense_data', JSON.stringify(expenseData));
            formData.append('receipt_image', receipt_image);
            payload = formData;
        }
        const response = await api.post('/expenses', payload);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    update: async (id, data) => {
        const response = await api.put(`/expenses/${id}`, data);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    delete: async (id) => {
        const response = await api.delete(`/expenses/${id}`);
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    // Streams/generates a CSV/XLSX/PDF file server-side (GET /api/expenses/export, built on
    // the same filter builder the list query uses) and returns it as a Blob + filename.
    // Auth is Bearer-token-in-memory, so this must go through the authenticated axios
    // instance (blob response) rather than a plain <a href> browser navigation.
    export: async (params = {}) => {
        try {
            const response = await api.get('/expenses/export', { params, responseType: 'blob' });
            const disposition = response.headers?.['content-disposition'] || '';
            const match = disposition.match(/filename="?([^"]+)"?/i);
            const filename = match ? match[1] : `expenses-export.${params.format || 'csv'}`;
            return { blob: response.data, filename };
        } catch (error) {
            // With responseType: 'blob', axios doesn't auto-parse JSON error bodies —
            // an error response's `data` is a Blob, not the usual { error: { message } }.
            const blob = error?.response?.data;
            if (blob instanceof Blob && blob.type.includes('json')) {
                const text = await blob.text();
                try {
                    const parsed = JSON.parse(text);
                    throw new Error(parsed?.error?.message || parsed?.message || 'Export failed');
                } catch (parseError) {
                    if (parseError instanceof SyntaxError) throw error;
                    throw parseError;
                }
            }
            throw error;
        }
    },
};
