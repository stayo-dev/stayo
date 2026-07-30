import { prisma } from "@/lib/db";
import { financialReadModelService } from "@/src/services/payments/financial-read-model-service";
import { renewalTimelineService } from "@/src/services/tenants/renewal-timeline-service";
import { evaluateActivationReadiness } from "@/src/services/tenants/renewal-readiness-engine";

/**
 * Read model for the Individual Renewal Workspace — composes the current
 * agreement, its offer history, timeline, financial summary, documents, and
 * (when a successor draft exists) activation readiness into one bundle, so
 * the frontend detail page needs a single fetch. Follows the same
 * "compose, don't reimplement" pattern as financial-read-model-service.ts:
 * every figure here is delegated to the service that already owns it.
 */
class RenewalWorkspaceReadModelService {
  async getWorkspace(agreementId: string, ownerId: string) {
    const agreement = await prisma.agreement.findFirst({
      where: { id: agreementId, hostel: { owner_id: ownerId } },
      include: {
        hostel: { select: { id: true, name: true } },
        tenant: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { id: true, room_no: true, room_type: true } } },
              take: 1,
            },
          },
        },
        renewed_to_agreement: true,
      },
    });

    if (!agreement) throw new Error("NOT_FOUND: Renewal not found");

    const [offers, timeline, financial, documents] = await Promise.all([
      prisma.renewalOffer.findMany({
        where: { agreement_id: agreementId },
        orderBy: { created_at: "desc" },
      }),
      renewalTimelineService.getTimeline(prisma, { agreementId }),
      financialReadModelService.getFinancialReadModel(agreement.tenant_id, ownerId, agreement.hostel_id),
      prisma.identificationDocument.findMany({
        where: { tenant_id: agreement.tenant_id, is_active: true },
        orderBy: { created_at: "desc" },
      }),
    ]);

    const latestOffer =
      offers.find((o) => !["SUPERSEDED", "DECLINED", "EXPIRED"].includes(o.status)) || offers[0] || null;

    // Activation readiness only means something once a successor draft
    // exists to activate — before that there's nothing to check readiness
    // *for*, so we deliberately leave this null rather than misuse the
    // engine against a precondition shape it wasn't built to answer.
    let readiness: Awaited<ReturnType<typeof evaluateActivationReadiness>> | null = null;
    if (agreement.renewed_to_agreement) {
      readiness = await evaluateActivationReadiness(prisma, {
        predecessor: agreement,
        successor: agreement.renewed_to_agreement,
      });
    }

    const roomAllocation = agreement.tenant?.room_allocations?.[0] || null;

    return {
      agreement: {
        id: agreement.id,
        status: agreement.status,
        agreement_version: agreement.agreement_version,
        agreement_start_date: agreement.agreement_start_date,
        agreement_end_date: agreement.agreement_end_date,
        agreement_duration_months: agreement.agreement_duration_months,
        contract_rent: agreement.contract_rent,
        contract_security_deposit: agreement.contract_security_deposit,
        contract_maintenance: agreement.contract_maintenance,
        contract_maintenance_type: agreement.contract_maintenance_type,
        renewed_to_agreement_id: agreement.renewed_to_agreement_id,
      },
      successorAgreement: agreement.renewed_to_agreement
        ? {
            id: agreement.renewed_to_agreement.id,
            status: agreement.renewed_to_agreement.status,
            agreement_start_date: agreement.renewed_to_agreement.agreement_start_date,
            agreement_end_date: agreement.renewed_to_agreement.agreement_end_date,
            contract_rent: agreement.renewed_to_agreement.contract_rent,
            contract_security_deposit: agreement.renewed_to_agreement.contract_security_deposit,
          }
        : null,
      tenant: {
        id: agreement.tenant.id,
        name: agreement.tenant.profiles?.name || null,
        phone: agreement.tenant.profiles?.phone || null,
        room: roomAllocation?.room
          ? { id: roomAllocation.room.id, room_no: roomAllocation.room.room_no, room_type: roomAllocation.room.room_type }
          : null,
      },
      hostel: agreement.hostel,
      offers,
      latestOffer,
      timeline,
      financial,
      documents,
      readiness,
    };
  }
}

export const renewalWorkspaceReadModelService = new RenewalWorkspaceReadModelService();
