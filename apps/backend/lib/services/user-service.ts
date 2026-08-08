import { prisma } from "../db";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";

export class BaseService {
  protected db = prisma;
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
    return { ...profile, tenants: liveTenancy ? [liveTenancy] : [] };
  }

  async updateProfile(userId: string, data: any) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid profile update payload");
    }

    const allowedFields = [
      "name",
      "email",
      "phone",
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

    return this.db.profile.update({
      where: { id: userId },
      data: filteredData,
    });
  }
}

export const userService = new UserService();
