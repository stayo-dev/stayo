/**
 * The person-level identity fields, as a leaf module with no imports.
 *
 * Split out of `profile-identity-service.ts` so that pure consumers — notably
 * `src/services/tenants/onboarding-known.ts` — can name these fields without
 * transitively importing `@/lib/db`. `vitest.pure.config.ts` admits only files
 * that reach no I/O, and that rule is what keeps those tests runnable with no
 * database at all.
 */
export const IDENTITY_FIELDS = [
  "date_of_birth",
  "gender",
  "nationality",
  "pan_number",
  "permanent_address",
  "photo_url",
  "personal_email",
  "guardian_name",
  "guardian_phone",
  "guardian_relation",
  "profile_type",
  "college_name",
  "roll_number",
  "course",
  "year_of_study",
  "branch",
  "section",
  "office_name",
  "office_location",
  "job_role",
] as const;

export type IdentityField = (typeof IDENTITY_FIELDS)[number];
