import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";
import { IDENTITY_FIELDS, type IdentityField } from "./identity-fields";

/**
 * The portable half of a Stayo account (phase B).
 *
 * Identity used to live on `tenants`, which since migration 062 is one row per
 * tenancy per hostel — so a person moving to a second hostel re-typed
 * everything Stayo already knew. `profile_identity` is now the source of
 * truth; the matching `tenants.*` columns stay as **the snapshot of what was
 * true when that tenancy began**, which is what agreements and history need.
 *
 * The primary requirement this serves: a tenant can complete their profile
 * **before enquiring to any hostel at all**, and onboarding reads it as
 * defaults instead of asking again.
 */

// Re-export so existing importers keep working unchanged
export { IDENTITY_FIELDS, type IdentityField };

export type IdentityPatch = Partial<Record<IdentityField, unknown>>;

/**
 * Which fields must be present for onboarding to skip asking. Deliberately
 * narrow: this gates a *convenience*, so demanding a complete profile before
 * anything prefills would defeat the point.
 */
const CORE_FIELDS: IdentityField[] = [
  "date_of_birth",
  "gender",
  "permanent_address",
  "guardian_name",
  "guardian_phone",
];

/** Optional fields relevant to everyone, regardless of student/professional. */
const GENERAL_OPTIONAL_FIELDS: IdentityField[] = [
  "nationality",
  "pan_number",
  "photo_url",
  "personal_email",
  "guardian_relation",
  "profile_type",
];

const ACADEMIC_FIELDS: IdentityField[] = ["college_name", "roll_number", "course", "year_of_study", "branch", "section"];
const PROFESSIONAL_FIELDS: IdentityField[] = ["office_name", "office_location", "job_role"];

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Drop keys that aren't identity fields, and blanks — see `update`'s contract. */
function sanitisePatch(patch: IdentityPatch): IdentityPatch {
  const clean: IdentityPatch = {};
  for (const field of IDENTITY_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (isBlank(value)) continue;
    clean[field] = typeof value === "string" ? value.trim() : value;
  }
  return clean;
}

/**
 * Which tenancy stands in for a person who has not been backfilled yet: the
 * live one, else the most recently created.
 *
 * Written as explicit precedence rather than `orderBy: { status: 'asc' }` —
 * `TenantStatus` declares `INVITED` before `ACTIVE`, so sorting on the enum
 * would have preferred a tenancy the person never activated over the one they
 * actually live in.
 *
 * The same precedence is used by `scripts/backfill-profile-identity.ts`, so a
 * read before the backfill and a read after it agree on which values win.
 */
async function selectFallbackTenancy(profileId: string) {
  const live = await prisma.tenants.findFirst({
    where: { profile_id: profileId, status: { in: ["INVITED", "ACTIVE"] } },
    orderBy: { created_at: "desc" },
  });
  if (live) return live;

  return prisma.tenants.findFirst({
    where: { profile_id: profileId },
    orderBy: { created_at: "desc" },
  });
}

export class ProfileIdentityService {
  /**
   * The person's identity, profile-first with a tenancy fallback.
   *
   * The fallback exists because the backfill is a separate, dry-run-by-default
   * script (a person with two past tenancies can hold two conflicting values,
   * and there is no universally correct winner). Until it has run for someone,
   * their most recent tenancy is still the best record we have — reading it
   * keeps every screen populated instead of showing a half-migrated blank.
   */
  async getIdentity(profileId: string) {
    const [identity, fallbackTenancy] = await Promise.all([
      prisma.profile_identity.findUnique({ where: { profile_id: profileId } }),
      selectFallbackTenancy(profileId),
    ]);

    const merged: Record<string, unknown> = {};
    const sourcedFromTenancy: string[] = [];

    for (const field of IDENTITY_FIELDS) {
      const own = identity ? (identity as any)[field] : null;
      if (!isBlank(own)) {
        merged[field] = own;
        continue;
      }
      const inherited = fallbackTenancy ? (fallbackTenancy as any)[field] : null;
      if (!isBlank(inherited)) {
        merged[field] = inherited;
        sourcedFromTenancy.push(field);
        continue;
      }
      merged[field] = null;
    }

    const missingCore = CORE_FIELDS.filter((field) => isBlank(merged[field]));

    /**
     * A single numeric completion percentage — the canonical source other
     * surfaces (the Explore/Profile nudge, the Dashboard nudge card) both
     * read instead of each computing their own (three different ad hoc
     * versions existed before this). Denominator is profile-type-aware:
     * core fields + general-optional fields + whichever of
     * academic/professional actually applies — not all 20 `IDENTITY_FIELDS`
     * naively, which would cap a working professional under 100% for never
     * having `college_name` (and vice versa for a student).
     */
    const profileType = merged.profile_type === "WORKING_PROFESSIONAL" ? "WORKING_PROFESSIONAL" : "STUDENT";
    const relevantFields: IdentityField[] = [
      ...CORE_FIELDS,
      ...GENERAL_OPTIONAL_FIELDS,
      ...(profileType === "WORKING_PROFESSIONAL" ? PROFESSIONAL_FIELDS : ACADEMIC_FIELDS),
    ];
    const filledCount = relevantFields.filter((field) => !isBlank(merged[field])).length;
    const completionPercent = Math.round((filledCount / relevantFields.length) * 100);

    return {
      ...merged,
      /** True once every CORE_FIELD is present — what onboarding checks. */
      is_complete: missingCore.length === 0,
      missing_core_fields: missingCore,
      /** 0-100, profile-type-aware — see comment above. */
      completion_percent: completionPercent,
      /**
       * Fields still being read off a tenancy because the backfill has not run
       * for this person. Surfaced rather than hidden so the transition's end is
       * observable instead of guessed at.
       */
      pending_backfill_fields: sourcedFromTenancy,
      has_profile_record: Boolean(identity),
    };
  }

  /**
   * Create or update the person's identity.
   *
   * **Blank values are dropped, never written.** Onboarding writes back to this
   * record (see `absorbFromTenancy`), and its forms ask for a subset of these
   * fields — so treating an absent field as "clear it" would let a short form
   * silently wipe details the person entered on a longer one.
   *
   * Clearing a field deliberately therefore needs its own explicit path; there
   * is no product surface for it yet, so there is no code for it yet.
   */
  async update(profileId: string, patch: IdentityPatch) {
    const data = sanitisePatch(patch);
    if (Object.keys(data).length === 0) {
      throw ApiError.validationError("Nothing to update");
    }

    if (data.date_of_birth) {
      const parsed = new Date(data.date_of_birth as string);
      if (Number.isNaN(parsed.getTime())) throw ApiError.validationError("Date of birth is not a valid date");
      if (parsed > new Date()) throw ApiError.validationError("Date of birth cannot be in the future");
      data.date_of_birth = parsed;
    }

    if (data.year_of_study != null) {
      const year = Number(data.year_of_study);
      if (!Number.isInteger(year) || year < 1 || year > 10) {
        throw ApiError.validationError("Year of study must be between 1 and 10");
      }
      data.year_of_study = year;
    }

    if (data.profile_type && !["STUDENT", "WORKING_PROFESSIONAL"].includes(String(data.profile_type))) {
      throw ApiError.validationError("Profile type must be STUDENT or WORKING_PROFESSIONAL");
    }

    await prisma.profile_identity.upsert({
      where: { profile_id: profileId },
      create: { profile_id: profileId, ...(data as any) },
      update: { ...(data as any), updated_at: new Date() },
    });

    return this.getIdentity(profileId);
  }

  /**
   * Fold what a tenant just confirmed during onboarding back into their
   * portable profile, so the hostel *after* this one is prefilled even though
   * this one wasn't.
   *
   * Same non-null-only rule as `update`: onboarding must never blank a field
   * the person filled on the profile screen and this form did not ask about.
   */
  async absorbFromTenancy(profileId: string, tenancy: Record<string, unknown>) {
    const patch: IdentityPatch = {};
    for (const field of IDENTITY_FIELDS) {
      if (!isBlank(tenancy[field])) patch[field] = tenancy[field];
    }
    if (Object.keys(patch).length === 0) return null;
    return this.update(profileId, patch);
  }

  /**
   * The defaults an onboarding form should open with. Same data as
   * `getIdentity`, named for the one job it does at the call site.
   */
  async getOnboardingDefaults(profileId: string) {
    return this.getIdentity(profileId);
  }
}

export const profileIdentityService = new ProfileIdentityService();
