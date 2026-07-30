import api from '@lib/api-client';

export const analyticsService = {
    getCashflow: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to)   params.to   = to;
        const response = await api.get('/dashboard/cashflow', { params });
        return response.data;
    },
    getTenants: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to)   params.to   = to;
        const response = await api.get('/dashboard/tenants', { params });
        return response.data;
    },
    getFunnel: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to)   params.to   = to;
        const response = await api.get('/dashboard/funnel', { params });
        return response.data;
    },
    getOperations: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to)   params.to   = to;
        const response = await api.get('/dashboard/operations', { params });
        return response.data;
    },
};

export const activityService = {
    getAll: async (hostelId, params = {}) => {
        const response = await api.get('/activity', { params: { ...params, hostelId } });
        return response.data;
    }
};
