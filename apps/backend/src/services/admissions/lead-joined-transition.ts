import { prisma } from "@/lib/db";

type VisitorLeadUpdateManyClient = {
  visitorLead: {
    updateMany: (args: {
      where: { converted_tenant_id: string };
      data: { status: string; updated_at: Date };
    }) => Promise<{ count: number }>;
  };
};

/**
 * Marks every lead that converted into this tenant JOINED once activation
 * completes. Takes `db` so a caller inside a transaction (`completeActivation`
 * in `tenant-invitation-lifecycle-service.ts`) can pass its own `tx` and have
 * this write commit or roll back atomically with the tenant's own ACTIVE
 * flip — same rationale as `assertEmailAvailableForProfile` in that same
 * file. Its own leaf module, not a method called directly from there,
 * because `admissions-service.ts` already transitively imports
 * `tenant-invitation-lifecycle-service.ts` via `invitation-service.ts` —
 * importing back from there would create a circular import.
 */
export async function markLeadJoinedForTenant(tenantId: string, db: VisitorLeadUpdateManyClient = prisma) {
  await db.visitorLead.updateMany({
    where: { converted_tenant_id: tenantId },
    data: { status: "JOINED", updated_at: new Date() },
  });
}
