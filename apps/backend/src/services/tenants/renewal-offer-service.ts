import { prisma } from "@/lib/db";
import { Prisma, DepositRefundPolicy, RenewalNotificationTarget } from "@prisma/client";
import { getLogger } from "@/lib/logger";
import { randomUUID } from "crypto";
import { currentAgreementWhere } from "./agreement-status";
import { renewalTimelineService } from "./renewal-timeline-service";

const logger = getLogger("renewal-offer");

export type ProposedTerms = {
  proposed_rent?: number;
  proposed_security_deposit?: number;
  proposed_maintenance?: number;
  proposed_maintenance_type?: string;
  proposed_duration_months?: number;
  proposed_payment_frequency?: string;
  proposed_start_date?: string | Date;
  effective_from?: string | Date;
  owner_notes?: string;
  deposit_refund_policy?: DepositRefundPolicy;
  notification_target?: RenewalNotificationTarget;
  offer_expires_at?: string | Date;
};

export type RenewalStrategy = "FLAT" | "PERCENTAGE" | "ROOM_CATEGORY" | "FLOOR_WISE" | "ROOM_WISE";

export type BulkOfferInput = {
  ownerId: string;
  hostelId: string;
  renewal_strategy: RenewalStrategy;
  proposed_duration_months: number;
  proposed_deposit?: number;
  // FLAT strategy
  proposed_rent?: number;
  // PERCENTAGE strategy
  rent_increase_percent?: number;
  // ROOM_CATEGORY strategy
  category_rents?: Record<string, number>; // { "G1": 8500, "G2": 7500, "AC": 12000 }
  // FLOOR_WISE strategy — keyed by the floor's display name (`floors.name`),
  // falling back to "Floor <n>" for rooms with only the legacy `floor` int.
  floor_rents?: Record<string, number>;
  // ROOM_WISE strategy — keyed by exact room_no, for owners who want to set
  // a bespoke rent per room in one bulk pass instead of the single-offer flow.
  room_rents?: Record<string, number>;
  filterCriteria?: { roomCategory?: string; expiringWithinDays?: number; agreementIds?: string[] };
  title?: string;
  deposit_refund_policy?: DepositRefundPolicy;
  notification_target?: RenewalNotificationTarget;
};

const ACTIVE_OFFER_STATUSES = ["DRAFT", "SENT"] as const;

export class RenewalOfferService {
  constructor(private readonly db = prisma) {}

  /**
   * Resolves a template based on category matching and active/published status.
   * If type = "RENEWAL" exists for the category, use it. Else fallback to "RESIDENCY".
   * Also checks date ranges if templates have effective_from/to set.
   */
  async _resolveTemplate(hostelId: string, roomCategory: string | null, effectiveFrom: Date) {
    return this._resolveTemplateInTx(this.db, hostelId, roomCategory, effectiveFrom);
  }

  async _resolveTemplateInTx(tx: Prisma.TransactionClient, hostelId: string, roomCategory: string | null, effectiveFrom: Date) {
    const templates = await tx.agreementTemplate.findMany({
      where: {
        hostel_id: hostelId,
        status: "PUBLISHED",
        is_active: true,
      },
    });

    const validTemplates = templates.filter((t) => {
      const startOk = t.effective_from <= effectiveFrom;
      const endOk = !t.effective_to || effectiveFrom <= t.effective_to;
      return startOk && endOk;
    });

    if (roomCategory) {
      const matchRenewalCat = validTemplates.find((t) => t.type === "RENEWAL" && t.room_category === roomCategory);
      if (matchRenewalCat) return matchRenewalCat;

      const matchResidencyCat = validTemplates.find((t) => t.type === "RESIDENCY" && t.room_category === roomCategory);
      if (matchResidencyCat) return matchResidencyCat;
    }

    const matchRenewalDefault = validTemplates.find((t) => t.type === "RENEWAL" && (!t.room_category || t.room_category === ""));
    if (matchRenewalDefault) return matchRenewalDefault;

    const matchResidencyDefault = validTemplates.find((t) => t.type === "RESIDENCY" && (!t.room_category || t.room_category === ""));
    if (matchResidencyDefault) return matchResidencyDefault;

    return null;
  }

  /**
   * Generate a renewal offer for a single agreement.
   */
  async generateOffer(agreementId: string, ownerId: string, proposed: ProposedTerms) {
    const agreement = await this.db.agreement.findUnique({
      where: { id: agreementId },
      include: {
        hostel: { select: { id: true, owner_id: true } },
        tenant: {
          select: {
            id: true, security_deposit: true,
            tenant_financial_ledger: {
              where: { type: "CREDIT", reason: { in: ["SECURITY_DEPOSIT_COLLECTED", "SECURITY_DEPOSIT_TOPUP"] } },
              select: { amount: true },
            },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true, room_type: true } } },
              take: 1,
            },
          },
        },
        renewal_offers_source: {
          where: { status: { in: [...ACTIVE_OFFER_STATUSES] } },
          take: 1,
        },
      },
    });

    if (!agreement) throw new Error("NOT_FOUND: Agreement not found");
    if (agreement.hostel.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your agreement");
    if (agreement.renewal_offers_source.length > 0) {
      throw new Error("CONFLICT: An active renewal offer already exists. Revise or supersede it instead.");
    }

    const currentStatuses = [...(currentAgreementWhere() as any).in];
    if (!currentStatuses.includes(agreement.status)) {
      throw new Error(`BAD_REQUEST: Agreement status ${agreement.status} is not eligible for renewal offers`);
    }

    const currentEndDate = agreement.agreement_end_date;
    const effectiveFrom = proposed.effective_from
      ? new Date(proposed.effective_from)
      : (currentEndDate || new Date());
    const proposedStartDate = proposed.proposed_start_date
      ? new Date(proposed.proposed_start_date)
      : effectiveFrom;

    // Resolve template and default values
    const roomCategory = agreement.tenant?.room_allocations?.[0]?.room?.room_type || null;
    const template = await this._resolveTemplate(agreement.hostel_id, roomCategory, effectiveFrom);

    if (roomCategory && !template) {
      throw new Error("BAD_REQUEST: No active agreement template covers the proposed effective date for this room category");
    }

    const activeContract = getAgreementContract(agreement);
    const templateRent = template?.default_rent ? Number(template.default_rent) : Number(activeContract.rent || 0);
    const templateDeposit = template?.default_security_deposit ? Number(template.default_security_deposit) : Number(activeContract.security_deposit || 0);
    const templateDuration = template?.default_duration_months || Number(agreement.agreement_duration_months || 6);

    const proposedRent = proposed.proposed_rent ?? templateRent;
    const proposedDeposit = proposed.proposed_security_deposit ?? templateDeposit;
    const proposedDuration = proposed.proposed_duration_months ?? templateDuration;
    const proposedEndDate = addMonths(proposedStartDate, proposedDuration);

    const depositHeld = this._computeDepositHeld(agreement.tenant);
    const additionalDeposit = Math.max(0, proposedDeposit - depositHeld);
    const depositRefund = Math.max(0, depositHeld - proposedDeposit);

    const offer = await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.renewalOffer.create({
        data: {
          id: randomUUID(),
          agreement_id: agreementId,
          tenant_id: agreement.tenant_id,
          hostel_id: agreement.hostel_id,
          owner_id: ownerId,
          proposed_rent: proposedRent,
          proposed_security_deposit: proposedDeposit,
          proposed_maintenance: proposed.proposed_maintenance ?? Number(activeContract.maintenance || 0),
          proposed_maintenance_type: proposed.proposed_maintenance_type || agreement.contract_maintenance_type || null,
          proposed_duration_months: proposedDuration,
          proposed_start_date: proposedStartDate,
          proposed_end_date: proposedEndDate,
          proposed_payment_frequency: proposed.proposed_payment_frequency || null,
          effective_from: effectiveFrom,
          current_rent: Number(activeContract.rent || 0),
          current_security_deposit: Number(activeContract.security_deposit || 0),
          current_maintenance: Number(activeContract.maintenance || 0),
          deposit_held: depositHeld,
          additional_deposit_required: additionalDeposit,
          deposit_refund_eligible: depositRefund,
          deposit_refund_policy: proposed.deposit_refund_policy || "KEEP_AS_CREDIT",
          notification_target: proposed.notification_target || "TENANT",
          status: "DRAFT",
          offer_expires_at: proposed.offer_expires_at ? new Date(proposed.offer_expires_at) : addDays(new Date(), 15),
          owner_notes: proposed.owner_notes || null,
        },
      });

      await renewalTimelineService.registerEvent(tx, {
        hostelId: agreement.hostel_id,
        tenantId: agreement.tenant_id,
        agreementId,
        offerId: created.id,
        eventType: "OFFER_CREATED",
        actorType: "OWNER",
        actorId: ownerId,
        metadata: { proposedRent, additionalDeposit },
      });

      return created;
    });

    logger.info("renewal-offer.generated", {
      offer_id: offer.id, agreement_id: agreementId, tenant_id: agreement.tenant_id,
      proposed_rent: proposedRent, deposit_delta: additionalDeposit,
    });
    return offer;
  }

  /**
   * Generate bulk renewal offers with strategy support:
   * FLAT — same proposed_rent for all
   * PERCENTAGE — increase current rent by X%
   * ROOM_CATEGORY — different rent per room type
   * FLOOR_WISE — different rent per floor (`floors.name`, or "Floor <n>" for rooms with only the legacy `floor` int)
   * ROOM_WISE — different rent per exact room number, for bespoke per-room bulk pricing
   */
  async generateBulkOffers(input: BulkOfferInput) {
    const { ownerId, hostelId, renewal_strategy, filterCriteria = {} } = input;

    const hostel = await this.db.hostels.findUnique({
      where: { id: hostelId }, select: { owner_id: true },
    });
    if (!hostel) throw new Error("NOT_FOUND: Hostel not found");
    if (hostel.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your hostel");

    const agreementWhere: any = {
      hostel_id: hostelId,
      status: currentAgreementWhere(),
      agreement_end_date: { not: null },
      renewal_offers_source: { none: { status: { in: [...ACTIVE_OFFER_STATUSES] } } },
    };
    if (filterCriteria.expiringWithinDays) {
      agreementWhere.agreement_end_date = { not: null, lte: addDays(new Date(), filterCriteria.expiringWithinDays) };
    }
    // Owner selected specific tenants in the queue rather than "everyone
    // matching a filter" — ANDed onto the existing hostel/status scoping
    // above, so a bogus/foreign id just yields fewer rows, never a leak.
    if (filterCriteria.agreementIds?.length) {
      agreementWhere.id = { in: filterCriteria.agreementIds };
    }

    const agreements = await this.db.agreement.findMany({
      where: agreementWhere,
      include: {
        tenant: {
          select: {
            id: true, security_deposit: true,
            tenant_financial_ledger: {
              where: { type: "CREDIT", reason: { in: ["SECURITY_DEPOSIT_COLLECTED", "SECURITY_DEPOSIT_TOPUP"] } },
              select: { amount: true },
            },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: {
                room: {
                  select: {
                    room_no: true,
                    room_type: true,
                    floor: true,
                    floor_ref: { select: { name: true } },
                  },
                },
              },
              take: 1,
            },
          },
        },
      },
    });

    if (agreements.length === 0) return { batch: null, offersGenerated: 0, message: "No eligible agreements found" };

    let filtered = agreements;
    if (filterCriteria.roomCategory) {
      filtered = agreements.filter((a) => a.tenant?.room_allocations?.[0]?.room?.room_type === filterCriteria.roomCategory);
    }

    return this.db.$transaction(async (tx) => {
      const batch = await tx.bulkRenewalBatch.create({
        data: {
          id: randomUUID(), owner_id: ownerId, hostel_id: hostelId,
          title: input.title || `Bulk Renewal - ${new Date().toLocaleDateString("en-IN")}`,
          filter_criteria: filterCriteria as any,
          renewal_strategy,
          proposed_rent: input.proposed_rent ?? null,
          proposed_deposit: input.proposed_deposit ?? null,
          proposed_duration_months: input.proposed_duration_months,
          rent_increase_percent: input.rent_increase_percent ?? null,
          offers_generated: filtered.length,
          status: "GENERATED",
          deposit_refund_policy: input.deposit_refund_policy || "KEEP_AS_CREDIT",
          notification_target: input.notification_target || "TENANT",
          strategy_type: renewal_strategy,
          room_category_snapshot: filterCriteria.roomCategory || null,
        },
      });

      const offerIds: string[] = [];
      for (const agreement of filtered) {
        const activeContract = getAgreementContract(agreement);
        const currentRent = Number(activeContract.rent || 0);
        const room = agreement.tenant?.room_allocations?.[0]?.room;
        const roomType = room?.room_type || null;
        const floorKey = room?.floor_ref?.name || (room?.floor != null ? `Floor ${room.floor}` : null);
        const roomNo = room?.room_no || null;

        const effectiveFrom = agreement.agreement_end_date || new Date();

        // Resolve template for this tenant's category/effective date
        const template = await this._resolveTemplateInTx(tx, hostelId, roomType, effectiveFrom);

        const templateRent = template?.default_rent ? Number(template.default_rent) : currentRent;
        const templateDeposit = template?.default_security_deposit ? Number(template.default_security_deposit) : Number(activeContract.security_deposit || 0);
        const templateDuration = template?.default_duration_months || input.proposed_duration_months || 6;

        // Apply strategy to determine proposed rent
        let proposedRent: number;
        if (renewal_strategy === "PERCENTAGE" && input.rent_increase_percent) {
          proposedRent = Math.round(currentRent * (1 + input.rent_increase_percent / 100));
        } else if (renewal_strategy === "ROOM_CATEGORY" && input.category_rents && roomType) {
          proposedRent = input.category_rents[roomType] ?? templateRent;
        } else if (renewal_strategy === "FLOOR_WISE" && input.floor_rents && floorKey) {
          proposedRent = input.floor_rents[floorKey] ?? templateRent;
        } else if (renewal_strategy === "ROOM_WISE" && input.room_rents && roomNo) {
          proposedRent = input.room_rents[roomNo] ?? templateRent;
        } else {
          proposedRent = input.proposed_rent ?? templateRent;
        }

        const proposedDeposit = input.proposed_deposit ?? templateDeposit;
        const proposedDuration = input.proposed_duration_months ?? templateDuration;
        const proposedEndDate = addMonths(effectiveFrom, proposedDuration);
        const depositHeld = this._computeDepositHeld(agreement.tenant);

        const offer = await tx.renewalOffer.create({
          data: {
            id: randomUUID(),
            agreement_id: agreement.id, tenant_id: agreement.tenant_id,
            hostel_id: hostelId, owner_id: ownerId, batch_id: batch.id,
            proposed_rent: proposedRent,
            proposed_security_deposit: proposedDeposit,
            proposed_maintenance: Number(activeContract.maintenance || 0),
            proposed_maintenance_type: agreement.contract_maintenance_type || null,
            proposed_duration_months: proposedDuration,
            proposed_start_date: effectiveFrom,
            proposed_end_date: proposedEndDate,
            proposed_payment_frequency: null,
            effective_from: effectiveFrom,
            current_rent: currentRent,
            current_security_deposit: Number(activeContract.security_deposit || 0),
            current_maintenance: Number(activeContract.maintenance || 0),
            deposit_held: depositHeld,
            additional_deposit_required: Math.max(0, proposedDeposit - depositHeld),
            deposit_refund_eligible: Math.max(0, depositHeld - proposedDeposit),
            deposit_refund_policy: batch.deposit_refund_policy,
            notification_target: batch.notification_target,
            status: "DRAFT",
            offer_expires_at: addDays(new Date(), 15),
          },
        });
        offerIds.push(offer.id);

        await renewalTimelineService.registerEvent(tx, {
          hostelId,
          tenantId: agreement.tenant_id,
          agreementId: agreement.id,
          offerId: offer.id,
          eventType: "OFFER_CREATED",
          actorType: "OWNER",
          actorId: ownerId,
          metadata: { proposedRent, batchId: batch.id },
        });
      }

      logger.info("renewal-offer.bulk-generated", { batch_id: batch.id, hostel_id: hostelId, count: offerIds.length, strategy: renewal_strategy });
      return { batch, offersGenerated: offerIds.length, offerIds };
    });
  }

  /** Send a single offer — marks as SENT, fires notification event. */
  async sendOffer(offerId: string, ownerId: string) {
    const offer = await this.db.renewalOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw new Error("NOT_FOUND: Offer not found");
    if (offer.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your offer");
    if (offer.status !== "DRAFT") throw new Error(`BAD_REQUEST: Cannot send offer in status ${offer.status}`);

    const updated = await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const u = await tx.renewalOffer.update({
        where: { id: offerId },
        data: { status: "SENT", sent_at: new Date(), updated_at: new Date() },
      });
      await renewalTimelineService.registerEvent(tx, {
        hostelId: offer.hostel_id,
        tenantId: offer.tenant_id,
        agreementId: offer.agreement_id,
        offerId,
        eventType: "OFFER_SENT",
        actorType: "OWNER",
        actorId: ownerId,
      });
      return u;
    });

    try {
      const { eventSystem } = await import("@/lib/events");
      await eventSystem.trigger("renewal_offer_sent", {
        offer_id: offerId, tenant_id: offer.tenant_id, hostel_id: offer.hostel_id, owner_id: ownerId,
      });
    } catch (err) { logger.error("renewal-offer.send.event_failed", { offer_id: offerId, err }); }

    logger.info("renewal-offer.sent", { offer_id: offerId, tenant_id: offer.tenant_id });
    return updated;
  }

  /** Send all DRAFT offers in a batch. */
  async sendBulkOffers(batchId: string, ownerId: string) {
    const batch = await this.db.bulkRenewalBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error("NOT_FOUND: Batch not found");
    if (batch.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your batch");

    const drafts = await this.db.renewalOffer.findMany({ where: { batch_id: batchId, status: "DRAFT" }, select: { id: true } });
    let sentCount = 0;
    for (const o of drafts) {
      try { await this.sendOffer(o.id, ownerId); sentCount++; }
      catch (err) { logger.error("renewal-offer.bulk-send.failed", { offer_id: o.id, err }); }
    }
    await this.db.bulkRenewalBatch.update({ where: { id: batchId }, data: { offers_sent: sentCount, status: "SENT" } });
    return { batchId, sentCount };
  }

  /**
   * Tenant accepts an offer.
   * Creates a DRAFT Agreement linked to the old one. The agreement activates
   * on effective_from date via the existing lifecycle cron — NOT immediately.
   */
  async acceptOffer(offerId: string, tenantProfileId: string) {
    const offer = await this.db.renewalOffer.findUnique({
      where: { id: offerId },
      include: {
        agreement: { include: { hostel: { select: { id: true, owner_id: true } } } },
        tenant: {
          select: {
            id: true, profile_id: true,
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true, room_type: true } } },
              take: 1,
            },
          },
        },
      },
    });

    if (!offer) throw new Error("NOT_FOUND: Offer not found");
    if (offer.tenant.profile_id !== tenantProfileId) throw new Error("FORBIDDEN: This offer is not for you");
    if (offer.status !== "SENT") throw new Error(`BAD_REQUEST: Cannot accept offer in status ${offer.status}`);
    if (offer.offer_expires_at && new Date() > offer.offer_expires_at) {
      throw new Error("BAD_REQUEST: This offer has expired. Contact your hostel for a new one.");
    }

    const result = await this.db.$transaction(async (tx) => {
      // Lock the predecessor row and re-check the offer status inside the
      // transaction — the pre-transaction checks above are a TOCTOU-prone
      // read; two concurrent accept calls could both pass them. Mirrors the
      // locking pattern already used by agreementRenewalService.createRenewalDraft
      // and agreementRenewalSigningService.signRenewalAgreement.
      await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${offer.agreement_id}::uuid FOR UPDATE`;

      const freshOffer = await tx.renewalOffer.findUnique({ where: { id: offerId } });
      if (!freshOffer || freshOffer.status !== "SENT") {
        throw new Error(`BAD_REQUEST: Cannot accept offer in status ${freshOffer?.status || "UNKNOWN"}`);
      }

      const roomAllocation = offer.tenant?.room_allocations?.[0];
      const roomCategory = roomAllocation?.room?.room_type || null;

      // Find the template using _resolveTemplateInTx
      const activeTemplate = await this._resolveTemplateInTx(tx, offer.hostel_id, roomCategory, offer.effective_from);
      const templateId = activeTemplate?.id || offer.agreement.template_id;
      const nextVersion = Number(offer.agreement.agreement_version || 1) + 1;

      // Create new agreement from offer terms. Status DRAFT until effective_from.
      const newAgreement = await tx.agreement.create({
        data: {
          id: randomUUID(),
          tenant_id: offer.tenant_id, hostel_id: offer.hostel_id, template_id: templateId,
          renewed_from_agreement_id: offer.agreement_id,
          status: "DRAFT",
          agreement_version: nextVersion,
          agreement_start_date: offer.effective_from,
          agreement_end_date: offer.proposed_end_date,
          agreement_duration_months: offer.proposed_duration_months,
          contract_rent: offer.proposed_rent,
          contract_security_deposit: offer.proposed_security_deposit,
          contract_maintenance: offer.proposed_maintenance,
          contract_maintenance_type: offer.proposed_maintenance_type,
          contract_payment_frequency: offer.proposed_payment_frequency as any,
          content_snapshot: {
            agreement_start_date: offer.effective_from.toISOString().slice(0, 10),
            agreement_end_date: offer.proposed_end_date.toISOString().slice(0, 10),
            agreement_duration_months: offer.proposed_duration_months,
            contract_rent: Number(offer.proposed_rent),
            contract_security_deposit: Number(offer.proposed_security_deposit),
            source: "renewal_offer", renewal_offer_id: offer.id,
          },
        },
      });

      // Link predecessor → successor — count-checked so a losing concurrent
      // acceptance fails loudly instead of leaving an orphaned, unlinked
      // successor Agreement behind.
      const linkUpdate = await tx.agreement.updateMany({
        where: { id: offer.agreement_id, renewed_to_agreement_id: null },
        data: { renewed_to_agreement_id: newAgreement.id },
      });
      if (linkUpdate.count !== 1) {
        throw new Error("CONFLICT: A renewal was already accepted for this agreement");
      }

      // Update offer status
      await tx.renewalOffer.update({
        where: { id: offerId },
        data: { status: "ACCEPTED", accepted_at: new Date(), resulting_agreement_id: newAgreement.id, updated_at: new Date() },
      });

      await renewalTimelineService.registerEvent(tx, {
        hostelId: offer.hostel_id,
        tenantId: offer.tenant_id,
        agreementId: offer.agreement_id,
        offerId,
        eventType: "OFFER_ACCEPTED",
        actorType: "TENANT",
        actorId: tenantProfileId,
      });
      await renewalTimelineService.registerEvent(tx, {
        hostelId: offer.hostel_id,
        tenantId: offer.tenant_id,
        agreementId: newAgreement.id,
        offerId,
        eventType: "DRAFT_CREATED",
        actorType: "TENANT",
        actorId: tenantProfileId,
      });

      // Create structured decision log
      await tx.renewalDecision.create({
        data: {
          id: randomUUID(),
          offer_id: offerId,
          tenant_id: offer.tenant_id,
          decision: "ACCEPTED",
          reason: null,
        },
      });

      // Deposit top-up obligation if needed
      const additionalDeposit = Number(offer.additional_deposit_required || 0);
      let depositObligationId: string | null = null;
      if (additionalDeposit > 0) {
        const obligation = await tx.rent_obligations.create({
          data: {
            tenant_id: offer.tenant_id, hostel_id: offer.hostel_id,
            agreement_id: newAgreement.id, owner_id: offer.owner_id,
            obligation_type: "SECURITY_DEPOSIT", amount: additionalDeposit,
            due_date: offer.effective_from, rent_month: offer.effective_from,
            status: "PENDING", is_superseded: false,
          },
        });
        depositObligationId = obligation.id;

        const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
        await financialLifecycleService.activatePayableObligations(tx, {
          tenantId: offer.tenant_id,
          ownerId: offer.owner_id,
          hostelId: offer.hostel_id,
          obligationIds: [obligation.id],
        });
      }

      // Excess deposit handling
      const refundEligible = Number(offer.deposit_refund_eligible || 0);
      if (refundEligible > 0) {
        // Compute current ledger balance inside this transaction to ensure correct balance_after snapshot
        const [credits, debits] = await Promise.all([
          tx.tenant_financial_ledger.aggregate({
            where: { tenant_id: offer.tenant_id, type: "CREDIT" },
            _sum: { amount: true },
          }),
          tx.tenant_financial_ledger.aggregate({
            where: { tenant_id: offer.tenant_id, type: "DEBIT" },
            _sum: { amount: true },
          }),
        ]);
        const currentBalance = Number(credits._sum.amount ?? 0) - Number(debits._sum.amount ?? 0);

        if (offer.deposit_refund_policy === "KEEP_AS_CREDIT") {
          const newBalance = Math.round((currentBalance + refundEligible) * 100) / 100;
          await tx.tenant_financial_ledger.create({
            data: {
              id: randomUUID(),
              tenant_id: offer.tenant_id,
              owner_id: offer.owner_id,
              hostel_id: offer.hostel_id,
              type: "CREDIT",
              reason: "FUTURE_RENT_CREDIT_TOPUP",
              amount: refundEligible,
              balance_after: newBalance,
              notes: `Excess security deposit from renewal offer ${offer.id} carried forward as credit`,
              reference_id: offer.id,
              reference_type: "RENEWAL_OFFER",
              created_by: "SYSTEM",
            },
          });
        } else if (offer.deposit_refund_policy === "REFUND") {
          const newBalance = Math.max(0, Math.round((currentBalance - refundEligible) * 100) / 100);
          await tx.tenant_financial_ledger.create({
            data: {
              id: randomUUID(),
              tenant_id: offer.tenant_id,
              owner_id: offer.owner_id,
              hostel_id: offer.hostel_id,
              type: "DEBIT",
              reason: "SECURITY_DEPOSIT_REFUNDED",
              amount: refundEligible,
              balance_after: newBalance,
              notes: `Excess security deposit refund pending from renewal offer ${offer.id}`,
              reference_id: offer.id,
              reference_type: "RENEWAL_OFFER",
              refund_status: "PENDING",
              created_by: "SYSTEM",
            },
          });
        }
      }

      if (offer.batch_id) {
        await tx.bulkRenewalBatch.update({ where: { id: offer.batch_id }, data: { offers_accepted: { increment: 1 } } });
      }

      logger.info("renewal-offer.accepted", {
        offer_id: offerId, tenant_id: offer.tenant_id,
        new_agreement_id: newAgreement.id, additional_deposit: additionalDeposit,
        refund_eligible: refundEligible, refund_policy: offer.deposit_refund_policy,
        effective_from: offer.effective_from.toISOString(),
      });

      return { offer: { ...offer, status: "ACCEPTED" as const }, newAgreement, additionalDepositRequired: additionalDeposit, depositObligationId };
    });

    // Post-commit: notify (cache invalidation + SSE). Activation itself
    // already happened synchronously inside the transaction above.
    if (result.depositObligationId) {
      const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
      financialLifecycleService.notifyActivated({
        tenantId: offer.tenant_id,
        ownerId: offer.owner_id,
        hostelId: offer.hostel_id,
        source: "renewal_offer_accepted",
      });
    }

    return result;
  }

  /** Tenant declines an offer. */
  async declineOffer(offerId: string, tenantProfileId: string, reason?: string) {
    const offer = await this.db.renewalOffer.findUnique({
      where: { id: offerId },
      include: { tenant: { select: { id: true, profile_id: true } } },
    });
    if (!offer) throw new Error("NOT_FOUND: Offer not found");
    if (offer.tenant.profile_id !== tenantProfileId) throw new Error("FORBIDDEN: This offer is not for you");
    if (!["SENT", "DRAFT"].includes(offer.status)) throw new Error("BAD_REQUEST: Cannot decline offer in status " + offer.status);

    const updated = await this.db.$transaction(async (tx) => {
      const res = await tx.renewalOffer.update({
        where: { id: offerId },
        data: { status: "DECLINED", declined_at: new Date(), decline_reason: reason || "Tenant declined", updated_at: new Date() },
      });

      // Create structured decision log
      await tx.renewalDecision.create({
        data: {
          id: randomUUID(),
          offer_id: offerId,
          tenant_id: offer.tenant_id,
          decision: "DECLINED",
          reason: reason || "Tenant declined",
        },
      });

      await renewalTimelineService.registerEvent(tx, {
        hostelId: offer.hostel_id,
        tenantId: offer.tenant_id,
        agreementId: offer.agreement_id,
        offerId,
        eventType: "OFFER_DECLINED",
        actorType: "TENANT",
        actorId: tenantProfileId,
        reason: reason || "Tenant declined",
      });

      if (offer.batch_id) {
        await tx.bulkRenewalBatch.update({ where: { id: offer.batch_id }, data: { offers_declined: { increment: 1 } } });
      }

      return res;
    });

    try {
      const { eventSystem } = await import("@/lib/events");
      await eventSystem.trigger("renewal_offer_declined", { offer_id: offerId, tenant_id: offer.tenant_id, hostel_id: offer.hostel_id, owner_id: offer.owner_id, reason });
    } catch (err) { logger.error("renewal-offer.decline.event_failed", { offer_id: offerId, err }); }

    logger.info("renewal-offer.declined", { offer_id: offerId, tenant_id: offer.tenant_id, reason });
    return updated;
  }

  /**
   * Tenant wants to discuss — fires WhatsApp notification to owner.
   * No structured counter-offer tracking; owners negotiate informally then revise.
   */
  async discussOffer(offerId: string, tenantProfileId: string, message?: string) {
    const offer = await this.db.renewalOffer.findUnique({
      where: { id: offerId },
      include: { tenant: { select: { id: true, profile_id: true, profiles: { select: { name: true, phone: true } } } } },
    });
    if (!offer) throw new Error("NOT_FOUND: Offer not found");
    if (offer.tenant.profile_id !== tenantProfileId) throw new Error("FORBIDDEN: This offer is not for you");
    if (offer.status !== "SENT") throw new Error("BAD_REQUEST: Cannot discuss offer in status " + offer.status);

    await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.renewalDecision.create({
        data: {
          id: randomUUID(),
          offer_id: offerId,
          tenant_id: offer.tenant_id,
          decision: "SENT",
          reason: message || "Tenant requested discussion",
        },
      });
      await renewalTimelineService.registerEvent(tx, {
        hostelId: offer.hostel_id,
        tenantId: offer.tenant_id,
        agreementId: offer.agreement_id,
        offerId,
        eventType: "OFFER_DISCUSSED",
        actorType: "TENANT",
        actorId: tenantProfileId,
        reason: message || "Tenant requested discussion",
      });
    });

    try {
      const { eventSystem } = await import("@/lib/events");
      await eventSystem.trigger("renewal_offer_discussion_requested", {
        offer_id: offerId, tenant_id: offer.tenant_id, hostel_id: offer.hostel_id,
        owner_id: offer.owner_id, tenant_name: offer.tenant.profiles?.name,
        tenant_phone: offer.tenant.profiles?.phone, message,
        proposed_rent: Number(offer.proposed_rent), current_rent: Number(offer.current_rent),
      });
    } catch (err) { logger.error("renewal-offer.discuss.event_failed", { offer_id: offerId, err }); }

    logger.info("renewal-offer.discuss", { offer_id: offerId, tenant_id: offer.tenant_id });
    return { success: true, message: "Your hostel has been notified. They will contact you shortly." };
  }

  /** Owner revises an offer (supersedes old, creates new). */
  async reviseOffer(offerId: string, ownerId: string, newTerms: ProposedTerms) {
    const oldOffer = await this.db.renewalOffer.findUnique({ where: { id: offerId } });
    if (!oldOffer) throw new Error("NOT_FOUND: Offer not found");
    if (oldOffer.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your offer");
    if (!["DRAFT", "SENT"].includes(oldOffer.status)) throw new Error("BAD_REQUEST: Cannot revise offer in status " + oldOffer.status);

    return this.db.$transaction(async (tx) => {
      await tx.renewalOffer.update({ where: { id: offerId }, data: { status: "SUPERSEDED", updated_at: new Date() } });

      const agreement = await tx.agreement.findUniqueOrThrow({
        where: { id: oldOffer.agreement_id },
        include: { tenant: { select: { id: true, security_deposit: true,
          tenant_financial_ledger: { where: { type: "CREDIT", reason: { in: ["SECURITY_DEPOSIT_COLLECTED", "SECURITY_DEPOSIT_TOPUP"] } }, select: { amount: true } },
        } } },
      });

      const effectiveFrom = newTerms.effective_from ? new Date(newTerms.effective_from) : oldOffer.effective_from;
      const proposedStartDate = newTerms.proposed_start_date ? new Date(newTerms.proposed_start_date) : effectiveFrom;
      const proposedDuration = newTerms.proposed_duration_months ?? oldOffer.proposed_duration_months;
      const proposedEndDate = addMonths(proposedStartDate, proposedDuration);
      const depositHeld = this._computeDepositHeld(agreement.tenant);

      const proposedRent = newTerms.proposed_rent ?? Number(oldOffer.proposed_rent);
      const proposedDeposit = newTerms.proposed_security_deposit ?? Number(oldOffer.proposed_security_deposit);

      const revised = await tx.renewalOffer.create({
        data: {
          id: randomUUID(),
          agreement_id: oldOffer.agreement_id, tenant_id: oldOffer.tenant_id,
          hostel_id: oldOffer.hostel_id, owner_id: ownerId, batch_id: oldOffer.batch_id,
          proposed_rent: proposedRent,
          proposed_security_deposit: proposedDeposit,
          proposed_maintenance: newTerms.proposed_maintenance ?? Number(oldOffer.proposed_maintenance),
          proposed_duration_months: proposedDuration,
          proposed_start_date: proposedStartDate, proposed_end_date: proposedEndDate,
          proposed_payment_frequency: newTerms.proposed_payment_frequency || oldOffer.proposed_payment_frequency,
          effective_from: effectiveFrom,
          current_rent: Number(oldOffer.current_rent), current_security_deposit: Number(oldOffer.current_security_deposit),
          current_maintenance: Number(oldOffer.current_maintenance),
          deposit_held: depositHeld,
          additional_deposit_required: Math.max(0, proposedDeposit - depositHeld),
          deposit_refund_eligible: Math.max(0, depositHeld - proposedDeposit),
          deposit_refund_policy: newTerms.deposit_refund_policy || oldOffer.deposit_refund_policy,
          notification_target: newTerms.notification_target || oldOffer.notification_target,
          status: "DRAFT", offer_expires_at: newTerms.offer_expires_at ? new Date(newTerms.offer_expires_at) : addDays(new Date(), 15),
          revised_from_offer_id: offerId, is_custom_override: true,
          owner_notes: newTerms.owner_notes || null,
        },
      });

      await renewalTimelineService.registerEvent(tx, {
        hostelId: oldOffer.hostel_id,
        tenantId: oldOffer.tenant_id,
        agreementId: oldOffer.agreement_id,
        offerId: revised.id,
        eventType: "OFFER_REVISED",
        actorType: "OWNER",
        actorId: ownerId,
        metadata: { previousOfferId: offerId },
      });

      logger.info("renewal-offer.revised", { old_offer_id: offerId, new_offer_id: revised.id });
      return revised;
    });
  }

  /** List offers for a hostel (owner pipeline view). */
  async listOffers(ownerId: string, hostelId: string, opts: { status?: string; limit?: number } = {}) {
    const hostel = await this.db.hostels.findUnique({ where: { id: hostelId }, select: { owner_id: true } });
    if (!hostel) throw new Error("NOT_FOUND: Hostel not found");
    if (hostel.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your hostel");

    const where: any = { hostel_id: hostelId, owner_id: ownerId };
    if (opts.status) where.status = opts.status;

    const [offers, allOffersForCounts] = await Promise.all([
      this.db.renewalOffer.findMany({
        where, orderBy: { created_at: "desc" }, take: opts.limit || 100,
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } }, room_allocations: { where: { is_active: true, end_date: null }, include: { room: { select: { room_no: true } } }, take: 1 } } },
          agreement: { select: { id: true, agreement_version: true, agreement_end_date: true, status: true } },
          decisions: true,
        },
      }),
      this.db.renewalOffer.findMany({
        where: { hostel_id: hostelId, owner_id: ownerId },
        select: {
          id: true,
          status: true,
          additional_deposit_required: true,
          decisions: {
            select: {
              decision: true,
            },
          },
        },
      }),
    ]);

    const pipeline = {
      SENT: 0,
      NEGOTIATING: 0,
      ACCEPTED: 0,
      AWAITING_PAYMENT: 0,
      READY_FOR_SIGNATURE: 0,
      DECLINED: 0,
      DRAFT: 0,
    };

    for (const o of allOffersForCounts) {
      const pStatus = computePipelineStatus(o);
      if (pStatus in pipeline) {
        pipeline[pStatus as keyof typeof pipeline]++;
      } else {
        (pipeline as any)[pStatus] = ((pipeline as any)[pStatus] || 0) + 1;
      }
    }

    const mappedOffers = offers.map((o) => ({
      ...o,
      pipeline_status: computePipelineStatus(o),
    }));

    return { offers: mappedOffers, pipeline };
  }

  /** Get the active renewal offer for a tenant (portal view). */
  async getActiveOfferForTenant(profileId: string) {
    const tenant = await this.db.tenants.findUnique({ where: { profile_id: profileId }, select: { id: true } });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

    const offer = await this.db.renewalOffer.findFirst({
      where: { tenant_id: tenant.id, status: "SENT" },
      include: {
        agreement: { select: { id: true, agreement_version: true, agreement_end_date: true, contract_rent: true, contract_security_deposit: true } },
        hostel: { select: { name: true } },
      },
      orderBy: { created_at: "desc" },
    });

    if (!offer) return null;

    const revisions: any[] = [];
    let currentId = offer.revised_from_offer_id;
    while (currentId) {
      const prevOffer = await this.db.renewalOffer.findUnique({
        where: { id: currentId },
        include: {
          agreement: { select: { id: true, agreement_version: true, agreement_end_date: true, contract_rent: true, contract_security_deposit: true } },
        }
      });
      if (!prevOffer) break;
      revisions.push(prevOffer);
      currentId = prevOffer.revised_from_offer_id;
    }

    return {
      ...offer,
      revisions,
    };
  }

  /** Expire stale offers past their expiry date. Called by lifecycle cron. */
  async expireStaleOffers() {
    const staleWhere = { status: { in: ["DRAFT", "SENT"] } as Prisma.RenewalOfferWhereInput["status"], offer_expires_at: { lte: new Date() } };

    const staleOffers = await this.db.renewalOffer.findMany({
      where: staleWhere,
      select: { id: true, agreement_id: true, tenant_id: true, hostel_id: true },
    });
    if (staleOffers.length === 0) return { expiredCount: 0 };

    await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.renewalOffer.updateMany({
        where: { ...staleWhere, id: { in: staleOffers.map((o: { id: string }) => o.id) } },
        data: { status: "EXPIRED", updated_at: new Date() },
      });
      for (const o of staleOffers) {
        await renewalTimelineService.registerEvent(tx, {
          hostelId: o.hostel_id,
          tenantId: o.tenant_id,
          agreementId: o.agreement_id,
          offerId: o.id,
          eventType: "OFFER_EXPIRED",
          actorType: "SYSTEM",
        });
      }
    });

    logger.info("renewal-offer.expired-stale", { expired_count: staleOffers.length });
    return { expiredCount: staleOffers.length };
  }

  private _computeDepositHeld(tenant: any): number {
    if (!tenant?.tenant_financial_ledger?.length) return Number(tenant?.security_deposit || 0);
    const credits = tenant.tenant_financial_ledger.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
    return credits > 0 ? credits : Number(tenant?.security_deposit || 0);
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date); d.setMonth(d.getMonth() + months); return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + days); return d;
}

function getAgreementContract(agreement: any) {
  const snapshot = (agreement?.content_snapshot || {}) as Record<string, any>;
  const numberValue = (val: any) => {
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
  };
  return {
    rent: numberValue(agreement?.contract_rent ?? snapshot.monthly_rent),
    security_deposit: numberValue(agreement?.contract_security_deposit ?? snapshot.advance_deposit),
    maintenance: numberValue(agreement?.contract_maintenance ?? snapshot.maintenance_charge),
  };
}

function computePipelineStatus(offer: any): string {
  const status = offer.status;
  const decisions = offer.decisions || [];
  const additionalDeposit = Number(offer.additional_deposit_required || 0);

  if (status === "SENT") {
    const hasNegotiatingDecision = decisions.some((d: any) => d.decision === "SENT");
    return hasNegotiatingDecision ? "NEGOTIATING" : "SENT";
  }
  if (status === "ACCEPTED") {
    return additionalDeposit > 0 ? "AWAITING_PAYMENT" : "READY_FOR_SIGNATURE";
  }
  if (status === "DECLINED") {
    return "DECLINED";
  }
  return status;
}

export const renewalOfferService = new RenewalOfferService();
