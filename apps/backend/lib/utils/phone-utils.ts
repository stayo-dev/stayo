import { prisma } from "../db";

/**
 * Normalizes an Indian phone number to E.164 format (+91XXXXXXXXXX)
 */
export function normalizeIndianPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = String(value).replace(/\D/g, "");
  
  if (cleaned.length === 10) return `+91${cleaned}`;
  if (cleaned.length === 12 && cleaned.startsWith("91")) return `+${cleaned}`;
  if (cleaned.length === 13 && cleaned.startsWith("091")) return `+${cleaned.substring(1)}`;
  
  return null;
}

/**
 * Validates that a guardian's phone number is not the phone number of any tenant in the database.
 */
export async function assertGuardianPhoneNotTenant(
  guardianPhone: string | null | undefined,
  tenantId?: string
): Promise<void> {
  if (!guardianPhone) return;
  const normalized = normalizeIndianPhone(guardianPhone);
  if (!normalized) return;

  if (tenantId) {
    const existingTenant = await prisma.tenants.findFirst({
      where: {
        id: tenantId,
        OR: [
          { phone_1: normalized },
          { profiles: { phone: normalized } }
        ]
      },
      select: {
        id: true,
        profiles: {
          select: {
            name: true
          }
        }
      }
    });

    if (existingTenant) {
      throw new Error(
        `VALIDATION_ERROR: Guardian phone number cannot be the same as a tenant's phone number (${existingTenant.profiles?.name || "another tenant"})`
      );
    }
  } else {
    const existingTenant = await prisma.tenants.findFirst({
      where: {
        OR: [
          { phone_1: normalized },
          { profiles: { phone: normalized } }
        ]
      },
      select: {
        id: true,
        profiles: {
          select: {
            name: true
          }
        }
      }
    });

    if (existingTenant) {
      throw new Error(
        `VALIDATION_ERROR: Guardian phone number cannot be the same as a tenant's phone number (${existingTenant.profiles?.name || "another tenant"})`
      );
    }
  }
}

