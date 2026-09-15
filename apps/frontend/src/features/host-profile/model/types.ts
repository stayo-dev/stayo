/**
 * The host card's data (ADR-200). Mirrors `PublicHost` / `EditableHost` /
 * `AdminHost` in `apps/backend/src/services/host-profile/host-profile-service.ts`
 * — the listing's `host` object is `PublicHost` plus `platform_listed`.
 */

export interface HostStats {
  review_count: number;
  rating: number | null;
  /** Already rounded by the backend: null below 5, floored to the ten from 10. */
  residents: number | null;
}

export interface PublicHost {
  platform_listed?: boolean;
  name: string | null;
  photo_url: string | null;
  bio: string | null;
  languages: string[];
  hosting_since: number | null;
  verified: boolean;
  listed_since: string | null;
  stats: HostStats;
}

export interface EditableHost extends PublicHost {
  bio_hidden: boolean;
  photo_hidden: boolean;
}

export interface AdminHost extends EditableHost {
  updated_at: string | null;
  updated_by_name: string | null;
}

export interface HostDraft {
  bio: string;
  languages: string[];
  hosting_since: number | null;
}

export type HostAdminPatch = Partial<HostDraft> & { name?: string; bio_hidden?: boolean; photo_hidden?: boolean };

/** Same list and order as the backend's `bio-rules.ts`. */
export const HOST_LANGUAGES = [
  'Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Malayalam',
  'Marathi', 'Urdu', 'Bengali', 'Gujarati', 'Punjabi', 'Odia',
] as const;

export const BIO_MAX_CHARS = 500;
export const LANGUAGES_MAX = 6;
