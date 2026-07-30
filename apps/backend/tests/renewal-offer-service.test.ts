import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenewalOfferService } from "@/src/services/tenants/renewal-offer-service";
import { randomUUID } from "crypto";

vi.mock("@/lib/services/notifications/whatsapp-renewal-handler", () => ({
  sendRenewalOfferNotification: vi.fn().mockResolvedValue(undefined),
  sendRenewalOfferDeclinedNotification: vi.fn().mockResolvedValue(undefined),
  sendRenewalOfferDiscussionNotification: vi.fn().mockResolvedValue(undefined),
}));

// This suite exercises renewal-offer-service.ts's own DB writes (obligation
// creation, ledger entries, decision logging) via a hand-rolled tx mock that
// doesn't model the full settlement-engine query chain. Activation/credit
// sweeping is a separate concern (see obligation-activation.test.ts for
// integration coverage of that) — mocked out here as a no-op.
vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: {
    activatePayableObligations: vi.fn().mockResolvedValue([]),
    notifyActivated: vi.fn(),
  },
}));


const mockAgreement = {
  id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  template_id: "template-1",
  status: "SIGNED",
  agreement_version: 1,
  agreement_start_date: new Date("2026-01-01T00:00:00.000Z"),
  agreement_end_date: new Date("2026-06-30T00:00:00.000Z"),
  agreement_duration_months: 6,
  contract_rent: 8000,
  contract_security_deposit: 5000,
  contract_maintenance: 1000,
  contract_maintenance_type: "MONTHLY",
  contract_payment_frequency: "MONTHLY",
  hostel: {
    id: "hostel-1",
    owner_id: "owner-1",
  },
  tenant: {
    id: "tenant-1",
    security_deposit: 5000,
    tenant_financial_ledger: [
      { amount: 5000, type: "CREDIT", reason: "SECURITY_DEPOSIT_COLLECTED" }
    ],
    room_allocations: [
      {
        is_active: true,
        end_date: null,
        room: {
          room_no: "101",
          room_type: "G1",
          floor: 1,
          floor_ref: { name: "Floor 1" },
        }
      }
    ]
  },
  renewal_offers_source: [],
};

const mockOfferFull = {
  id: "offer-1",
  agreement_id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  owner_id: "owner-1",
  proposed_rent: 8500,
  proposed_security_deposit: 6000,
  proposed_duration_months: 6,
  proposed_start_date: new Date("2026-07-01"),
  proposed_end_date: new Date("2027-01-01"),
  effective_from: new Date("2026-07-01"),
  additional_deposit_required: 1000,
  status: "SENT",
  agreement: { id: "agreement-1", template_id: "template-1", agreement_version: 1 },
  tenant: { id: "tenant-1", profile_id: "profile-1" },
};

function createDbMock(agreementOverride: Partial<typeof mockAgreement> = {}) {
  const agreement = { ...mockAgreement, ...agreementOverride };
  
  const txMock = {
    agreement: {
      findUnique: vi.fn().mockResolvedValue(agreement),
      findUniqueOrThrow: vi.fn().mockResolvedValue(agreement),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tenants: {
      findUnique: vi.fn().mockResolvedValue({ id: "tenant-1", profile_id: "profile-1" }),
    },
    hostels: {
      findUnique: vi.fn().mockResolvedValue({ id: "hostel-1", owner_id: "owner-1" }),
    },
    agreementTemplate: {
      findFirst: vi.fn().mockResolvedValue({ id: "template-1" }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "template-1",
          hostel_id: "hostel-1",
          type: "RENEWAL",
          status: "PUBLISHED",
          is_active: true,
          room_category: "G1",
          default_rent: 8500,
          default_security_deposit: 7000,
          default_duration_months: 6,
          effective_from: new Date("2020-01-01"),
          effective_to: null,
        }
      ]),
    },
    renewalOffer: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
      findUnique: vi.fn().mockResolvedValue(mockOfferFull),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    bulkRenewalBatch: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: "batch-1", owner_id: "owner-1" }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    rent_obligations: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
    },
    renewalDecision: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
    },
    renewalTimelineEvent: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
    },
    $queryRaw: vi.fn(),
  };

  const dbMock = {
    agreement: {
      findUnique: vi.fn().mockResolvedValue(agreement),
      findMany: vi.fn().mockResolvedValue([agreement]),
    },
    hostels: {
      findUnique: vi.fn().mockResolvedValue({ id: "hostel-1", owner_id: "owner-1" }),
    },
    agreementTemplate: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "template-1",
          hostel_id: "hostel-1",
          type: "RENEWAL",
          status: "PUBLISHED",
          is_active: true,
          room_category: "G1",
          default_rent: 8500,
          default_security_deposit: 7000,
          default_duration_months: 6,
          effective_from: new Date("2020-01-01"),
          effective_to: null,
        }
      ]),
    },
    renewalOffer: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
      findUnique: vi.fn().mockResolvedValue(mockOfferFull),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    bulkRenewalBatch: {
      findUnique: vi.fn().mockResolvedValue({ id: "batch-1", owner_id: "owner-1" }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    tenants: {
      findUnique: vi.fn().mockResolvedValue({ id: "tenant-1", profile_id: "profile-1" }),
    },
    renewalDecision: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
    },
    renewalTimelineEvent: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
    },
    $transaction: vi.fn(async (callback: any) => callback(txMock)),
  };

  return { dbMock, txMock };
}

describe("RenewalOfferService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateOffer", () => {
    it("successfully creates a draft offer with computed deposit deltas", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const offer = await service.generateOffer("agreement-1", "owner-1", {
        proposed_rent: 8500,
        proposed_security_deposit: 7000,
        proposed_duration_months: 6,
        owner_notes: "V2 Offer",
      });

      expect(offer.proposed_rent).toBe(8500);
      expect(offer.proposed_security_deposit).toBe(7000);
      expect(offer.deposit_held).toBe(5000);
      expect(offer.additional_deposit_required).toBe(2000);
      expect(offer.deposit_refund_eligible).toBe(0);
      expect(offer.status).toBe("DRAFT");
    });

    it("raises error if agreement is not owned by requesting owner", async () => {
      const { dbMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      await expect(
        service.generateOffer("agreement-1", "owner-other", {
          proposed_rent: 8500,
          proposed_security_deposit: 7000,
          proposed_duration_months: 6,
        })
      ).rejects.toThrow("FORBIDDEN: Not your agreement");
    });
  });

  describe("generateBulkOffers", () => {
    it("generates FLAT strategy bulk offers successfully", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const result = await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "FLAT",
        proposed_duration_months: 6,
        proposed_rent: 9000,
        proposed_deposit: 6000,
      });

      expect(result.offersGenerated).toBe(1);
      expect(txMock.bulkRenewalBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            renewal_strategy: "FLAT",
            proposed_rent: 9000,
            proposed_deposit: 6000,
          }),
        })
      );
      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposed_rent: 9000,
            proposed_security_deposit: 6000,
            additional_deposit_required: 1000,
          }),
        })
      );
    });

    it("generates PERCENTAGE strategy bulk offers correctly", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const result = await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "PERCENTAGE",
        proposed_duration_months: 12,
        rent_increase_percent: 10, // 8000 + 10% = 8800
      });

      expect(result.offersGenerated).toBe(1);
      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposed_rent: 8800,
          }),
        })
      );
    });

    it("generates ROOM_CATEGORY strategy bulk offers correctly", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const result = await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "ROOM_CATEGORY",
        proposed_duration_months: 12,
        category_rents: {
          G1: 9500,
          AC: 12000,
        },
      });

      expect(result.offersGenerated).toBe(1);
      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposed_rent: 9500, // Matching G1
          }),
        })
      );
    });

    it("generates FLOOR_WISE strategy bulk offers correctly", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const result = await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "FLOOR_WISE",
        proposed_duration_months: 12,
        floor_rents: {
          "Floor 1": 8700,
          "Floor 2": 9200,
        },
      });

      expect(result.offersGenerated).toBe(1);
      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposed_rent: 8700, // Matching "Floor 1"
          }),
        })
      );
    });

    it("falls back to the legacy floor integer as 'Floor <n>' when a room has no floor_ref", async () => {
      const { dbMock, txMock } = createDbMock({
        tenant: {
          ...mockAgreement.tenant,
          room_allocations: [
            {
              is_active: true,
              end_date: null,
              room: { room_no: "205", room_type: "G1", floor: 2, floor_ref: null },
            },
          ],
        } as any,
      });
      const service = new RenewalOfferService(dbMock as any);

      await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "FLOOR_WISE",
        proposed_duration_months: 12,
        floor_rents: { "Floor 2": 8900 },
      });

      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proposed_rent: 8900 }),
        })
      );
    });

    it("generates ROOM_WISE strategy bulk offers correctly", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const result = await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "ROOM_WISE",
        proposed_duration_months: 12,
        room_rents: {
          "101": 8600,
          "102": 9100,
        },
      });

      expect(result.offersGenerated).toBe(1);
      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposed_rent: 8600, // Matching room 101
          }),
        })
      );
    });

    it("falls back to the template rent for a room not listed in room_rents", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "ROOM_WISE",
        proposed_duration_months: 12,
        room_rents: { "999": 15000 }, // does not match mock's room 101
      });

      expect(txMock.renewalOffer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proposed_rent: 8500 }), // template default_rent
        })
      );
    });

    it("scopes the bulk query to explicit agreementIds when the owner selects specific rows", async () => {
      const { dbMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      await service.generateBulkOffers({
        ownerId: "owner-1",
        hostelId: "hostel-1",
        renewal_strategy: "FLAT",
        proposed_duration_months: 6,
        proposed_rent: 9000,
        filterCriteria: { agreementIds: ["agreement-1", "agreement-2"] },
      });

      expect(dbMock.agreement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["agreement-1", "agreement-2"] },
            hostel_id: "hostel-1",
          }),
        })
      );
    });
  });

  describe("acceptOffer", () => {
    it("creates a draft agreement and generates a security deposit top-up obligation", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      const result = await service.acceptOffer("offer-1", "profile-1");

      expect(result.newAgreement.status).toBe("DRAFT");
      expect(result.newAgreement.contract_rent).toBe(8500);
      expect(result.newAgreement.contract_security_deposit).toBe(6000);
      expect(result.additionalDepositRequired).toBe(1000);
      expect(txMock.rent_obligations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            obligation_type: "SECURITY_DEPOSIT",
            amount: 1000,
            status: "PENDING",
          }),
        })
      );
    });

    it("logs a structured decision history entry on acceptance", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      await service.acceptOffer("offer-1", "profile-1");

      expect(txMock.renewalDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            offer_id: "offer-1",
            decision: "ACCEPTED",
          }),
        })
      );
    });

    it("handles excess deposit by creating a credit ledger entry when policy is KEEP_AS_CREDIT", async () => {
      const { dbMock, txMock } = createDbMock();
      const mockOfferWithExcessCredit = {
        ...mockOfferFull,
        additional_deposit_required: 0,
        deposit_refund_eligible: 1500,
        deposit_refund_policy: "KEEP_AS_CREDIT",
      };
      dbMock.renewalOffer.findUnique = vi.fn().mockResolvedValue(mockOfferWithExcessCredit);

      txMock.tenant_financial_ledger = {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 1000 } }),
      };

      const service = new RenewalOfferService(dbMock as any);
      await service.acceptOffer("offer-1", "profile-1");

      expect(txMock.tenant_financial_ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "CREDIT",
            reason: "FUTURE_RENT_CREDIT_TOPUP",
            amount: 1500,
            reference_type: "RENEWAL_OFFER",
          }),
        })
      );
    });

    it("handles excess deposit by creating a debit ledger entry when policy is REFUND", async () => {
      const { dbMock, txMock } = createDbMock();
      const mockOfferWithExcessRefund = {
        ...mockOfferFull,
        additional_deposit_required: 0,
        deposit_refund_eligible: 1500,
        deposit_refund_policy: "REFUND",
      };
      dbMock.renewalOffer.findUnique = vi.fn().mockResolvedValue(mockOfferWithExcessRefund);

      txMock.tenant_financial_ledger = {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: randomUUID(), ...data })),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 1000 } }),
      };

      const service = new RenewalOfferService(dbMock as any);
      await service.acceptOffer("offer-1", "profile-1");

      expect(txMock.tenant_financial_ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "DEBIT",
            reason: "SECURITY_DEPOSIT_REFUNDED",
            amount: 1500,
            reference_type: "RENEWAL_OFFER",
            refund_status: "PENDING",
          }),
        })
      );
    });

    it("fails if the offer has expired", async () => {
      const { dbMock } = createDbMock();
      // Mock an expired offer
      const expiredOffer = {
        ...mockOfferFull,
        offer_expires_at: new Date(Date.now() - 10000), // 10s ago
      };
      dbMock.renewalOffer.findUnique = vi.fn().mockResolvedValue(expiredOffer);
      const service = new RenewalOfferService(dbMock as any);

      await expect(
        service.acceptOffer("offer-1", "profile-1")
      ).rejects.toThrow("BAD_REQUEST: This offer has expired");
    });

    it("fails acceptance instead of creating an orphaned successor when the predecessor's renewed_to_agreement_id changed concurrently", async () => {
      const { dbMock, txMock } = createDbMock();
      // Simulate a concurrent acceptance that already won: the predecessor's
      // renewed_to_agreement_id is no longer null by the time this
      // transaction's updateMany runs, so it matches zero rows.
      txMock.agreement.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const service = new RenewalOfferService(dbMock as any);

      await expect(
        service.acceptOffer("offer-1", "profile-1")
      ).rejects.toThrow("CONFLICT: A renewal was already accepted for this agreement");

      expect(txMock.renewalOffer.update).not.toHaveBeenCalled();
      expect(txMock.renewalDecision.create).not.toHaveBeenCalled();
    });

    it("re-checks the offer status inside the transaction instead of trusting the pre-transaction read", async () => {
      const { dbMock, txMock } = createDbMock();
      // The pre-transaction fetch (dbMock.renewalOffer.findUnique) still
      // returns SENT, but by the time the transaction's own fresh read runs,
      // another request has already accepted the offer.
      txMock.renewalOffer.findUnique = vi.fn().mockResolvedValue({ ...mockOfferFull, status: "ACCEPTED" });
      const service = new RenewalOfferService(dbMock as any);

      await expect(
        service.acceptOffer("offer-1", "profile-1")
      ).rejects.toThrow("BAD_REQUEST: Cannot accept offer in status ACCEPTED");

      expect(txMock.agreement.create).not.toHaveBeenCalled();
    });
  });

  describe("declineOffer and discussOffer", () => {
    it("logs a structured decision history entry on decline", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      await service.declineOffer("offer-1", "profile-1", "Too expensive");

      expect(txMock.renewalDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            offer_id: "offer-1",
            decision: "DECLINED",
            reason: "Too expensive",
          }),
        })
      );
    });

    it("logs a structured decision history entry on discuss", async () => {
      const { dbMock, txMock } = createDbMock();
      const service = new RenewalOfferService(dbMock as any);

      await service.discussOffer("offer-1", "profile-1", "Can we lower deposit?");

      expect(txMock.renewalDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            offer_id: "offer-1",
            decision: "SENT",
            reason: "Can we lower deposit?",
          }),
        })
      );
    });
  });

  describe("template effective date boundaries validation", () => {
    it("throws if no active template covers the effective date of the offer", async () => {
      const { dbMock } = createDbMock();
      // Return empty array from findMany to simulate no templates covering the date
      dbMock.agreementTemplate.findMany = vi.fn().mockResolvedValue([]);
      const service = new RenewalOfferService(dbMock as any);

      await expect(
        service.generateOffer("agreement-1", "owner-1", {
          proposed_rent: 8500,
          proposed_security_deposit: 7000,
          proposed_duration_months: 6,
          effective_from: new Date("2026-07-01"),
        })
      ).rejects.toThrow("BAD_REQUEST: No active agreement template covers the proposed effective date");
    });
  });
});
