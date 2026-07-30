import api from '@lib/api-client';

export const authService = {
    login: async (email, password) => {
        const response = await api.post('/auth/login', { email, password });
        return response.data;
    },
    getCurrentUser: async () => {
        const response = await api.get('/auth/me');
        return response.data;
    },
    register: async (data) => {
        const response = await api.post('/auth/register', data);
        return response.data;
    },
    changePassword: async (oldPassword, newPassword) => {
        const response = await api.post('/auth/change-password', {
            old_password: oldPassword,
            new_password: newPassword
        });
        return response.data;
    },
    forgotPassword: async (email) => {
        const response = await api.post('/auth/forgot-password', { email });
        return response.data;
    },
    resetPassword: async ({ code, accessToken, newPassword, confirmPassword }) => {
        const response = await api.post('/auth/reset-password', {
            code,
            access_token: accessToken,
            new_password: newPassword,
            confirm_password: confirmPassword,
        });
        return response.data;
    }
};

export const identityService = {
    confirmIdentity: async (password, purpose = 'OFFLINE_PAYMENT') => {
        const response = await api.post('/auth/confirm-identity', { password, purpose });
        return response.data; // { identity_token, expires_in, purpose }
    },
};
