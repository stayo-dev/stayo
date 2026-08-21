import api from '@lib/api-client';

/**
 * The admin side of hostel reviews. The only layer that knows these endpoint
 * shapes — the seeker-facing calls live in `features/discover/api`, because
 * they are a different audience reading a different projection of the same
 * table.
 */

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export type ReviewStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED';

export interface AdminReview {
  id: string;
  /** Derived from the categories below, not entered separately. */
  rating: number;
  rating_cleanliness: number | null;
  rating_food: number | null;
  rating_safety: number | null;
  rating_staff: number | null;
  rating_value: number | null;
  rating_location: number | null;
  body: string | null;
  status: ReviewStatus;
  stayed_here: boolean;
  created_at: string;
  moderated_at: string | null;
  moderation_note: string | null;
  hostel: { id: string; name: string; city: string | null; public_slug: string | null; food_included?: boolean };
  profile: { id: string; name: string | null; email: string | null };
}

export interface AdminReviewQueue {
  reviews: AdminReview[];
  counts: Record<string, number>;
}

export const reviewModerationService = {
  list: async (status: string): Promise<AdminReviewQueue> => {
    const response = await api.get('/platform-admin/reviews', { params: { status } });
    return unwrap(response) as AdminReviewQueue;
  },

  /** Publish or reject. This is the only path onto a public listing. */
  moderate: async (id: string, verdict: 'PUBLISH' | 'REJECT', note?: string | null) => {
    const response = await api.patch(`/platform-admin/reviews/${id}`, { verdict, note });
    return unwrap(response);
  },
};
