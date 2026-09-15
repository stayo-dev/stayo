import { prisma } from "../db";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";

export class BaseService {
  protected db = prisma;
}

/**
 * Columns no profile response may carry: `password_hash` can be cracked
 * offline, a live `invitation_token` activates the account, and
 * `auth_user_id` is the identity link itself. Stripped after the read rather
 * than excluded by a `select`, so the query itself is unchanged.
 */
const CREDENTIAL_FIELDS = ["password_hash", "invitation_token", "auth_user_id"] as const;

function withoutCredentials<T extends Record<string, any>>(profile: T): Omit<T, (typeof CREDENTIAL_FIELDS)[number]> {
  const safe: Record<string, any> = { ...profile };
  for (const field of CREDENTIAL_FIELDS) delete safe[field];
  return safe as Omit<T, (typeof CREDENTIAL_FIELDS)[number]>;
}

/**
 * Example UserService for handling profile-related operations
 */
export class UserService extends BaseService {
  async getProfile(userId: string) {
    const profile = await this.db.profile.findUnique({
      where: { id: userId },
    });
    if (!profile) return null;

    // Fetched separately rather than via a filtered `include` — Prisma's
    // relationJoins preview feature flattens a filtered to-many relation
    // into a single JSON object instead of an array here, which crashes
    // every consumer expecting `tenants` to be a list.
    const liveTenancy = await getActiveTenancy(profile.id);
    return { ...withoutCredentials(profile), tenants: liveTenancy ? [liveTenancy] : [] };
  }

  async updateProfile(userId: string, data: any) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid profile update payload");
    }

    // `email` and `phone` are sign-in identifiers, so they are deliberately
    // absent: email changes go through the OTP-verified
    // `/api/profile/contact/email/*` flow, phone through `PATCH /api/profile`,
    // which resets `phone_verified`. Writing them here unverified is what let
    // one account's email be pointed at another person's inbox.
    const allowedFields = [
      "name",
      "address",
      "city",
      "state",
      "pincode",
      "emergency_contact",
      "is_profile_completed"
    ];

    const filteredData: Record<string, any> = {};
    for (const key of allowedFields) {
      if (key in data) {
        filteredData[key] = data[key];
      }
    }

    const updated = await this.db.profile.update({
      where: { id: userId },
      data: filteredData,
    });
    return withoutCredentials(updated);
  }
}

export const userService = new UserService();
