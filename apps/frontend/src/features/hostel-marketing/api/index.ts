import api from '@lib/api-client';

/**
 * The hostel marketing page and its approval cycle.
 *
 * One feature covering both sides on purpose: the owner's editor and the
 * admin's review queue read and write the *same* revision, and splitting them
 * across two features is how the two ends of a workflow drift apart.
 */

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export type RevisionStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

/** How a bed tier's availability is expressed to tenants. */
export type BedAvailability = 'BEDS_LEFT' | 'AVAILABLE' | 'FULL';

export type PlaceCategory = 'COLLEGE' | 'TRANSPORT' | 'MARKET' | 'HOSPITAL' | 'OTHER';

export interface MarketingPhoto {
  url: string;
  label?: string | null;
  is_cover: boolean;
  sort: number;
}

export interface MarketingBed {
  name: string;
  /** Beds per room. Checked against real rooms at review time. */
  sharing: number;
  /** Advertised monthly price per bed, whole rupees. */
  price: number;
  inclusions?: string | null;
  availability: BedAvailability;
}

export interface MarketingAmenity {
  label: string;
  /** Hidden rather than deleted, so an owner can toggle without losing it. */
  enabled: boolean;
  icon?: string | null;
}

export interface MarketingPlace {
  name: string;
  distance: string;
  category: PlaceCategory;
  sort: number;
}

/** The four meals the design lays out. The set is fixed; dishes are not. */
export type MessMealKey = 'b' | 'l' | 's' | 'dn';

export type MessType = 'VEG' | 'NON_VEG' | 'BOTH';

export interface MessMeal {
  key: MessMealKey;
  label: string;
  time: string;
  /** Off means the hostel doesn't serve that meal — it drops off the listing. */
  enabled: boolean;
}

/** One day's dishes, keyed by meal. Free text, "Idli · Sambar · Chutney". */
export type MessDay = Record<MessMealKey, string>;

export interface MarketingMess {
  provided: boolean;
  type: MessType;
  meals: MessMeal[];
  /** Mon–Sun, always exactly 7 — the server pads it. */
  week: MessDay[];
}

export interface MarketingContent {
  basics: { tagline: string | null; about: string | null; highlights: string[] };
  photos: MarketingPhoto[];
  beds: MarketingBed[];
  amenities: MarketingAmenity[];
  places: MarketingPlace[];
  mess: MarketingMess;
}

export interface MarketingEditorState {
  hostel: { id: string; name: string; public_slug: string | null };
  /**
   * `views_30d` is always null — Stayo does not track listing views anywhere.
   * The field exists so the shape is honest about the gap rather than the UI
   * silently omitting a stat the design asks for.
   */
  stats: { enquiries_30d: number; views_30d: number | null };
  draft: { id: string | null; version: number; status: RevisionStatus; content: MarketingContent };
  published: { id: string; version: number; content: MarketingContent; reviewed_at: string | null } | null;
  last_rejection: { version: number; review_note: string | null; reviewed_at: string | null } | null;
  /** What the owner must fix before the submit button does anything. */
  issues: string[];
  /** False while a submission is in review — the editor locks rather than
      letting an owner change what a reviewer is reading. */
  is_editable: boolean;
}

/** Things a reviewer can't see by eye. Surfaced, never blocking. */
export interface ReviewFlag {
  code: 'PRICE_DRIFT' | 'SHARING_NOT_IN_INVENTORY' | 'NO_ROOMS';
  message: string;
  detail?: Record<string, unknown>;
}

export interface ReviewQueueItem {
  id: string;
  version: number;
  submitted_at: string | null;
  hostel: { id: string; name: string; city: string | null; listing_status: string; verification_status: string };
  summary: { photos: number; beds: number; amenities: number; places: number; tagline: string | null };
  flags: ReviewFlag[];
}

export interface ReviewSubmission {
  id: string;
  version: number;
  status: RevisionStatus;
  content: MarketingContent;
  submitted_at: string | null;
  hostel: { id: string; name: string; city: string | null; address: string; listing_status: string; verification_status: string };
  /** What Discovery is showing right now, so the reviewer judges the change. */
  live: { version: number; reviewed_at: string | null; content: MarketingContent } | null;
  flags: ReviewFlag[];
}

export const marketingService = {
  // ── Owner ────────────────────────────────────────────────────────────────
  getEditorState: async (hostelId: string): Promise<MarketingEditorState> => {
    const response = await api.get(`/owner/hostels/${hostelId}/marketing`);
    return unwrap(response) as MarketingEditorState;
  },

  saveDraft: async (hostelId: string, content: MarketingContent) => {
    const response = await api.put(`/owner/hostels/${hostelId}/marketing`, { content });
    return unwrap(response);
  },

  submit: async (hostelId: string) => {
    const response = await api.post(`/owner/hostels/${hostelId}/marketing/submit`);
    return unwrap(response);
  },

  withdraw: async (hostelId: string) => {
    const response = await api.post(`/owner/hostels/${hostelId}/marketing/withdraw`);
    return unwrap(response);
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  listPending: async (): Promise<ReviewQueueItem[]> => {
    const response = await api.get('/platform-admin/marketing-reviews');
    return unwrap(response) as ReviewQueueItem[];
  },

  getSubmission: async (revisionId: string): Promise<ReviewSubmission> => {
    const response = await api.get(`/platform-admin/marketing-reviews/${revisionId}`);
    return unwrap(response) as ReviewSubmission;
  },

  approve: async (revisionId: string, note?: string) => {
    const response = await api.post(`/platform-admin/marketing-reviews/${revisionId}/approve`, { note });
    return unwrap(response);
  },

  reject: async (revisionId: string, note: string) => {
    const response = await api.post(`/platform-admin/marketing-reviews/${revisionId}/reject`, { note });
    return unwrap(response);
  },
};

/** Mirrors `DEFAULT_MESS_MEALS` in the backend's marketing-content schema. */
export const DEFAULT_MESS_MEALS: MessMeal[] = [
  { key: 'b', label: 'Breakfast', time: '7:30 – 9:00 AM', enabled: true },
  { key: 'l', label: 'Lunch', time: '12:30 – 2:00 PM', enabled: true },
  { key: 's', label: 'Snacks', time: '5:00 – 6:00 PM', enabled: true },
  { key: 'dn', label: 'Dinner', time: '8:00 – 9:30 PM', enabled: true },
];

export const MESS_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MESS_TYPE_LABELS: Record<MessType, string> = {
  VEG: 'Veg only',
  NON_VEG: 'Non-veg',
  BOTH: 'Veg + Non-veg',
};

export const EMPTY_MARKETING_CONTENT: MarketingContent = {
  basics: { tagline: null, about: null, highlights: [] },
  photos: [],
  beds: [],
  amenities: [],
  places: [],
  mess: {
    provided: false,
    type: 'VEG',
    meals: DEFAULT_MESS_MEALS,
    week: Array.from({ length: 7 }, () => ({ b: '', l: '', s: '', dn: '' })),
  },
};
