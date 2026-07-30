import api from '@lib/api-client';

const unwrap = (response) => {
  if (response.data?.success === true && response.data.data !== undefined) {
    return response.data.data;
  }
  return response.data;
};

export const activityListService = {
  getList: async (hostelId, params = {}) => {
    const response = await api.get('/activity/list', { params: { hostelId, ...params } });
    return unwrap(response);
  },
};
