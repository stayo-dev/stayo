import { IDENTITY_FIELDS } from "../profile/identity-fields";

/**
 * What onboarding already knows about the person in front of it, and where
 * each fact came from.
 *
 * Deliberately pure — no Prisma, no I/O — so it runs under `test:pure` with no
 * database. `getContext()` supplies the rows; this decides what they mean.
 *
 * The point of `source_of` is that not all prefill is equal. A value the person
 * entered on their own profile deserves to be shown as "we already know this";
 * a value an owner typed into an invite is a guess, and presenting the two with
 * the same confidence is how wrong data gets confirmed by a tired tenant.
 */

export type KnownSource = "PROFILE" | "TENANCY" | "INVITE";

export interface OnboardingKnown {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** True only when the number we are offering is the number we verified. */
  phone_verified: boolean;
  identity: Record<string, unknown>;
  /** Enough here to be worth showing as "we already know this". */
  has_prefill: boolean;
  /** Only fields that actually have a value appear here. */
  source_of: Record<string, KnownSource>;
}

interface ProfileLike {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile_verified?: boolean | null;
  phone_verified?: boolean | null;
}

interface IdentityLike extends Record<string, unknown> {
  pending_backfill_fields?: string[];
  has_profile_record?: boolean;
}

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** Last ten digits — the comparable form of an Indian mobile number. */
const last10 = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(-10);

export function buildKnown(input: {
  profile: ProfileLike | null;
  tenant: Record<string, unknown>;
  invitation: { name?: string | null; email?: string | null; phone?: string | null } | null;
  identity: IdentityLike | null;
}): OnboardingKnown {
  const { profile, tenant, invitation, identity } = input;
  const source_of: Record<string, KnownSource> = {};

  const pick = (field: string, fromProfile: unknown, fromInvite: unknown, fromTenant?: unknown) => {
    if (!isBlank(fromProfile)) {
      source_of[field] = "PROFILE";
      return fromProfile;
    }
    if (!isBlank(fromInvite)) {
      source_of[field] = "INVITE";
      return fromInvite;
    }
    if (!isBlank(fromTenant)) {
      source_of[field] = "TENANCY";
      return fromTenant;
    }
    return null;
  };

  const name = pick("name", profile?.name, invitation?.name) as string | null;
  const email = pick("email", profile?.email, invitation?.email) as string | null;
  const rawPhone = pick("phone", profile?.phone, invitation?.phone, tenant?.phone_1);
  const phone = rawPhone ? last10(rawPhone) : null;

  // Verified means *this* number is verified. A profile flagged verified whose
  // phone column is empty tells us nothing about the tenancy's number.
  const profilePhone = last10(profile?.phone);
  const phone_verified = Boolean(
    (profile?.mobile_verified || profile?.phone_verified) && profilePhone && profilePhone === phone,
  );

  const identityOut: Record<string, unknown> = {};
  const backfilled = new Set(identity?.pending_backfill_fields ?? []);
  for (const field of IDENTITY_FIELDS) {
    const value = identity ? identity[field] : null;
    if (isBlank(value)) {
      identityOut[field] = null;
      continue;
    }
    identityOut[field] = value;
    source_of[field] = backfilled.has(field) ? "TENANCY" : "PROFILE";
  }

  return {
    name,
    email,
    phone,
    phone_verified,
    identity: identityOut,
    has_prefill: Boolean(identity?.has_profile_record) || backfilled.size > 0,
    source_of,
  };
}
