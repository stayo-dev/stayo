import api, { requestWithRetry } from '@lib/api-client';

export const dashboardService = {
    getUnified: async (hostelId, months = 6) => {
        const response = await api.get('/dashboard', { params: { months, hostelId } });
        return response.data;
    },
    getSummary: async (hostelId) => {
        const response = await requestWithRetry(() => api.get('/dashboard/summary', { params: { hostelId } }));
        return response.data;
    },
    getStats: async (hostelId) => {
        const response = await requestWithRetry(() => api.get('/dashboard/stats', { params: { hostelId } }));
        return response.data;
    },
    getStatsShell: async (hostelId) => {
        const response = await requestWithRetry(() => api.get('/dashboard/stats-shell', { params: { hostelId } }));
        return response.data?.data ?? response.data;
    },
    getStatsActivity: async (hostelId) => {
        const response = await requestWithRetry(() => api.get('/dashboard/stats-activity', { params: { hostelId } }));
        return response.data?.data ?? response.data;
    },
    getStatsAnalytics: async (hostelId) => {
        const response = await requestWithRetry(() => api.get('/dashboard/stats-analytics', { params: { hostelId } }));
        return response.data?.data ?? response.data;
    },
    getMonthlyStats: async (hostelId, months = 6) => {
        const response = await requestWithRetry(() => api.get('/dashboard/monthly-stats', { params: { months, hostelId } }));
        return response.data;
    },
    getCashflow: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to) params.to = to;
        const response = await requestWithRetry(() => api.get('/dashboard/cashflow', { params }));
        return response.data?.data ?? response.data;
    },
    getFunnel: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to) params.to = to;
        const response = await requestWithRetry(() => api.get('/dashboard/funnel', { params }));
        return response.data?.data ?? response.data;
    },
    getOperations: async (hostelId, from, to) => {
        const params = { hostelId };
        if (from) params.from = from;
        if (to) params.to = to;
        const response = await requestWithRetry(() => api.get('/dashboard/operations', { params }));
        return response.data?.data ?? response.data;
    },
};

export const portfolioService = {
    getSummary: async () => {
        const response = await requestWithRetry(() => api.get('/owner/portfolio/summary'));
        return response.data?.data ?? response.data;
    },
    getShell: async (months = 6) => {
        const response = await requestWithRetry(() =>
            api.get('/dashboard/portfolio-shell', { params: { months } })
        );
        return response.data?.data ?? response.data;
    },
    getPerformance: async (months = 6) => {
        const response = await requestWithRetry(() =>
            api.get('/dashboard/portfolio-performance', { params: { months } })
        );
        return response.data?.data ?? response.data;
    },
};
