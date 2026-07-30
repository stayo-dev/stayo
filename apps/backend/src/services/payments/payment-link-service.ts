import { prisma } from "@/lib/db";

export class PaymentLinkService {
  /**
   * Finds or creates an active payment link token for a tenant.
   * `obligationId`, if provided, is stored only as a default-amount hint —
   * the payer can always pay any amount on the resulting page, FIFO-allocated
   * across whatever the tenant actually owes at payment time.
   */
  static async getOrCreateToken(params: {
    obligationId?: string;
    tenantId?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const { obligationId, tenantId } = params;

    if (!obligationId && !tenantId) {
      throw new Error("Either obligationId or tenantId must be provided");
    }

    let targetTenantId = tenantId;

    // If only an obligation was given, resolve its tenant.
    if (obligationId && !targetTenantId) {
      const obligation = await prisma.rent_obligations.findUnique({
        where: { id: obligationId },
        select: { tenant_id: true },
      });
      if (!obligation) {
        throw new Error("Obligation not found");
      }
      targetTenantId = obligation.tenant_id;
    }

    if (!targetTenantId) {
      throw new Error("Could not resolve tenant");
    }

    // Reuse an existing non-expired token for this (tenant, obligation-hint) pair.
    const existing = await prisma.payment_link_tokens.findFirst({
      where: {
        tenant_id: targetTenantId,
        obligation_id: obligationId ?? null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    });

    if (existing) {
      return {
        token: existing.token,
        expiresAt: existing.expires_at,
      };
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: targetTenantId },
      select: { hostel_id: true, owner_id: true },
    });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    if (!tenant.owner_id) {
      throw new Error("Tenant has no associated owner");
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const created = await prisma.payment_link_tokens.create({
      data: {
        obligation_id: obligationId ?? null,
        tenant_id: targetTenantId,
        hostel_id: tenant.hostel_id,
        owner_id: tenant.owner_id,
        expires_at: expiresAt,
      },
      select: { token: true, expires_at: true },
    });

    return {
      token: created.token,
      expiresAt: created.expires_at,
    };
  }
}
