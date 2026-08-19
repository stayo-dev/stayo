import api from '@lib/api-client';

/**
 * The only layer that knows Discover's endpoint shapes. Screens and hooks talk
 * to these functions; nothing else in the app may name a `/discover/*` path.
 */

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

/** Audience values `hostels.hostel_type` actually holds. */
export type HostelType = 'BOYS' | 'GIRLS' | 'CO_LIVING' | 'WORKING_PROS';

export type DiscoverSort = 'recommended' | 'price_low' | 'newest';

export interface DiscoverCard {
  id: string;
  slug: string | null;
  name: string;
  city: string | null;
  address: string;
  hostel_type: HostelType | null;
  food_included: boolean;
  verified: boolean;
  photos: string[];
  listed_at: string;
  /** Beds free right now: capacity minus allocations minus live reservations. */
  vacant_beds: number;
  /** `null` means no room has a rent set — not that it is free. */
  starting_price: number | null;
  /** Room capacities offered, ascending: [2, 4, 6]. */
  sharing: number[];
  saved_at?: string;
}

export interface DiscoverSearchResult {
  total: number;
  limit: number;
  offset: number;
  results: DiscoverCard[];
  facets: { cities: { city: string; count: number }[] };
}

export interface DiscoverFilters {
  q?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  sharing?: number[];
  hostelType?: HostelType | null;
  foodIncluded?: boolean;
  hasVacancy?: boolean;
  sort?: DiscoverSort;
  limit?: number;
  offset?: number;
}

/**
 * Phase A ships no ratings, amenity grid or distances — those columns do not
 * exist yet. The server sends these flags so the UI can reserve the space
 * without inventing a number. See phases C/D of the design spec.
 */
/** A bed tier as the owner advertises it — approved content, not inventory. */
export interface ListingBedTier {
  name: string;
  sharing: number;
  price: number;
  inclusions?: string | null;
  availability: 'BEDS_LEFT' | 'AVAILABLE' | 'FULL';
}

export interface ListingPlace {
  name: string;
  distance: string;
  category: 'COLLEGE' | 'TRANSPORT' | 'MARKET' | 'HOSPITAL' | 'OTHER';
}

/**
 * The reviewed weekly mess menu, or absent when the hostel serves no meals.
 *
 * Same content the owner edits in the marketing page's mess card, carried
 * through the same approval cycle — this is not the operational food schedule.
 */
export interface ListingMess {
  type: 'VEG' | 'NON_VEG' | 'BOTH';
  /** Only meals the owner serves; disabled ones are dropped server-side. */
  meals: { key: 'b' | 'l' | 's' | 'dn'; label: string; time: string }[];
  /** Mon–Sun, always 7 entries, each keyed by meal. */
  week: Record<'b' | 'l' | 's' | 'dn', string>[];
}

export interface DiscoverListing {
  hostel: any;
  rooms: any[];
  /**
   * Owner-authored and admin-approved (ADR-076). Empty until a hostel has had
   * a marketing revision approved — never a draft, never a submission.
   */
  bed_tiers: ListingBedTier[];
  amenities: { label: string; icon?: string | null }[];
  places: ListingPlace[];
  /** Null when this hostel does not provide meals. */
  mess: ListingMess | null;
  marketing_published: boolean;
  ratings_available: boolean;
  amenities_available: boolean;
  [key: string]: any;
}


// ── Reviews ────────────────────────────────────────────────────────────────

export interface HostelReview {
  id: string;
  rating: number;
  body: string | null;
  /** This person held a tenancy here — a badge, never a gate on writing one. */
  stayed_here: boolean;
  created_at: string;
  /** "Sharan K." — never a full name, an email or a phone number. */
  author: string;
}

export interface ReviewSummary {
  count: number;
  /** Null until there are enough reviews for a mean to mean anything. */
  average: number | null;
  distribution: { rating: number; count: number }[];
  emptyReason: 'NONE_YET' | 'TOO_FEW' | null;
}

/** The reader's own review, in whatever state — including not yet published. */
export interface MyReview {
  id: string;
  rating: number;
  body: string | null;
  status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  moderation_note: string | null;
  created_at: string;
}

export interface HostelReviewsPayload {
  summary: ReviewSummary;
  reviews: HostelReview[];
  mine: MyReview | null;
}

export type EnquiryStage = 'SENT' | 'REVIEWING' | 'ACCEPTED' | 'CLOSED';

export interface DiscoverEnquiry {
  id: string;
  stage: EnquiryStage;
  notes: string | null;
  created_at: string;
  last_activity_at: string;
  hostel: {
    id: string;
    name: string;
    slug: string | null;
    city: string | null;
    address: string;
    photos: string[];
  };
}

function toQuery(filters: DiscoverFilters) {
  const params: Record<string, string> = {};
  if (filters.q) params.q = filters.q;
  if (filters.city) params.city = filters.city;
  if (filters.minPrice != null) params.min_price = String(filters.minPrice);
  if (filters.maxPrice != null) params.max_price = String(filters.maxPrice);
  if (filters.sharing?.length) params.sharing = filters.sharing.join(',');
  if (filters.hostelType) params.hostel_type = filters.hostelType;
  if (filters.foodIncluded) params.food_included = 'true';
  if (filters.hasVacancy) params.has_vacancy = 'true';
  if (filters.sort) params.sort = filters.sort;
  if (filters.limit != null) params.limit = String(filters.limit);
  if (filters.offset != null) params.offset = String(filters.offset);
  return params;
}

export const discoverService = {
  search: async (filters: DiscoverFilters = {}): Promise<DiscoverSearchResult> => {
    const response = await api.get('/discover/hostels', { params: toQuery(filters) });
    return unwrap(response) as DiscoverSearchResult;
  },

  getListing: async (slug: string): Promise<DiscoverListing> => {
    const response = await api.get(`/discover/hostels/${encodeURIComponent(slug)}`);
    return unwrap(response) as DiscoverListing;
  },

  /** Published reviews for a hostel, plus the reader's own if they have one. */
  listReviews: async (slug: string): Promise<HostelReviewsPayload> => {
    const response = await api.get(`/discover/hostels/${encodeURIComponent(slug)}/reviews`);
    return unwrap(response) as HostelReviewsPayload;
  },

  /**
   * Write or replace a review. Always lands as PENDING — nothing a visitor
   * writes reaches a listing without an admin publishing it.
   */
  submitReview: async (slug: string, input: { rating: number; body?: string | null }) => {
    const response = await api.post(`/discover/hostels/${encodeURIComponent(slug)}/reviews`, input);
    return unwrap(response);
  },

  listSaved: async (): Promise<DiscoverCard[]> => {
    const response = await api.get('/discover/saved');
    return unwrap(response) as DiscoverCard[];
  },

  save: async (hostelId: string) => {
    const response = await api.post('/discover/saved', { hostel_id: hostelId });
    return unwrap(response) as { saved: boolean };
  },

  unsave: async (hostelId: string) => {
    const response = await api.delete(`/discover/saved/${hostelId}`);
    return unwrap(response) as { saved: boolean };
  },

  listEnquiries: async (): Promise<DiscoverEnquiry[]> => {
    const response = await api.get('/discover/enquiries');
    return unwrap(response) as DiscoverEnquiry[];
  },

  getEnquiry: async (id: string): Promise<DiscoverEnquiry> => {
    const response = await api.get(`/discover/enquiries/${id}`);
    return unwrap(response) as DiscoverEnquiry;
  },

  createEnquiry: async (input: {
    slug: string;
    roomCapacity?: number;
    moveInDate?: string;
    durationMonths?: number;
    message?: string;
  }): Promise<DiscoverEnquiry> => {
    const response = await api.post('/discover/enquiries', {
      slug: input.slug,
      room_capacity: input.roomCapacity,
      move_in_date: input.moveInDate,
      duration_months: input.durationMonths,
      message: input.message,
    });
    return unwrap(response) as DiscoverEnquiry;
  },
};
