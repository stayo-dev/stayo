/**
 * Cross-owner obligation cancel/waive (2026-10-09 audit, P1-1).
 *
 * `POST /api/payments/obligations/:id/cancel` checked only `role === "OWNER"`
 * and `cancelObligationInTx` never compared the obligation to the caller, so
 * any owner — owner signup is public — could void another owner's unpaid
 * obligation by id. Waive compared `owner_id`, but let a NULL `owner_id`
 * through. Both now take an `ownerScope`, checked against the row locked
 * FOR UPDATE, and a foreign obligation fails exactly like a missing one.
 *
 * Real engine and route handlers; only the session, database, identity
 * step-up, ledger gateway and event bus are faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUser, prisma, gateway } = vi.hoisted(() => ({
  mockUser: vi.fn(),
  prisma: { $transaction: vi.fn() },
  gateway: { applyCorrection: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/services/auth-service", () => ({ authService: { getCurrentUser: mockUser } }));
vi.mock("@/lib/events", () => ({ eventSystem: { trigger: vi.fn(() => Promise.resolve()) } }));
vi.mock("@/src/services/payments/financial-correction-gateway", () => ({ financialCorrectionGateway: gateway }));
vi.mock("@/src/services/payments/identity-confirmation-guard", () => ({
  verifyIdentityConfirmation: vi.fn(async () => ({ userId: "x", jti: "jti-1", action: "x" })),
  consumeIdentityTokenInTx: vi.fn(async () => undefined),
}));

import { obligationEngine } from "../src/services/payments/obligation-engine";
import { POST as cancelRoute } from "../app/api/payments/obligations/[id]/cancel/route";
import { POST as waiveRoute } from "../app/api/payments/obligations/[id]/waive/route";

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOSTEL_A = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const HOSTEL_B = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const OB_A = "11111111-1111-4111-8111-111111111111";
const OB_NULL_OWNER = "22222222-2222-4222-8222-222222222222";
const OB_A_IN_B_HOSTEL = "33333333-3333-4333-8333-333333333333";
const OB_MISSING = "99999999-9999-4999-8999-999999999999";

type Row = { id: string; owner_id: string | null; hostel_id: string; tenant_id: string; status: string; amount: number; obligation_type: string; rent_month: Date | null };

let rows: Map<string, Row>;
let paymentsByObligation: Map<string, number[]>;

/** A transaction client over in-memory rows — enough of Prisma for the engine. */
function fakeTx() {
  return {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, id: string) => {
      const row = rows.get(id);
      return row ? [{ ...row }] : [];
    }),
    hostels: {
      findUnique: vi.fn(async ({ where }: any) => {
        const owners: Record<string, string> = { [HOSTEL_A]: OWNER_A, [HOSTEL_B]: OWNER_B };
        return owners[where.id] ? { owner_id: owners[where.id] } : null;
      }),
    },
    payments: {
      findMany: vi.fn(async ({ where }: any) =>
        (paymentsByObligation.get(where.obligation_id) ?? []).map((amount_paid) => ({ amount_paid })),
      ),
    },
    rent_obligations: {
      update: vi.fn(async ({ where, data }: any) => {
        const next = { ...rows.get(where.id)!, ...data };
        rows.set(where.id, next);
        return next;
      }),
    },
  };
}

let tx: ReturnType<typeof fakeTx>;

const row = (id: string, overrides: Partial<Row> = {}): Row => ({
  id, owner_id: OWNER_A, hostel_id: HOSTEL_A, tenant_id: "t-1", status: "PENDING",
  amount: 8000, obligation_type: "RENT", rent_month: new Date("2026-10-01"), ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map([
    [OB_A, row(OB_A)],
    [OB_NULL_OWNER, row(OB_NULL_OWNER, { owner_id: null })],
    [OB_A_IN_B_HOSTEL, row(OB_A_IN_B_HOSTEL, { hostel_id: HOSTEL_B })],
  ]);
  paymentsByObligation = new Map();
  tx = fakeTx();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  gateway.applyCorrection.mockResolvedValue(undefined);
});

const asOwnerA = { ownerScope: { ownerId: OWNER_A }, actorId: OWNER_A, reason: "test" };
const asOwnerB = { ownerScope: { ownerId: OWNER_B }, actorId: OWNER_B, reason: "test" };

describe("cancelObligationInTx with an owner scope", () => {
  it("lets owner A cancel their own eligible obligation", async () => {
    const result = await obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A, ...asOwnerA });
    expect(result.status).toBe("CANCELLED");
    expect(result.cancelled_by).toBe(OWNER_A);
    expect(gateway.applyCorrection).toHaveBeenCalledOnce();
  });

  it("refuses owner B, as if the obligation did not exist, and writes nothing", async () => {
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A, ...asOwnerB }))
      .rejects.toThrow("NOT_FOUND: Obligation not found");
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
    expect(gateway.applyCorrection).not.toHaveBeenCalled();
    expect(rows.get(OB_A)!.status).toBe("PENDING");
  });

  it("checks ownership on the locked row, before status — a foreign PAID row reads as missing, not as 'PAID'", async () => {
    rows.set(OB_A, row(OB_A, { status: "PAID" }));
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A, ...asOwnerB }))
      .rejects.toThrow("NOT_FOUND: Obligation not found");
  });

  it("denies a NULL owner_id even to the hostel's real owner", async () => {
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_NULL_OWNER, ...asOwnerA }))
      .rejects.toThrow("NOT_FOUND");
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
  });

  it("denies when owner_id matches but the hostel belongs to another owner", async () => {
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A_IN_B_HOSTEL, ...asOwnerA }))
      .rejects.toThrow("NOT_FOUND");
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
  });

  it("denies an empty owner id", async () => {
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A, ownerScope: { ownerId: "" }, actorId: "", reason: "x" }))
      .rejects.toThrow("NOT_FOUND");
  });

  it("keeps the existing rules for the rightful owner: no cancel once paid against, none in a closed status", async () => {
    paymentsByObligation.set(OB_A, [500]);
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A, ...asOwnerA }))
      .rejects.toThrow("BAD_REQUEST: Cannot cancel an obligation that has payments");

    rows.set(OB_A, row(OB_A, { status: "PAID" }));
    await expect(obligationEngine.cancelObligationInTx(tx, { obligationId: OB_A, ...asOwnerA }))
      .rejects.toThrow("BAD_REQUEST: Obligation cannot be cancelled in 'PAID' status");
  });
});

describe("waiveObligationInTx with an owner scope", () => {
  it("lets owner A waive the outstanding balance of their own obligation", async () => {
    paymentsByObligation.set(OB_A, [3000]);
    const { obligation, waivedAmount } = await obligationEngine.waiveObligationInTx(tx, { obligationId: OB_A, ...asOwnerA });
    expect(waivedAmount).toBe(5000);
    expect(obligation.status).toBe("WAIVED");
    expect(obligation.settlement_status).toBe("PARTIAL");
    expect(gateway.applyCorrection).toHaveBeenCalledWith(tx, expect.objectContaining({ type: "WAIVER", amount: 5000 }));
  });

  it("refuses owner B, as if the obligation did not exist, and writes nothing", async () => {
    await expect(obligationEngine.waiveObligationInTx(tx, { obligationId: OB_A, ...asOwnerB }))
      .rejects.toThrow("NOT_FOUND: Obligation not found");
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
    expect(gateway.applyCorrection).not.toHaveBeenCalled();
  });

  it("denies a NULL owner_id — it used to pass the `ob.owner_id && …` check", async () => {
    await expect(obligationEngine.waiveObligationInTx(tx, { obligationId: OB_NULL_OWNER, ...asOwnerB }))
      .rejects.toThrow("NOT_FOUND");
    await expect(obligationEngine.waiveObligationInTx(tx, { obligationId: OB_NULL_OWNER, ...asOwnerA }))
      .rejects.toThrow("NOT_FOUND");
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
  });

  it("keeps the existing rule for the rightful owner: nothing to waive once fully settled", async () => {
    paymentsByObligation.set(OB_A, [8000]);
    await expect(obligationEngine.waiveObligationInTx(tx, { obligationId: OB_A, ...asOwnerA }))
      .rejects.toThrow("BAD_REQUEST: Obligation is already fully settled");
  });
});

describe("system workflows (no owner scope) are unchanged", () => {
  it("allocation reconciliation can still cancel a NULL-owner obligation", async () => {
    const result = await obligationEngine.cancelObligationInTx(tx, { obligationId: OB_NULL_OWNER, actorId: "", reason: "Allocation ended" });
    expect(result.status).toBe("CANCELLED");
    expect(tx.hostels.findUnique).not.toHaveBeenCalled();
  });

  it("system waive keeps its actorId check", async () => {
    await expect(obligationEngine.waiveObligationInTx(tx, { obligationId: OB_A, actorId: OWNER_B, reason: "sweep" }))
      .rejects.toThrow("FORBIDDEN");
  });
});

// ── Route level ──────────────────────────────────────────────────────────────

const ownerSession = (id: string) => ({ id, email: `${id}@x.test`, role: "OWNER", owner_id: id });
const req = (body: Record<string, unknown>) => ({ json: async () => body }) as any;
const ctx = (id: string) => ({ params: { id } });
const body = (res: Response) => res.json();

describe("POST /api/payments/obligations/:id/cancel", () => {
  it("200 for owner A on their own obligation", async () => {
    mockUser.mockResolvedValue(ownerSession(OWNER_A));
    const res = await cancelRoute(req({ reason: "duplicate", identityToken: "t" }), ctx(OB_A));
    expect(res.status).toBe(200);
    expect(rows.get(OB_A)!.status).toBe("CANCELLED");
  });

  it("404 for owner B — byte-for-byte the same response as a missing obligation", async () => {
    mockUser.mockResolvedValue(ownerSession(OWNER_B));
    const foreign = await cancelRoute(req({ reason: "x", identityToken: "t" }), ctx(OB_A));
    const missing = await cancelRoute(req({ reason: "x", identityToken: "t" }), ctx(OB_MISSING));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await body(foreign)).toEqual(await body(missing));
    expect(rows.get(OB_A)!.status).toBe("PENDING");
  });

  it("401 for an OWNER session whose owner_id is not their own id", async () => {
    mockUser.mockResolvedValue({ ...ownerSession(OWNER_B), owner_id: OWNER_A });
    const res = await cancelRoute(req({ reason: "x", identityToken: "t" }), ctx(OB_A));
    expect(res.status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("401 for a tenant", async () => {
    mockUser.mockResolvedValue({ id: "t", email: "t@x.test", role: "TENANT", owner_id: null });
    expect((await cancelRoute(req({ reason: "x", identityToken: "t" }), ctx(OB_A))).status).toBe(401);
  });
});

describe("POST /api/payments/obligations/:id/waive", () => {
  it("200 for owner A on their own obligation", async () => {
    mockUser.mockResolvedValue(ownerSession(OWNER_A));
    const res = await waiveRoute(req({ identityToken: "t" }), ctx(OB_A));
    expect(res.status).toBe(200);
    expect(rows.get(OB_A)!.status).toBe("WAIVED");
  });

  it("404 for owner B, and 404 on a NULL-owner obligation", async () => {
    mockUser.mockResolvedValue(ownerSession(OWNER_B));
    expect((await waiveRoute(req({ identityToken: "t" }), ctx(OB_A))).status).toBe(404);
    expect((await waiveRoute(req({ identityToken: "t" }), ctx(OB_NULL_OWNER))).status).toBe(404);
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
  });
});
