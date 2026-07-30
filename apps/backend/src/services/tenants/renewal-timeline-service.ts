/**
 * Append-only audit trail for the Agreement Renewal subsystem. Closes the
 * gap where owner-side offer actions had no queryable DB record at all
 * (only logger.info() lines) and tenant-side actions were only partially
 * captured in RenewalDecision. See
 * docs/business-logic/renewal-management-workspace-gap-analysis.md S1.6.
 *
 * registerEvent() must be called with the same `tx` the caller's mutation
 * is already running inside wherever one exists — it deliberately does not
 * swallow its own errors, so a failed timeline write rolls back together
 * with the mutation it describes, rather than silently drifting from it
 * (the "audit writes must be transactionally coupled" finding).
 */

export type RenewalTimelineEventType =
  | "OFFER_CREATED"
  | "OFFER_SENT"
  | "OFFER_DISCUSSED"
  | "OFFER_REVISED"
  | "OFFER_ACCEPTED"
  | "OFFER_DECLINED"
  | "OFFER_EXPIRED"
  | "DRAFT_CREATED"
  | "RENEWAL_ACTIVATED"
  | "RENEWAL_ACTIVATION_BLOCKED";

export type RenewalTimelineActorType = "OWNER" | "TENANT" | "SYSTEM";

export type RegisterRenewalTimelineEventParams = {
  hostelId: string;
  tenantId: string;
  agreementId?: string | null;
  offerId?: string | null;
  eventType: RenewalTimelineEventType;
  actorType: RenewalTimelineActorType;
  actorId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type GetRenewalTimelineParams = {
  tenantId?: string;
  agreementId?: string;
  offerId?: string;
  limit?: number;
};

export class RenewalTimelineService {
  async registerEvent(tx: any, params: RegisterRenewalTimelineEventParams) {
    return tx.renewalTimelineEvent.create({
      data: {
        hostel_id: params.hostelId,
        tenant_id: params.tenantId,
        agreement_id: params.agreementId ?? null,
        offer_id: params.offerId ?? null,
        event_type: params.eventType,
        actor_type: params.actorType,
        actor_id: params.actorId ?? null,
        reason: params.reason ?? null,
        metadata: params.metadata ?? null,
      },
    });
  }

  async getTimeline(db: any, params: GetRenewalTimelineParams) {
    const where: Record<string, string> = {};
    if (params.tenantId) where.tenant_id = params.tenantId;
    if (params.agreementId) where.agreement_id = params.agreementId;
    if (params.offerId) where.offer_id = params.offerId;

    return db.renewalTimelineEvent.findMany({
      where,
      orderBy: { created_at: "asc" },
      take: params.limit || 200,
    });
  }
}

export const renewalTimelineService = new RenewalTimelineService();
