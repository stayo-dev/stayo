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
  /**
   * Images and videos share one gallery, one order and one caption field —
   * an owner thinks in "my listing's photos", not two collections. Absent on
   * every revision written before video existed, which is why it is optional
   * and read as `image` everywhere.
   */
  kind?: 'image' | 'video';
  /** A still for a video, for the search card and the link preview. */
  thumbnail_url?: string | null;
  /**
   * Which part of the hostel this shows — `rooms`, `bathrooms`, `mess`,
   * `common`, `study`, `outside`, `other`. Groups the listing's photo tour.
   */
  category?: string;
}

export interface UploadedMedia {
  url: string;
  label: string | null;
  kind: 'image' | 'video';
  thumbnail_url: string | null;
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

export interface KitchenMenu {
  available: boolean;
  /** The month the imported schedule belongs to. */
  month: string | null;
  week: MessDay[] | null;
  served: Record<MessMealKey, boolean> | null;
}

export interface MarketingEditorState {
  hostel: { id: string; name: string; public_slug: string | null };
  /**
   * `views_30d` is always null — Stayo does not track listing views anywhere.
   * The field exists so the shape is honest about the gap rather than the UI
   * silently omitting a stat the design asks for.
   */
  stats: { enquiries_30d: number; views_30d: number | null };
  draft: {
    id: string | null;
    version: number;
    status: RevisionStatus;
    content: MarketingContent;
    /** Set once sent for review — what "in review since…" is read from. */
    submitted_at?: string | null;
  };
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

  /**
   * Upload listing photos, get URLs back. The caller puts them in the draft;
   * nothing is persisted until the draft is saved.
   */
  /**
   * Uploads **one file per request**, deliberately.
   *
   * This used to take a batch, and a phone multi-select of ten 4MB photos
   * became a single ~40MB request that the platform rejected before any
   * per-file size check ran — the owner was told the limit was exceeded when
   * no individual photo was near it. One file per request also means a
   * failure loses one photo instead of the whole selection, and progress can
   * be reported per file.
   */
  uploadMedia: async (hostelId: string, file: File): Promise<UploadedMedia | null> => {
    const form = new FormData();
    form.append('files', file);
    const response = await api.post(`/owner/hostels/${hostelId}/marketing/photos`, form);
    const uploaded = (unwrap(response)?.photos ?? []) as UploadedMedia[];
    return uploaded[0] ?? null;
  },

  /**
   * The hostel's real kitchen menu, to copy into the listing's mess block.
   * Read-only — importing it fills the draft, which still goes through review.
   */
  kitchenMenu: async (hostelId: string): Promise<KitchenMenu> => {
    const response = await api.get(`/owner/hostels/${hostelId}/marketing/kitchen-menu`);
    return unwrap(response) as KitchenMenu;
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

  /**
   * Send back with per-section flags. Either a flag or a note is enough; the
   * server refuses a send-back carrying neither.
   */
  reject: async (
    revisionId: string,
    note: string,
    flags: { section: string; note?: string }[] = [],
  ) => {
    const response = await api.post(`/platform-admin/marketing-reviews/${revisionId}/reject`, { note, flags });
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


/**
 * Admin-only preview of an unapproved marketing revision, projected through
 * the same function the live Discovery listing uses. See
 * apps/backend/src/services/discovery/listing-projection.ts.
 */
export const marketingPreviewService = {
  get: async (revisionId: string) => {
    const response = await api.get(`/platform-admin/marketing-reviews/${revisionId}/preview`);
    const data = response.data?.data ?? response.data;
    return data as { revision: { id: string; version: number; status: string }; listing: any };
  },
};
