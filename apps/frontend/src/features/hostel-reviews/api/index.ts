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

export type ReviewStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'CHANGES_REQUESTED';
export type ReviewSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

export interface ReviewTopic {
  category: string;
  sentiment: ReviewSentiment;
  confidence: number;
}

export interface AdminReview {
  id: string;
  /** Overall Experience — given directly by the resident, not derived from the categories below. */
  rating: number;
  rating_cleanliness: number | null;
  rating_maintenance: number | null;
  rating_food: number | null;
  rating_room_comfort: number | null;
  rating_amenities: number | null;
  rating_staff: number | null;
  rating_safety: number | null;
  rating_wifi: number | null;
  body: string | null;
  status: ReviewStatus;
  stayed_here: boolean;
  stay_months: number | null;
  created_at: string;
  moderated_at: string | null;
  moderation_note: string | null;
  hostel: { id: string; name: string; city: string | null; public_slug: string | null; food_included?: boolean };
  profile: { id: string; name: string | null; email: string | null };
  /** Automatically detected topics + sentiment — an insight signal, never a moderation gate. */
  topics: ReviewTopic[];
}

export interface AdminReviewQueue {
  reviews: AdminReview[];
  counts: Record<string, number>;
}

export interface ReviewInsightsCategory {
  key: string;
  label: string;
  averageRating: number | null;
  mentions: number;
  positive: number;
  neutral: number;
  negative: number;
}

export interface ReviewInsightsComment {
  category: string;
  sentiment: ReviewSentiment;
  confidence: number;
  review: {
    id: string;
    body: string | null;
    rating: number;
    status: ReviewStatus;
    created_at: string;
    author: string;
    hostel: { id: string; name: string; public_slug: string | null };
  };
}

export interface ReviewInsightsResponse {
  categories: ReviewInsightsCategory[];
  comments: ReviewInsightsComment[];
}

export interface ReviewInsightsFilters {
  category?: string;
  sentiment?: ReviewSentiment;
  hostelId?: string;
  status?: string;
}

export const reviewModerationService = {
  list: async (status: string): Promise<AdminReviewQueue> => {
    const response = await api.get('/platform-admin/reviews', { params: { status } });
    return unwrap(response) as AdminReviewQueue;
  },

  /** Publish, reject, or ask for changes. Publish is the only path onto a public listing. */
  moderate: async (id: string, verdict: 'PUBLISH' | 'REJECT' | 'REQUEST_CHANGES', note?: string | null) => {
    const response = await api.patch(`/platform-admin/reviews/${id}`, { verdict, note });
    return unwrap(response);
  },

  /** "What are residents talking about" — separate from the moderation queue above. */
  insights: async (filters: ReviewInsightsFilters): Promise<ReviewInsightsResponse> => {
    const response = await api.get('/platform-admin/reviews/insights', { params: filters });
    return unwrap(response) as ReviewInsightsResponse;
  },
};
