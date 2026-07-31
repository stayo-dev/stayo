import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { rentGenerationService } from "@/src/services/payments/rent-generation-service";

vi.mock("@/lib/db", () => ({
  prisma: {
    agreement: { findFirst: vi.fn() },
    rent_obligations: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    tenants: { findUnique: vi.fn() },
    hostels: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  supabase: {},
}));

const TENANT = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";
const HOSTEL = "33333333-3333-3333-3333-333333333333";
const AGREEMENT = "44444444-4444-4444-4444-444444444444";

/** Latest existing RENT obligation sits in July 2026; rent is 8,800/month. */
function baseAgreement(overrides: Record<string, unknown> = {}) {
  return {
    id: AGREEMENT,
    tenant_id: TENANT,
    hostel_id: HOSTEL,
    status: "ACTIVE",
    contract_rent: 8800,
    contract_payment_frequency: "MONTHLY",
    agreement_start_date: new Date(Date.UTC(2026, 0, 1)),
    agreement_end_date: new Date(Date.UTC(2026, 11, 31)),
    ...overrides,
  };
}

function agreementFinder() {
  return (prisma as any).agreement.findFirst;
}

describe("ensureInstallmentsForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agreementFinder().mockResolvedValue(baseAgreement());
    (prisma as any).rent_obligations.findFirst.mockResolvedValue({
      rent_month: new Date(Date.UTC(2026, 6, 1)), // July 2026
    });
    (prisma as any).rent_obligations.create.mockImplementation(async ({ data }: any) => ({
      id: `obl-${new Date(data.rent_month).toISOString().slice(0, 7)}`,
      ...data,
    }));
    (prisma as any).tenants.findUnique.mockResolvedValue({
      id: TENANT, owner_id: OWNER, hostel_id: HOSTEL, maintenance_charge: 0,
    });
  });

  it("generates one installment when the shortfall is under a period's rent", async () => {
    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 1200,
    });

    expect(result.exhausted).toBe(false);
    expect(result.created).toHaveLength(1);
    expect(result.coveredAmount).toBe(8800);
    expect((prisma as any).rent_obligations.create).toHaveBeenCalledTimes(1);
  });

  it("generates several installments when the shortfall spans periods", async () => {
    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 20000,
    });

    expect(result.exhausted).toBe(false);
    expect(result.created).toHaveLength(3); // 8800 * 3 = 26400 >= 20000
    expect(result.coveredAmount).toBe(26400);
  });

  it("writes rows carrying the correct hostel, owner and agreement context", async () => {
    await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 100,
    });

    const row = (prisma as any).rent_obligations.create.mock.calls[0][0].data;
    expect(row.tenant_id).toBe(TENANT);
    expect(row.owner_id).toBe(OWNER);
    expect(row.hostel_id).toBe(HOSTEL);
    expect(row.agreement_id).toBe(AGREEMENT);
    expect(row.obligation_type).toBe("RENT");
    expect(row.status).toBe("PENDING");
    expect(row.amount).toBe(8800);
    expect(row.total_amount).toBe(8800);
    // August 2026 — the period after the latest existing obligation.
    expect(new Date(row.rent_month).toISOString().slice(0, 7)).toBe("2026-08");
  });

  it("stops at agreement_end_date and reports exhausted", async () => {
    agreementFinder().mockResolvedValue(
      baseAgreement({ agreement_end_date: new Date(Date.UTC(2026, 8, 30)) }), // ends Sept
    );

    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 50000,
    });

    expect(result.exhausted).toBe(true);
    expect(result.created).toHaveLength(2); // Aug + Sept only
    expect(result.coveredAmount).toBe(17600);
  });

  it("reports exhausted and writes nothing when there is no active agreement", async () => {
    agreementFinder().mockResolvedValue(null);

    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 5000,
    });

    expect(result).toEqual({ created: [], coveredAmount: 0, exhausted: true });
    expect((prisma as any).rent_obligations.create).not.toHaveBeenCalled();
  });

  it("reports exhausted when the agreement carries no rent amount", async () => {
    agreementFinder().mockResolvedValue(baseAgreement({ contract_rent: 0 }));

    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 5000,
    });

    expect(result.exhausted).toBe(true);
    expect((prisma as any).rent_obligations.create).not.toHaveBeenCalled();
  });

  it("writes nothing when nothing is needed", async () => {
    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 0,
    });

    expect(result).toEqual({ created: [], coveredAmount: 0, exhausted: false });
    expect((prisma as any).rent_obligations.create).not.toHaveBeenCalled();
  });

  it("treats a duplicate row (P2002) as already generated rather than failing", async () => {
    // The @@unique([agreement_id, rent_month, obligation_type]) constraint is the
    // real idempotency guard — a racing cron may have created the same month.
    (prisma as any).rent_obligations.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await rentGenerationService.ensureInstallmentsForTenant({
      tenantId: TENANT, ownerId: OWNER, hostelId: HOSTEL, amountNeeded: 1200,
    });

    expect(result.exhausted).toBe(false);
    expect(result.coveredAmount).toBe(8800); // the month is covered either way
  });
});
