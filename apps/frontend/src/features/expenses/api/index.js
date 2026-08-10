import api from '@lib/api-client';

export const expenseService = {
    getAll: async (hostelId, params = {}) => {
        const requestParams = { ...params };
        if (hostelId && hostelId !== 'all') requestParams.hostelId = hostelId;
        const response = await api.get('/expenses', { params: requestParams });
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
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
        return { entries: data?.entries ?? [], dueNow: data?.dueNow ?? [], titleVendors: data?.titleVendors ?? [] };
    },
    getTitleSummary: async (title, from, to) => {
        const response = await api.get('/expenses', {
            params: { mode: 'title_summary', title, ...(from ? { from } : {}), ...(to ? { to } : {}) },
        });
        return response.data.success !== undefined ? (response.data.data !== undefined ? response.data.data : response.data) : response.data;
    },
    /**
     * An expense belongs to a hostel unless the owner says otherwise.
     *
     * This previously deleted `hostelId` and forced `expense_scope:
     * 'BUSINESS'` on every create, which made per-property cost comparison
     * impossible — even though the schema defaults to HOSTEL, three
     * composite indexes exist for per-hostel querying, the export service
     * accepts a hostel filter, and most existing rows already carried a
     * hostel. See docs/audits/expenses-module-audit.md.
     */
    create: async (hostelId, data) => {
        const resolvedHostelId = data?.hostelId ?? hostelId ?? undefined;
        const payload0 = {
            ...data,
            ...(resolvedHostelId ? { hostelId: resolvedHostelId } : {}),
            expense_scope: data?.expense_scope ?? (resolvedHostelId ? 'HOSTEL' : 'BUSINESS'),
        };
        let payload = payload0;
        if (!resolvedHostelId) delete payload.hostelId;

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
