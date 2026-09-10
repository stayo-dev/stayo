/**
 * What kind of hostel this is, and what that settles.
 *
 * `hostels.hostel_type` has existed as a nullable column, and the backend has
 * long known how to use it: `identity-field-policy.ts` derives a tenant's
 * gender from it, `resolveGenderRequirement` decides whether onboarding must
 * ask, and the activation context ships the answer so the Identity step can
 * drop the selector. All of it tested, and none of it ever fired — because
 * **nothing in the app ever asked the owner**, so the column stayed NULL and
 * every tenant was asked their gender regardless.
 *
 * This is the missing question. It mirrors the backend's rule exactly rather
 * than inventing a second one: only BOYS and GIRLS establish a gender;
 * co-living, working-professionals and an unset type all still ask. The
 * mirroring is asserted, because the two drifting apart would mean a tenant
 * either answers a question the hostel already answered, or is never asked one
 * nobody answered.
 */

export type HostelTypeCode = 'BOYS' | 'GIRLS' | 'CO_LIVING' | 'WORKING_PROS';

/** What `tenants.gender` accepts. Matches the backend's `TenantGender`. */
export type TenantGender = 'Male' | 'Female';

export interface HostelTypeOption {
  code: HostelTypeCode;
  label: string;
  /** What choosing this settles, said plainly on the builder screen. */
  hint: string;
}

export const HOSTEL_TYPE_OPTIONS: HostelTypeOption[] = [
  { code: 'BOYS', label: 'Boys', hint: 'Tenants are never asked their gender' },
  { code: 'GIRLS', label: 'Girls', hint: 'Tenants are never asked their gender' },
  { code: 'CO_LIVING', label: 'Co-ed', hint: 'Tenants choose their gender when they join' },
  { code: 'WORKING_PROS', label: 'Working professionals', hint: 'Tenants choose their gender when they join' },
];

export function hostelTypeLabel(code: string | null | undefined): string {
  const found = HOSTEL_TYPE_OPTIONS.find((o) => o.code === String(code || '').trim().toUpperCase());
  return found?.label ?? '';
}

/**
 * The gender this hostel's type establishes, or null when it establishes
 * nothing. Null is the common case and must stay cheap to handle.
 */
export function impliedGender(code: string | null | undefined): TenantGender | null {
  const normalized = String(code || '').trim().toUpperCase();
  if (normalized === 'BOYS') return 'Male';
  if (normalized === 'GIRLS') return 'Female';
  return null;
}

/** True when the Identity step must still render the gender selector. */
export function needsGenderAtOnboarding(code: string | null | undefined): boolean {
  return impliedGender(code) === null;
}
