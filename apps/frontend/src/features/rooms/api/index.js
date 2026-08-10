import api from '@lib/api-client';

export const floorService = {
    getAll: async (hostelId) => {
        const response = await api.get('/floors', { params: { hostelId } });
        return response.data.success ? response.data.data : response.data;
    },
    create: async (hostelId, data) => {
        const response = await api.post('/floors', { hostelId, ...data });
        return response.data.success ? response.data.data : response.data;
    },
    update: async (id, data) => {
        const response = await api.patch(`/floors/${id}`, data);
        return response.data.success ? response.data.data : response.data;
    },
    delete: async (id) => {
        const response = await api.delete(`/floors/${id}`);
        return response.data;
    },
};

export const roomService = {
    getAll: async (hostelId, params = {}) => {
        const response = await api.get('/rooms', { params: { ...params, hostelId } });
        return response.data.success ? response.data.data : response.data;
    },
    getById: async (id) => {
        const response = await api.get(`/rooms/${id}`);
        return response.data;
    },
    getOverview: async (id) => {
        const response = await api.get(`/rooms/${id}/overview`);
        return response.data;
    },
    getInviteDefaults: async (id) => {
        const response = await api.get(`/rooms/${id}/invite-defaults`);
        return response.data;
    },
    create: async (hostelId, data) => {
        const response = await api.post('/rooms', { ...data, hostelId });
        return response.data.success ? response.data.data : response.data;
    },
    update: async (id, data) => {
        const response = await api.patch(`/rooms/${id}`, data);
        return response.data;
    },
    delete: async (id) => {
        const response = await api.delete(`/rooms/${id}`);
        return response.data;
    },
    reorder: async ({ hostelId, floorId, order }) => {
        const response = await api.patch('/rooms/reorder', { hostelId, floorId, order });
        return response.data.success ? response.data.data : response.data;
    }
};

export const allocationService = {
    allocate: async (hostelId, data) => {
        const response = await api.post('/allocations', { ...data, hostelId });
        return response.data;
    },
    end: async (allocationId, data) => {
        const response = await api.patch(`/allocations/${allocationId}/end`, data);
        return response.data;
    },
    shift: async (hostelId, data) => {
        const response = await api.post('/allocations/shift', { ...data, hostelId });
        return response.data;
    },
    getTenantHistory: async (tenantId, hostelId) => {
        const response = await api.get(`/allocations/tenant/${tenantId}`);
        return response.data.success ? response.data.data : response.data;
    },
    getAllActive: async (hostelId) => {
        const response = await api.get('/allocations', { params: { hostelId } });
        return response.data;
    },
    getHistory: async () => {
        const response = await api.get('/allocations/owner-history');
        return response.data;
    }
};
