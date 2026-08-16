import api from '@lib/api-client';

/**
 * The portable Stayo profile (phase B) — the identity a tenant fills in once
 * and every later onboarding reads as defaults.
 *
 * Its own feature rather than part of `discover`: Discover is the first
 * surface to edit it, but tenant activation reads it too, and it belongs to
 * neither.
 */

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export type ProfileType = 'STUDENT' | 'WORKING_PROFESSIONAL';

export interface ProfileIdentity {
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  pan_number: string | null;
  permanent_address: string | null;
  photo_url: string | null;
  personal_email: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_relation: string | null;
  profile_type: ProfileType | null;
  college_name: string | null;
  roll_number: string | null;
  course: string | null;
  year_of_study: number | null;
  branch: string | null;
  section: string | null;
  office_name: string | null;
  office_location: string | null;
  job_role: string | null;

  /** Every core field present — what onboarding checks before skipping ahead. */
  is_complete: boolean;
  missing_core_fields: string[];
  /**
   * 0-100, profile-type-aware (core + general-optional + whichever of
   * academic/professional applies) — the one canonical completion number,
   * computed server-side so every consumer (Explore/Profile's nudge card,
   * the Dashboard's `ProfileCompletionNudge`) reads the same figure instead
   * of each computing its own.
   */
  completion_percent: number;
  /**
   * Fields still being read off a tenancy because the backfill hasn't run for
   * this person yet. Surfaced so the transition's end is observable.
   */
  pending_backfill_fields: string[];
  has_profile_record: boolean;
}

export type IdentityPatch = Partial<Omit<
  ProfileIdentity,
  'is_complete' | 'missing_core_fields' | 'completion_percent' | 'pending_backfill_fields' | 'has_profile_record'
>>;

export interface VaultShare {
  share_id: string;
  hostel_id: string;
  hostel_name: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verified_at: string | null;
  rejection_reason: string | null;
}

export interface VaultDocument {
  id: string;
  doc_type: string;
  doc_number: string | null;
  file_url: string;
  mime_type: string;
  file_size: number;
  is_active: boolean;
  created_at: string;
  /** Which hostels can see it, and what each of them decided. */
  shared_with: VaultShare[];
}

export interface ResidencyStay {
  id: string;
  hostel: { id: string | null; name: string | null; city: string | null };
  joined_on: string | null;
  exit_date: string | null;
  is_current: boolean;
  duration_months: number | null;
  room_no: string | null;
  /** Room capacity — reads as sharing type: 4 → "4-bed". */
  sharing: number | null;
  room_type: string | null;
  monthly_rent: number | null;
  /** Whether the stay was closed out properly. */
  settled: boolean;
  ever_moved_in: boolean;
}

export interface ResidencyHistory {
  stays: ResidencyStay[];
  total_stays: number;
  total_months: number;
}

export interface DisclosureEntry {
  hostel_id: string;
  hostel_name: string;
  can_see: boolean;
  /** TENANCY | OPEN_ENQUIRY | APPROVED | DECLINED | REVOKED | REQUESTED */
  source: string;
  requested_at?: string | null;
  decided_at?: string | null;
}

export interface Disclosures {
  shared_with: DisclosureEntry[];
  pending_requests: DisclosureEntry[];
  blocked: DisclosureEntry[];
}

export const profileService = {
  getIdentity: async (): Promise<ProfileIdentity> => {
    const response = await api.get('/profile/identity');
    return unwrap(response) as ProfileIdentity;
  },

  updateIdentity: async (patch: IdentityPatch): Promise<ProfileIdentity> => {
    const response = await api.patch('/profile/identity', patch);
    return unwrap(response) as ProfileIdentity;
  },

  listDocuments: async (): Promise<VaultDocument[]> => {
    const response = await api.get('/profile/documents');
    return unwrap(response) as VaultDocument[];
  },

  shareWithHostel: async (hostelId: string) => {
    const response = await api.post('/profile/documents/shares', { hostel_id: hostelId });
    return unwrap(response) as { granted: number };
  },

  revokeFromHostel: async (hostelId: string) => {
    const response = await api.delete('/profile/documents/shares', { params: { hostel_id: hostelId } });
    return unwrap(response) as { revoked: number };
  },

  getResidencyHistory: async (): Promise<ResidencyHistory> => {
    const response = await api.get('/profile/residency-history');
    return unwrap(response) as ResidencyHistory;
  },

  getDisclosures: async (): Promise<Disclosures> => {
    const response = await api.get('/profile/residency-history/disclosures');
    return unwrap(response) as Disclosures;
  },

  /** The decision verbs are the tenant's alone — owners can only request. */
  setDisclosure: async (hostelId: string, status: 'APPROVED' | 'DECLINED' | 'REVOKED'): Promise<Disclosures> => {
    const response = await api.post('/profile/residency-history/disclosures', {
      hostel_id: hostelId,
      status,
    });
    return unwrap(response) as Disclosures;
  },
};
