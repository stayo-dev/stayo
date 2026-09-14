import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export type ActivityCategory =
  | 'Payments'
  | 'Expenses'
  | 'Occupancy'
  | 'Documents'
  | 'Admissions'
  | 'Move Outs'
  | 'Billing'
  | 'Settings';

export interface ActivityEvent {
  id: string;
  category: ActivityCategory;
  title: string;
  subtitle: string;
  /** ISO string over the wire, whatever the server's Date said. */
  timestamp: string;
  badgeColor: string;
  actor: { name: string; email: string };
  metadata: Record<string, any>;
}

export interface ActivityFeedPage {
  items: ActivityEvent[];
  total: number;
}

export const hostelActivityService = {
  /**
   * The Overview card's feed. `include=events` tells the server to skip the
   * running cash/occupancy reconstruction and the "needs attention" panel —
   * this runs on every hostel open, so it must stay cheap.
   */
  getRecent: async (hostelId: string, limit = 5): Promise<ActivityFeedPage> => {
    const response = await api.get('/owner/activity-logs', {
      params: { hostelId, limit, include: 'events' },
    });
    return unwrap(response) as ActivityFeedPage;
  },

  /** The full history screen: paginated, filterable, searchable. */
  getFeed: async (
    hostelId: string,
    params: { limit?: number; offset?: number; category?: string; search?: string } = {},
  ): Promise<ActivityFeedPage> => {
    const response = await api.get('/owner/activity-logs', {
      params: { hostelId, include: 'events', ...params },
    });
    return unwrap(response) as ActivityFeedPage;
  },
};
