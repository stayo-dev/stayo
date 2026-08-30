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
  /**
   * The printed weekly menu — A4 landscape, for the kitchen and canteen wall.
   *
   * Returns the file itself plus the name the server chose, matching the
   * owner-exports pattern. Regenerated from the live schedule on every call,
   * so a menu edited a minute ago prints correctly and no stale copy exists.
   * See ADR-144.
   */
  downloadMenuPdf: async (hostelId: string, month: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.get('/food/menu-pdf', {
      params: { hostelId, month },
      responseType: 'blob',
    });
    const disposition = String((response.headers as any)?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: response.data as Blob, filename: match?.[1] ?? `menu-${month}.pdf` };
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
    return unwrap(response) as { votingPeriod: any; totalVotes: number; voterCount: number; eligibleCount: number; byMealType: Record<string, { menu_item_id: string; name: string; votes: number }[]> };
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
  /**
   * "Ensure this month has a schedule row" — idempotent, no dish-selection
   * logic (never automatic generation, see ADR-114). Returns the existing
   * row (200) if one already exists, or a brand-new empty one (201).
   */
  createSchedule: async (hostelId: string, month: string) => {
    const response = await api.post('/food/schedules', { hostelId, month });
    return unwrap(response).schedule as any;
  },
  updateScheduleMeal: async (scheduleId: string, mealId: string, menuItemIds: string[], expectedUpdatedAt: string | null) => {
    const response = await api.patch(`/food/schedules/${scheduleId}/meals/${mealId}`, { menuItemIds, expectedUpdatedAt });
    return unwrap(response);
  },
  publishSchedule: async (scheduleId: string) => {
    const response = await api.post(`/food/schedules/${scheduleId}/publish`);
    return unwrap(response);
  },
  /**
   * Copies this schedule's full weekly pattern into one or more other
   * hostels for the same month. On a 409 `CONFIRM_OVERWRITE`, the axios
   * error's `response.data.error.details.pendingOverwrite` lists which
   * target hostels already have content — same pattern as `STALE_WRITE`.
   */
  copyScheduleToHostels: async (scheduleId: string, targetHostelIds: string[], confirmOverwrite = false) => {
    const response = await api.post(`/food/schedules/${scheduleId}/copy-to-hostels`, { targetHostelIds, confirmOverwrite });
    return unwrap(response) as { copied: { hostelId: string; hostelName: string; scheduleId: string; status: 'DRAFT' | 'PUBLISHED' }[] };
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

  // Polls (owner) — independent of the food_voting_periods/food_votes system above.
  getPolls: async (hostelId: string, status?: 'OPEN' | 'CLOSED') => {
    const response = await api.get('/food/polls', { params: { hostelId, status } });
    return unwrap(response).polls as any[];
  },
  createPoll: async (payload: {
    hostelId: string;
    title: string;
    pollType: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'RATING' | 'YES_NO';
    mealType: string;
    pollDate: string;
    closesAt: string;
    isAnonymous: boolean;
    allowMultiple: boolean;
    options: string[];
    notifyNow: boolean;
  }) => {
    const response = await api.post('/food/polls', payload);
    return unwrap(response);
  },
  closePoll: async (pollId: string) => {
    const response = await api.post(`/food/polls/${pollId}/close`);
    return unwrap(response);
  },
  updatePoll: async (
    pollId: string,
    patch: Partial<{
      title: string;
      pollDate: string;
      closesAt: string;
      isAnonymous: boolean;
      allowMultiple: boolean;
      options: { id?: string; label: string }[];
    }>,
  ) => {
    const response = await api.patch(`/food/polls/${pollId}`, patch);
    return unwrap(response);
  },
  getPollResults: async (pollId: string) => {
    const response = await api.get(`/food/polls/${pollId}/results`);
    return unwrap(response) as { poll: any; options: { id: string; label: string; position: number; votes: number }[]; totalVotes: number; voterCount: number; eligibleCount: number };
  },

  // Polls (tenant)
  getTenantPolls: async () => {
    const response = await api.get('/food/tenant/polls');
    return unwrap(response).polls as any[];
  },
  castPollVote: async (pollId: string, optionId: string) => {
    const response = await api.post(`/food/tenant/polls/${pollId}/vote`, { optionId });
    return unwrap(response) as { option_id: string; voted: boolean };
  },

  // Meal Timings — permanent per-hostel serving-window config, distinct from
  // the changing weekly menu above. Lives under /hostels/[id]/*, matching
  // the other hostel-settings routes (e.g. billing-defaults), not /food/*.
  //
  // The backend stores/returns FoodMealType keys (BREAKFAST/LUNCH/SNACKS/
  // DINNER, matching the Prisma enum); every frontend consumer works in
  // lowercase MealSlotKey (breakfast/lunch/snacks/dinner), same convention
  // `toWeekGrid` already uses for the schedule grid. The conversion happens
  // once, here, at the API boundary — not scattered through every page.
  getMealTimings: async (hostelId: string) => {
    const response = await api.get(`/hostels/${hostelId}/meal-timings`);
    return toLowercaseMealTimings(unwrap(response).meal_timings);
  },
  updateMealTimings: async (hostelId: string, mealTimings: Record<string, { start: string; end: string; enabled: boolean }>) => {
    const response = await api.patch(`/hostels/${hostelId}/meal-timings`, { meal_timings: toUppercaseMealTimings(mealTimings) });
    return toLowercaseMealTimings(unwrap(response).meal_timings);
  },
  getTenantMealTimings: async () => {
    const response = await api.get('/food/tenant/meal-timings');
    return toLowercaseMealTimings(unwrap(response).meal_timings);
  },
};

const SLOT_TO_MEAL_TYPE: Record<string, string> = { breakfast: 'BREAKFAST', lunch: 'LUNCH', snacks: 'SNACKS', dinner: 'DINNER' };
const MEAL_TYPE_TO_SLOT: Record<string, string> = { BREAKFAST: 'breakfast', LUNCH: 'lunch', SNACKS: 'snacks', DINNER: 'dinner' };

function toLowercaseMealTimings(raw: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const slot = MEAL_TYPE_TO_SLOT[key];
    if (slot) out[slot] = value;
  }
  return out;
}

function toUppercaseMealTimings(raw: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const mealType = SLOT_TO_MEAL_TYPE[key];
    if (mealType) out[mealType] = value;
  }
  return out;
}
