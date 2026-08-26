import { normalizeIndianPhone } from "@/lib/utils/phone-utils";

/**
 * Where a tenant's name and phone live depends on whether they have an account.
 *
 * A SELF_SERVE tenant carries them on `profiles`. An OWNER_MANAGED tenant has
 * `profile_id: null` by design — their details live on the tenancy itself
 * (`display_name`, `phone_1`), put there by the owner. Reaching into
 * `tenant.profiles` directly is what made every reminder to an owner-managed
 * tenant skip with TENANT_PHONE_MISSING.
 */
export interface TenantIdentityLike {
  display_name?: string | null;
  phone_1?: string | null;
  profiles?: { name?: string | null; phone?: string | null } | null;
  tenant_invitations?: { name?: string | null; phone?: string | null }[] | null;
}

function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return null;
}

/** Never blank: a reminder addresses a person, and "" reads as a bug to the tenant. */
export function resolveTenantName(tenant: TenantIdentityLike): string {
  return firstNonBlank(
    tenant.profiles?.name,
    tenant.display_name,
    tenant.tenant_invitations?.[0]?.name,
  ) ?? "Tenant";
}

/** E.164 (`+91XXXXXXXXXX`), or null when no complete number is known. */
export function resolveTenantPhone(tenant: TenantIdentityLike): string | null {
  const candidate = firstNonBlank(
    tenant.profiles?.phone,
    tenant.phone_1,
    tenant.tenant_invitations?.[0]?.phone,
  );
  return candidate ? normalizeIndianPhone(candidate) : null;
}
