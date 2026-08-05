import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const foodService = {
  getMenuItems: async (hostelId: string, params: { mealType?: string; includeInactive?: boolean } = {}) => {
    const response = await api.get('/food/menu-items', { params: { hostelId, ...params } });
    return unwrap(response).items as any[];
  },
  createMenuItem: async (hostelId: string, mealType: string, name: string) => {
    const response = await api.post('/food/menu-items', { hostelId, mealType, name });
    return unwrap(response);
  },
  updateMenuItem: async (id: string, data: { name?: string; isActive?: boolean }) => {
    const response = await api.patch(`/food/menu-items/${id}`, data);
    return unwrap(response);
  },
  deleteMenuItem: async (id: string) => {
    const response = await api.delete(`/food/menu-items/${id}`);
    return unwrap(response);
  },

  // Voting (owner)
  getVotingPeriod: async (hostelId: string, month?: string) => {
    const response = await api.get('/food/voting-periods', { params: { hostelId, month } });
    return unwrap(response).votingPeriod as any;
  },
  openVoting: async (hostelId: string, month: string, votingStartsAt: string, votingEndsAt: string) => {
    const response = await api.post('/food/voting-periods', { hostelId, month, votingStartsAt, votingEndsAt });
    return unwrap(response);
  },
  closeVoting: async (votingPeriodId: string) => {
    const response = await api.post(`/food/voting-periods/${votingPeriodId}/close`);
    return unwrap(response);
  },
  getVotingResults: async (votingPeriodId: string) => {
    const response = await api.get(`/food/voting-periods/${votingPeriodId}/results`);
    return unwrap(response) as { votingPeriod: any; totalVotes: number; byMealType: Record<string, { menu_item_id: string; name: string; votes: number }[]> };
  },

  // Voting (tenant)
  getTenantVotingPeriod: async () => {
    const response = await api.get('/food/tenant/voting-period');
    return unwrap(response) as { votingPeriod: any; items: any[]; myVotes: { meal_type: string; menu_item_id: string }[] };
  },
  castTenantVote: async (mealType: string, menuItemId: string) => {
    const response = await api.post('/food/tenant/vote', { mealType, menuItemId });
    return unwrap(response);
  },

  // Schedule (owner)
  getSchedule: async (hostelId: string, month: string) => {
    const response = await api.get('/food/schedules', { params: { hostelId, month } });
    return unwrap(response).schedule as any;
  },
  generateSchedule: async (hostelId: string, month: string, votingPeriodId?: string, mode: 'BUILD' | 'FILL_GAPS' | 'START_OVER' = 'BUILD') => {
    const response = await api.post('/food/schedules/generate', { hostelId, month, votingPeriodId, mode });
    return unwrap(response);
  },
  updateScheduleMeal: async (scheduleId: string, mealId: string, menuItemId: string) => {
    const response = await api.patch(`/food/schedules/${scheduleId}/meals/${mealId}`, { menuItemId });
    return unwrap(response);
  },
  publishSchedule: async (scheduleId: string) => {
    const response = await api.post(`/food/schedules/${scheduleId}/publish`);
    return unwrap(response);
  },
  getScheduleHistory: async (hostelId: string) => {
    const response = await api.get('/food/schedules/history', { params: { hostelId } });
    return unwrap(response).schedules as any[];
  },

  // Schedule (tenant)
  getTenantSchedule: async (month?: string) => {
    const response = await api.get('/food/tenant/schedule', { params: { month } });
    return unwrap(response).schedule as any;
  },
  getTenantScheduleHistory: async () => {
    const response = await api.get('/food/tenant/schedule/history');
    return unwrap(response).schedules as any[];
  },
};
