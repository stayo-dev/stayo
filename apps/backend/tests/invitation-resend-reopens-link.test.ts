import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Send again" on an invitation must always hand the tenant a link that works
 * for another 7 days (2026-10-10).
 *
 * What went wrong before:
 * 1. Once the expiry sweep had closed the tenancy (link expired + 7 days'
 *    grace), a resend minted a new token but left `tenants.status = EXPIRED`
 *    — and `resolveByToken` refuses any EXPIRED tenancy, so the new link said
 *    "expired" too. The bed stayed freed and the voided rent stayed voided.
 * 2. When WhatsApp failed, the route dropped the new `activation_link`, so the
 *    owner's screen offered the link it had cached — whose token the resend
 *    had just replaced.
 *
 * The database is an in-memory fake shared by the service and the
 * transaction, so a resend followed by `resolveByToken` exercises the real
 * state the one leaves for the other.
 */

const h = vi.hoisted(() => {
  const state: any = {};
  const capacity = { available: 1, occupied: 0, reserved: 0, capacity: 2 };
  const ledger = { reverseObligationWaiverInTx: null as any };
  return { state, capacity, ledger };
});

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === "payments") return cond?.none ? !row.paid : true;
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(value);
      if ("notIn" in cond) return !cond.notIn.includes(value);
      if ("not" in cond) return value !== cond.not;
      if ("lt" in cond) return value < cond.lt;
      return true;
    }
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  });
}

function makeDb() {
  const s = h.state;
  const withRelations = (inv: any) =>
    inv && {
      ...inv,
      tenant: { ...s.tenants.find((t: any) => t.id === inv.tenant_id), hostels: { status: "ACTIVE" }, owner_attestations: [], profiles: null },
      room: { id: inv.room_id, room_no: "401", hostel_id: inv.hostel_id, hostels: { status: "ACTIVE", name: "Sri Adithya" } },
      reservations: [],
    };
  const db: any = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM tenants")) return s.tenants.filter((t: any) => t.id === "tenant-1").map((t: any) => ({ ...t, owner_attested: false }));
      if (sql.includes("FROM profiles")) return [{ id: "profile-1" }];
      if (sql.includes("FROM tenant_invitations")) return [{ id: s.invitations[0].id, status: s.invitations[0].status }];
      return [];
    }),
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: any) => fn(db)),
    tenants: {
      findFirst: vi.fn(async ({ where }: any) => s.tenants.find((t: any) => matches(t, where)) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(s.tenants.find((t: any) => t.id === where.id), data)),
    },
    tenant_invitations: {
      findFirst: vi.fn(async ({ where }: any) => {
        const found = s.invitations.filter((i: any) => matches(i, { status: where.status, owner_id: where.owner_id }));
        return found[found.length - 1] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) =>
        withRelations(s.invitations.find((i: any) => (where.id ? i.id === where.id : i.token === where.token))),
      ),
      update: vi.fn(async ({ where, data }: any) => Object.assign(s.invitations.find((i: any) => i.id === where.id), data)),
      count: vi.fn(async () => s.invitations.length),
    },
    tenant_invitation_reservations: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findFirst: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
    roomAllocation: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const rows = s.allocations.filter((a: any) => matches(a, where));
        if (orderBy?.end_date === "desc") rows.sort((a: any, b: any) => (b.end_date?.getTime() ?? 0) - (a.end_date?.getTime() ?? 0));
        return rows[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(s.allocations.find((a: any) => a.id === where.id), data)),
      create: vi.fn(async ({ data }: any) => {
        s.allocations.push({ ...data });
        return data;
      }),
    },
    rent_obligations: {
      findMany: vi.fn(async ({ where }: any) => s.obligations.filter((o: any) => matches(o, where))),
      findFirst: vi.fn(async ({ where }: any) => s.obligations.find((o: any) => matches(o, where)) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(s.obligations.find((o: any) => o.id === where.id), data)),
      deleteMany: vi.fn(),
    },
    payments: { count: vi.fn(async () => s.paymentsCount) },
    profile: { findUnique: vi.fn(async () => ({ id: "owner-1", name: "Owner" })), update: vi.fn() },
  };
  return db;
}

const db = vi.hoisted(() => ({ current: null as any }));
const prismaProxy = vi.hoisted(
  () => new Proxy({}, { get: (_t, key) => (db.current as any)[key as any] }),
);

vi.mock("@/lib/db", () => ({ prisma: prismaProxy }));
vi.mock("../lib/db", () => ({ prisma: prismaProxy }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/email-service", () => ({ EmailService: { sendInvitation: vi.fn() } }));
vi.mock("@/lib/services/room-capacity-service", () => ({
  roomCapacityService: {
    getRoomCapacitySnapshot: vi.fn(async () => ({
      ...h.capacity,
      room: { capacity: h.capacity.capacity, hostels: { owner_id: "owner-1" } },
    })),
  },
}));
vi.mock("@/src/services/payments/obligation-engine", () => ({ obligationEngine: {} }));
vi.mock("@/src/services/platform-billing/tenant-activation-guard", () => ({ assertOwnerCanActivateTenant: vi.fn(async () => undefined) }));
vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: { activatePayableObligations: vi.fn(async () => []), notifyActivated: vi.fn() },
}));
vi.mock("@/src/services/auth/credential-service", () => ({ credentialService: { setPassword: vi.fn() } }));
vi.mock("@/src/services/admissions/lead-joined-transition", () => ({ markLeadJoinedForTenant: vi.fn(async () => undefined) }));
vi.mock("@/src/services/tenants/invitation-delivery-trust", () => ({
  recordWhatsAppDelivery: vi.fn(async () => undefined),
  readWhatsAppDeliveredAt: vi.fn(async () => null),
}));
vi.mock("@/src/services/tenants/invited-profile-resolver", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resolveInvitedProfile: vi.fn(async () => ({ profile: null, source: null })),
}));

import { TenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { reopenExpiredTenancy } from "@/src/services/tenants/reopen-expired-tenancy";
import { AUTO_EXPIRE_WAIVER_REASON } from "@/src/services/tenants/unaccepted-tenancy-closure";
import {
  tenantFinancialLedgerService,
  WAIVER_REFERENCE_TYPE,
  WAIVER_REVERSAL_REFERENCE_TYPE,
} from "@/src/services/payments/tenant-financial-ledger-service";
import { financialLifecycleService } from "@/src/services/payments/financial-lifecycle-service";
import { assertOwnerCanActivateTenant } from "@/src/services/platform-billing/tenant-activation-guard";

const now = new Date();
const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** A tenancy exactly as `closeUnacceptedTenancy` leaves it, 14+ days after the invite. */
function seedSweptTenancy(over: { paymentsCount?: number } = {}) {
  const swept = (id: string, offset: number, extra: any = {}) => ({
    id,
    tenant_id: "tenant-1",
    rent_month: month(offset),
    obligation_type: "RENT",
    status: "WAIVED",
    lifecycle_status: "WAIVED",
    settlement_status: "UNPAID",
    waived_reason: AUTO_EXPIRE_WAIVER_REASON,
    waived_at: daysAgo(1),
    waived_by: "owner-1",
    waived_amount: 8500,
    allocation_id: "alloc-1",
    paid: false,
    ...extra,
  });
  Object.assign(h.state, {
    paymentsCount: over.paymentsCount ?? 0,
    tenants: [
      { id: "tenant-1", status: "EXPIRED", access_mode: "OWNER_MANAGED", acceptance_status: "PENDING", phone_1: "+918008046952", joined_on: month(-1), owner_id: "owner-1", hostel_id: "hostel-1", activation_completed_at: null },
    ],
    invitations: [
      { id: "inv-1", token: "old-token", status: "EXPIRED", expires_at: daysAgo(15), cancelled_at: daysAgo(1), owner_id: "owner-1", tenant_id: "tenant-1", room_id: "room-401", hostel_id: "hostel-1", phone: "+918008046952", email: null, name: "Ravi" },
    ],
    allocations: [{ id: "alloc-1", tenant_id: "tenant-1", room_id: "room-401", hostel_id: "hostel-1", is_active: false, end_date: daysAgo(1) }],
    obligations: [
      // Last month: paid, kept by the sweep — history that must not move.
      { id: "ob-paid", tenant_id: "tenant-1", rent_month: month(-1), obligation_type: "RENT", status: "PAID", lifecycle_status: "ACTIVE", settlement_status: "PAID", allocation_id: "alloc-1", paid: true },
      // Future at sweep time; this month by now.
      swept("ob-now", 0),
      swept("ob-next", 1),
      swept("ob-next-maint", 1, { obligation_type: "MAINTENANCE", waived_amount: 500 }),
      // The owner waived this one by hand — not the sweep's to give back.
      swept("ob-owner-waived", 2, { waived_reason: "Owner goodwill" }),
      // Since the sweep the owner raised this month again by hand.
      swept("ob-superseded", 3),
      { id: "ob-live-dup", tenant_id: "tenant-1", rent_month: month(3), obligation_type: "RENT", status: "UPCOMING", lifecycle_status: "ACTIVE", settlement_status: "UNPAID", allocation_id: "alloc-1", paid: false },
    ],
  });
}

const ob = (id: string) => h.state.obligations.find((o: any) => o.id === id);
const tenant = () => h.state.tenants[0];
const invitation = () => h.state.invitations[0];

let service: any;
let delivery: any;

beforeEach(() => {
  vi.clearAllMocks();
  db.current = makeDb();
  Object.assign(h.capacity, { available: 1, occupied: 0, reserved: 0, capacity: 2 });
  seedSweptTenancy();
  service = new TenantInvitationLifecycleService();
  delivery = { whatsapp_sent: true, email_sent: false };
  vi.spyOn(service, "dispatchInvitationNotification").mockImplementation(async () => delivery);
  vi.spyOn(tenantFinancialLedgerService, "reverseObligationWaiverInTx").mockResolvedValue(8500);
});

const sendAgain = (overrides: any = {}) =>
  service.resendInvitationByEmail("+918008046952", { id: "owner-1", role: "OWNER" }, { identifier: "+918008046952", ...overrides });

describe("Send again on a tenancy the expiry sweep closed", () => {
  it("issues a new link valid for 7 more days, and that link opens onboarding", async () => {
    const result = await sendAgain();

    expect(invitation().token).not.toBe("old-token");
    expect(invitation().status).toBe("PENDING");
    expect(invitation().cancelled_at).toBeNull();
    const days = (new Date(invitation().expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7.01);
    expect(result.activation_link).toContain(`/activate/${invitation().token}`);
    expect(result.expires_at).toBe(new Date(invitation().expires_at).toISOString());

    // The refreshed link is not rejected as expired or closed.
    const resolved = await service.resolveByToken(invitation().token);
    expect(resolved.tenant.id).toBe("tenant-1");
    expect(resolved.invitation.id).toBe("inv-1");
  });

  it("works the same when payments are on record — the link refresh never needs to touch them", async () => {
    seedSweptTenancy({ paymentsCount: 3 });
    const result = await sendAgain();

    expect(tenant().status).toBe("ACTIVE");
    expect(result.activation_link).toContain(`/activate/${invitation().token}`);
    await expect(service.resolveByToken(invitation().token)).resolves.toBeTruthy();
  });

  it("does not rebuild the tenancy's dues — no full resend, no deleted obligations", async () => {
    await sendAgain();
    expect(db.current.rent_obligations.deleteMany).not.toHaveBeenCalled();
    expect(db.current.tenant_invitation_reservations.create).not.toHaveBeenCalled();
    expect(h.state.invitations).toHaveLength(1);
  });

  it("re-holds the bed: the ended allocation is reopened in place and the tenancy is live again", async () => {
    const result = await sendAgain();

    expect(h.state.allocations).toEqual([expect.objectContaining({ id: "alloc-1", is_active: true, end_date: null })]);
    expect(tenant()).toMatchObject({ status: "ACTIVE", access_mode: "OWNER_MANAGED", acceptance_status: "PENDING" });
    expect(assertOwnerCanActivateTenant).toHaveBeenCalledWith("owner-1", expect.objectContaining({ tenantId: "tenant-1" }));
    expect(result).toMatchObject({ reopened: true, bed_held: true });
  });

  it("restores only the rent the sweep voided, in place — no duplicates, payments untouched", async () => {
    await sendAgain();

    // Started month → UPCOMING then made payable below; future rent →
    // UPCOMING (the daily cron promotes it); future maintenance → PENDING
    // (nothing would ever promote an UPCOMING one).
    expect(ob("ob-now").status).toBe("UPCOMING");
    expect(ob("ob-next").status).toBe("UPCOMING");
    expect(ob("ob-next-maint").status).toBe("PENDING");
    for (const id of ["ob-now", "ob-next", "ob-next-maint"]) {
      expect(ob(id)).toMatchObject({
        lifecycle_status: "ACTIVE",
        settlement_status: "UNPAID",
        waived_reason: null,
        waived_at: null,
        waived_amount: null,
        allocation_id: "alloc-1",
      });
    }
    // Same rows, not new ones: nothing was created.
    expect(h.state.obligations).toHaveLength(7);
    expect(ob("ob-owner-waived")).toMatchObject({ status: "WAIVED", waived_reason: "Owner goodwill" });
    expect(ob("ob-superseded").status).toBe("WAIVED");
    expect(ob("ob-live-dup").status).toBe("UPCOMING");
    expect(ob("ob-paid")).toMatchObject({ status: "PAID", settlement_status: "PAID" });

    // Each restored waiver's ledger debit is reversed — and only those.
    const reversed = vi.mocked(tenantFinancialLedgerService.reverseObligationWaiverInTx).mock.calls.map((c) => c[1].obligationId);
    expect(reversed.sort()).toEqual(["ob-next", "ob-next-maint", "ob-now"]);

    // The month that has started goes payable through the normal path.
    expect(financialLifecycleService.activatePayableObligations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: "tenant-1", obligationIds: ["ob-now"] }),
    );
  });

  it("returns the new link even when WhatsApp delivery fails", async () => {
    delivery = { whatsapp_sent: false, email_sent: false, whatsapp_error: "(#131030) not in allowed list", needs_email: true };
    const result = await sendAgain();

    expect(result.whatsapp_sent).toBe(false);
    expect(result.activation_link).toContain(`/activate/${invitation().token}`);
    expect(result.activation_link).not.toContain("old-token");
  });

  it("uses an owner-supplied email as the delivery fallback only — no rebuild, even with payments", async () => {
    seedSweptTenancy({ paymentsCount: 2 });
    await sendAgain({ email: "Ravi@Gmail.com" });

    expect(invitation().email).toBe("ravi@gmail.com");
    expect(tenant().status).toBe("ACTIVE");
    expect(db.current.rent_obligations.deleteMany).not.toHaveBeenCalled();
  });

  it("a cancelled tenancy is not reopened", async () => {
    tenant().status = "CANCELLED";
    await expect(sendAgain()).rejects.toThrow(/cancelled/i);
    expect(invitation().token).toBe("old-token");
  });
});

describe("when the bed has been taken meanwhile", () => {
  beforeEach(() => {
    Object.assign(h.capacity, { available: 0, occupied: 2, reserved: 0, capacity: 2 });
  });

  it("still sends a working link, but holds no bed and restores no rent", async () => {
    const result = await sendAgain();

    expect(tenant().status).toBe("INVITED");
    expect(h.state.allocations[0]).toMatchObject({ is_active: false });
    expect(ob("ob-next").status).toBe("WAIVED");
    expect(tenantFinancialLedgerService.reverseObligationWaiverInTx).not.toHaveBeenCalled();
    expect(assertOwnerCanActivateTenant).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reopened: true, bed_held: false });
    await expect(service.resolveByToken(invitation().token)).resolves.toBeTruthy();
  });

  it("activation gives the tenant the room if a bed is free by then, and brings the rent back", async () => {
    await sendAgain();
    // A bed frees up. The tenant's own live invitation is counted as a hold
    // (`reserved`) and must not count against them.
    Object.assign(h.capacity, { available: 0, occupied: 1, reserved: 1, capacity: 2 });
    vi.spyOn(service, "voidCompetingInvitations").mockResolvedValue([]);

    await service.completeActivation(invitation(), tenant(), { id: "profile-1" });

    const live = h.state.allocations.filter((a: any) => a.is_active);
    expect(live).toEqual([expect.objectContaining({ tenant_id: "tenant-1", room_id: "room-401" })]);
    expect(ob("ob-next")).toMatchObject({ status: "UPCOMING", allocation_id: live[0].id });
    expect(tenant()).toMatchObject({ status: "ACTIVE", acceptance_status: "ACCEPTED" });
  });

  it("activation refuses cleanly while the room is still full", async () => {
    await sendAgain();
    // Full of occupants, plus the tenant's own hold.
    Object.assign(h.capacity, { available: 0, occupied: 2, reserved: 1, capacity: 2 });
    vi.spyOn(service, "voidCompetingInvitations").mockResolvedValue([]);

    await expect(service.completeActivation(invitation(), tenant(), { id: "profile-1" })).rejects.toThrow(/CAPACITY_EXCEEDED/);
  });
});

describe("reopenExpiredTenancy guards", () => {
  it("leaves a tenancy that is not EXPIRED alone", async () => {
    tenant().status = "ACTIVE";
    const result = await reopenExpiredTenancy(db.current, { tenantId: "tenant-1", roomId: "room-401", hostelId: "hostel-1", ownerId: "owner-1", actorId: "owner-1" });
    expect(result.reopened).toBe(false);
    expect(db.current.tenants.update).not.toHaveBeenCalled();
  });

  it("refuses when the person has since been given another live stay", async () => {
    h.state.tenants.push({ id: "tenant-2", status: "ACTIVE", phone_1: "+918008046952" });
    await expect(
      reopenExpiredTenancy(db.current, { tenantId: "tenant-1", roomId: "room-401", hostelId: "hostel-1", ownerId: "owner-1", actorId: "owner-1" }),
    ).rejects.toThrow(/another active stay/);
    expect(tenant().status).toBe("EXPIRED");
  });
});

describe("the refreshed link vs the closed tenancy (why reopening is required)", () => {
  it("a fresh token on a still-EXPIRED tenancy is rejected — the old bug", async () => {
    Object.assign(invitation(), { token: "fresh", status: "PENDING", expires_at: new Date(Date.now() + 7 * 86_400_000) });
    await expect(service.resolveByToken("fresh")).rejects.toThrow(/EXPIRED/);
  });
});

describe("reverseObligationWaiverInTx", () => {
  function ledgerTx(entries: any[]) {
    return {
      tenants: { findUnique: vi.fn(async () => ({ id: "tenant-1", hostel_id: "hostel-1", owner_id: "owner-1" })) },
      $queryRaw: vi.fn(async () => []),
      tenant_financial_ledger: {
        aggregate: vi.fn(async ({ where }: any) => ({
          _sum: { amount: entries.filter((e) => matches(e, where)).reduce((sum, e) => sum + e.amount, 0) },
        })),
        create: vi.fn(async ({ data }: any) => {
          entries.push(data);
          return data;
        }),
      },
    } as any;
  }
  const params = { obligationId: "ob-1", tenantId: "tenant-1", ownerId: "owner-1", createdBy: "owner-1" };
  const waiver = (amount: number) => ({ tenant_id: "tenant-1", type: "DEBIT", reason: "OBLIGATION_WAIVER", reference_id: "ob-1", reference_type: WAIVER_REFERENCE_TYPE, amount });

  beforeEach(() => {
    vi.mocked(tenantFinancialLedgerService.reverseObligationWaiverInTx).mockRestore();
  });

  it("credits back exactly the waiver's debit, once", async () => {
    const entries = [{ tenant_id: "tenant-1", type: "CREDIT", reason: "SECURITY_DEPOSIT_COLLECTED", amount: 10000 }, waiver(8500)];
    const tx = ledgerTx(entries);

    expect(await tenantFinancialLedgerService.reverseObligationWaiverInTx(tx, params)).toBe(8500);
    expect(entries[2]).toMatchObject({ type: "CREDIT", reason: "LEDGER_CORRECTION", amount: 8500, reference_id: "ob-1", reference_type: WAIVER_REVERSAL_REFERENCE_TYPE, balance_after: 10000 });

    // A retry reverses nothing more.
    expect(await tenantFinancialLedgerService.reverseObligationWaiverInTx(tx, params)).toBe(0);
    expect(entries).toHaveLength(3);
  });

  it("waived, restored and waived again: the second restore reverses only the second waiver", async () => {
    const entries = [waiver(8500), { tenant_id: "tenant-1", type: "CREDIT", reference_id: "ob-1", reference_type: WAIVER_REVERSAL_REFERENCE_TYPE, amount: 8500 }, waiver(8500)];
    expect(await tenantFinancialLedgerService.reverseObligationWaiverInTx(ledgerTx(entries), params)).toBe(8500);
    expect(entries).toHaveLength(4);
  });

  it("writes nothing for an obligation that was never waived on the ledger", async () => {
    const entries: any[] = [];
    expect(await tenantFinancialLedgerService.reverseObligationWaiverInTx(ledgerTx(entries), params)).toBe(0);
    expect(entries).toHaveLength(0);
  });
});

describe("the expiry sweep reclaims a tenancy reopened without a bed", () => {
  it("findDue covers INVITED owner-managed unaccepted tenancies as well as live ones", async () => {
    const { unacceptedTenancyExpiryService } = await import("@/src/services/tenants/unaccepted-tenancy-expiry-service");
    db.current.tenants.findMany = vi.fn(async () => []);
    await unacceptedTenancyExpiryService.findDue(new Date());
    const where = db.current.tenants.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ status: "ACTIVE" }, { status: "INVITED", access_mode: "OWNER_MANAGED" }]);
    expect(where.acceptance_status).toBe("PENDING");
  });
});
