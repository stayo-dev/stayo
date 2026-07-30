import { prisma } from "../db";

export class BaseService {
  protected db = prisma;
}

/**
 * Example UserService for handling profile-related operations
 */
export class UserService extends BaseService {
  async getProfile(userId: string) {
    return this.db.profile.findUnique({
      where: { id: userId },
      include: { tenants: true },
    });
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
