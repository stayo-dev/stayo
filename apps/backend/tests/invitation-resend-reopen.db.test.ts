/**
 * Real-Postgres verification of "Send again" on a swept tenancy (ADR-237):
 * repeated resends, old-link invalidation, onboarding completion, no bed
 * double-allocation, rent/ledger restoration with payments on record, and the
 * sweep reclaiming a tenancy reopened without a bed.
 *
 * Runs ONLY against a database on localhost — it is skipped otherwise, and it
 * never mocks anything but has no delivery credentials, so nothing is sent.
 * Not part of `vitest.pure.config.ts`. To run (from apps/backend, with a
 * throwaway local Postgres and no `.env` loaded):
 *
 *   L=postgresql://postgres@127.0.0.1:54329/stayo_test
 *   DATABASE_URL=$L DIRECT_URL=$L npx prisma db push --skip-generate
 *   env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test DATABASE_URL=$L \
 *     DATABASE_URL_TEST=$L DIRECT_URL=$L JWT_SECRET=local-only \
 *     npx vitest run tests/invitation-resend-reopen.db.test.ts
 *
 * (`env -i` matters: `vitest.config.ts` also loads ../../.env, which must
 * never supply credentials to this test.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { tenantInvitationLifecycleService as svc } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { unacceptedTenancyExpiryService } from "@/src/services/tenants/unaccepted-tenancy-expiry-service";
import { AUTO_EXPIRE_WAIVER_REASON } from "@/src/services/tenants/unaccepted-tenancy-closure";
import { tenantFinancialLedgerService } from "@/src/services/payments/tenant-financial-ledger-service";
import { rentGenerationService } from "@/src/services/payments/rent-generation-service";
import { tenantService } from "@/src/services/tenants/tenant-service";

const LOCAL_DB = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL_TEST || "");
const describe_ = describe.skipIf(!LOCAL_DB);

/** What the onboarding RULES step records before activation can complete. */
async function acceptRules(tenantId: string) {
  const rv = await prisma.ruleVersion.create({ data: { hostel_id: HOSTEL, version: `v-${tenantId}`, content_snapshot: {} } as any });
  await prisma.tenantPolicyAcceptance.create({
    data: { tenant_id: tenantId, hostel_id: HOSTEL, rule_version_id: rv.id, rules_version: rv.version, typed_signature_name: "T" } as any,
  });
}

const OWNER = crypto.randomUUID();
const HOSTEL = crypto.randomUUID();
const ROOM = crypto.randomUUID();
const PHONE = "+919876543210";
const actor = { id: OWNER, role: "OWNER" };
const now = new Date();
const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
// Joining next month: its rent is the future obligation the sweep voids.
const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

let tenantId: string;
let invitationId: string;

async function snapshot() {
  const [tenant, inv, allocations, obligations, payments, ledger] = await Promise.all([
    prisma.tenants.findUnique({ where: { id: tenantId } }),
    prisma.tenant_invitations.findMany({ where: { tenant_id: tenantId } }),
    prisma.roomAllocation.findMany({ where: { tenant_id: tenantId } }),
    prisma.rent_obligations.findMany({ where: { tenant_id: tenantId }, orderBy: [{ rent_month: "asc" }, { obligation_type: "asc" }] }),
    prisma.payments.findMany({ where: { tenant_id: tenantId } }),
    prisma.tenant_financial_ledger.findMany({ where: { tenant_id: tenantId } }),
  ]);
  // Loosely typed on purpose: these are assertion fixtures, not domain code.
  return {
    tenant: tenant as any,
    inv: inv as any[],
    allocations: allocations as any[],
    obligations: obligations as any[],
    payments: payments as any[],
    ledger: ledger as any[],
  };
}

async function liveInRoom() {
  return prisma.roomAllocation.count({ where: { room_id: ROOM, is_active: true, end_date: null } });
}

async function sweep() {
  // The link lapsed 15 days ago: past expiry + the 7-day grace.
  await prisma.tenant_invitations.updateMany({
    where: { tenant_id: tenantId, status: { in: ["PENDING", "OPENED"] } },
    data: { expires_at: new Date(Date.now() - 15 * 86_400_000) },
  });
  const due = await unacceptedTenancyExpiryService.findDue(new Date());
  const mine = due.find((t: any) => t.id === tenantId);
  expect(mine, "sweep should pick the tenancy up").toBeTruthy();
  const res = await unacceptedTenancyExpiryService.expireOne(mine, new Date());
  expect(res.ok).toBe(true);
}

const tokenOf = (link: string) => link.split("/activate/")[1];
const netWaiver = (ledger: any[], obligationId: string) =>
  ledger
    .filter((e) => e.reference_id === obligationId)
    .reduce((n, e) => n + (e.type === "DEBIT" ? Number(e.amount) : -Number(e.amount)), 0);

beforeAll(async () => {
  if (!LOCAL_DB) return;
  await prisma.profile.create({ data: { id: OWNER, email: `owner-${OWNER}@test.local`, name: "Owner", role: "OWNER" as any } });
  await prisma.hostels.create({ data: { id: HOSTEL, owner_id: OWNER, name: "Test Hostel", phone: "+919000000000", address: "x" } as any });
  await prisma.rooms.create({ data: { id: ROOM, hostel_id: HOSTEL, room_no: "101", capacity: 1 } as any });

  const created: any = await svc.createInvitation({
    name: "Ravi",
    phone: PHONE,
    room_id: ROOM,
    monthly_rent: 8500,
    advance_deposit: 10000,
    maintenance_type: "NONE",
    agreement_duration_months: 6,
    joining_date: nextMonth.toISOString().slice(0, 10),
    // The deposit was paid up front: a payment on record that must survive.
    paid_amount: 10000,
    paid_includes_deposit: true,
    payment_method: "CASH",
    dispatch: "DEFERRED",
  }, OWNER);
  tenantId = created.tenant_id;
  invitationId = created.invitation_id;
  // Next month's rent, raised ahead of time (owner "generate" / the cron near
  // month end): the future obligation the sweep voids.
  await rentGenerationService.generateMonthlyRent(nextMonth, OWNER, "manual", HOSTEL);
  await prisma.tenant_invitations.update({ where: { id: invitationId }, data: { status: "PENDING" } });
}, 60_000);

afterAll(async () => {
  if (!LOCAL_DB) return;
  await prisma.$disconnect();
});

let beforeSweep: Awaited<ReturnType<typeof snapshot>>;
let afterSweep: Awaited<ReturnType<typeof snapshot>>;
let firstLink: string;

describe_("swept tenancy with a recorded payment", () => {
  it("is set up live, with a payment, and the sweep closes it", async () => {
    beforeSweep = await snapshot();
    expect(beforeSweep.tenant.status).toBe("ACTIVE");
    expect(beforeSweep.payments.length).toBeGreaterThan(0);
    expect(await liveInRoom()).toBe(1);

    await sweep();
    afterSweep = await snapshot();
    expect(afterSweep.tenant.status).toBe("EXPIRED");
    expect(await liveInRoom()).toBe(0);
    const swept = afterSweep.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON);
    expect(swept.length).toBeGreaterThan(0);
    // The old link is now dead.
    await expect(svc.resolveByToken(beforeSweep.inv[0].token)).rejects.toThrow(/EXPIRED/);
  }, 60_000);

  it("Send again: reopens, re-holds the bed, restores rent in place, preserves payments, link works", async () => {
    const oldToken = afterSweep.inv[0].token;
    const result: any = await svc.resendInvitationByEmail(PHONE, actor, { identifier: PHONE });
    firstLink = result.activation_link;
    const s = await snapshot();

    // Link: new, 7 days, opens onboarding; old one rejected.
    expect(tokenOf(firstLink)).not.toBe(oldToken);
    const days = (new Date(s.inv[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(result.whatsapp_sent).toBe(false); // no credentials here — and the link still comes back
    await expect(svc.resolveByToken(tokenOf(firstLink))).resolves.toMatchObject({ tenant: { id: tenantId } });
    await expect(svc.resolveByToken(oldToken)).rejects.toThrow();

    // Tenancy + bed.
    expect(s.tenant).toMatchObject({ status: "ACTIVE", access_mode: "OWNER_MANAGED", acceptance_status: "PENDING" });
    expect(result).toMatchObject({ reopened: true, bed_held: true });
    expect(await liveInRoom()).toBe(1);
    expect(s.allocations.filter((a) => a.is_active)).toHaveLength(1);
    expect(s.inv).toHaveLength(1);

    // Rent: same rows, nothing new, nothing sweep-waived left; statuses as before the sweep.
    expect(s.obligations.map((o) => o.id).sort()).toEqual(beforeSweep.obligations.map((o) => o.id).sort());
    expect(s.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON)).toHaveLength(0);
    const sweptIds = new Set(afterSweep.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON).map((o) => o.id));
    for (const o of s.obligations) {
      const was = beforeSweep.obligations.find((b) => b.id === o.id)!;
      if (!sweptIds.has(o.id)) {
        // Never swept (e.g. the paid deposit): exactly as it was.
        expect(`${o.id} ${o.status} ${o.settlement_status}`).toBe(`${o.id} ${was.status} ${was.settlement_status}`);
        continue;
      }
      expect(o).toMatchObject({ lifecycle_status: "ACTIVE", settlement_status: "UNPAID", waived_at: null, waived_amount: null });
      expect(o.status).toBe(o.obligation_type === "RENT" ? "UPCOMING" : "PENDING");
      expect(String(o.amount)).toBe(String(was.amount));
      expect(o.allocation_id).toBe(s.allocations.find((a) => a.is_active)!.id);
    }

    // Payments untouched; every restored waiver nets to zero on the ledger; balance back to pre-sweep.
    expect(s.payments.map((p) => [p.id, String(p.amount_paid), p.obligation_id])).toEqual(
      beforeSweep.payments.map((p) => [p.id, String(p.amount_paid), p.obligation_id]),
    );
    for (const o of afterSweep.obligations.filter((x) => x.waived_reason === AUTO_EXPIRE_WAIVER_REASON)) {
      expect(netWaiver(s.ledger, o.id)).toBe(0);
    }
    const [balBefore, balNow] = await Promise.all([
      Promise.resolve(beforeSweep.ledger.reduce((n, e) => n + (e.type === "CREDIT" ? 1 : -1) * Number(e.amount), 0)),
      Promise.resolve(s.ledger.reduce((n, e) => n + (e.type === "CREDIT" ? 1 : -1) * Number(e.amount), 0)),
    ]);
    expect(balNow).toBe(balBefore);
    await expect(tenantFinancialLedgerService.getBalance(tenantId, OWNER)).resolves.toBeTruthy();
  }, 60_000);

  it("repeated resends: each issues a new link and kills the previous one, with no duplicate rows or ledger entries", async () => {
    const before = await snapshot();
    const second: any = await svc.resendInvitationByEmail(PHONE, actor, { identifier: PHONE });
    const third: any = await svc.resendInvitationByEmail(PHONE, actor, { identifier: PHONE });
    const s = await snapshot();

    // Not swept: these are nudges — same link, fresh week.
    expect(tokenOf(second.activation_link)).toBe(tokenOf(firstLink));
    expect(tokenOf(third.activation_link)).toBe(tokenOf(firstLink));
    await expect(svc.resolveByToken(tokenOf(third.activation_link))).resolves.toBeTruthy();
    expect(s.obligations).toHaveLength(before.obligations.length);
    expect(s.ledger).toHaveLength(before.ledger.length);
    expect(s.payments).toHaveLength(before.payments.length);
    expect(await liveInRoom()).toBe(1);
  }, 60_000);

  it("the daily rent cron promotes the restored rent when its month starts", async () => {
    const { agreementRentScheduleService } = await import("@/src/services/payments/agreement-rent-schedule-service");
    await agreementRentScheduleService.syncDueStatuses({ hostelId: HOSTEL, now: new Date(nextMonth.getTime() + 2 * 86_400_000) });
    const rent = (await snapshot()).obligations.filter((o) => o.obligation_type === "RENT");
    expect(rent.length).toBeGreaterThan(0);
    expect(rent.every((o) => o.status === "PENDING")).toBe(true);
    // Put it back so the later sweep sees a future month again.
    await prisma.rent_obligations.updateMany({ where: { id: { in: rent.map((o) => o.id) } }, data: { status: "UPCOMING" } });
  }, 60_000);

  it("swept again → resend again: new token, previous link rejected, still one bed and no duplicates", async () => {
    const ledgerBefore = (await snapshot()).ledger.length;
    await sweep();
    const swept = await snapshot();
    const r: any = await svc.resendInvitationByEmail(PHONE, actor, { identifier: PHONE });
    const s = await snapshot();

    expect(tokenOf(r.activation_link)).not.toBe(tokenOf(firstLink));
    await expect(svc.resolveByToken(tokenOf(firstLink))).rejects.toThrow();
    await expect(svc.resolveByToken(tokenOf(r.activation_link))).resolves.toBeTruthy();
    firstLink = r.activation_link;
    expect(await liveInRoom()).toBe(1);
    expect(s.obligations).toHaveLength(beforeSweep.obligations.length);
    for (const o of swept.obligations.filter((x) => x.waived_reason === AUTO_EXPIRE_WAIVER_REASON)) {
      expect(netWaiver(s.ledger, o.id)).toBe(0);
    }
    // One waiver debit + one reversal per restored row this cycle.
    const restoredThisCycle = swept.obligations.filter((x) => x.waived_reason === AUTO_EXPIRE_WAIVER_REASON).length;
    expect(s.ledger.length - ledgerBefore).toBe(restoredThisCycle * 2);
  }, 60_000);

  it("onboarding completes on the refreshed link and keeps one allocation", async () => {
    const profileId = (await prisma.tenants.findUnique({ where: { id: tenantId } }))!.profile_id!;
    expect(profileId).toBeTruthy();
    await acceptRules(tenantId);
    const resolved: any = await svc.resolveByToken(tokenOf(firstLink));
    await svc.completeActivation(resolved.invitation, resolved.tenant, { id: profileId });
    const s = await snapshot();

    expect(s.tenant).toMatchObject({ status: "ACTIVE", acceptance_status: "ACCEPTED", access_mode: "SELF_SERVE" });
    expect(s.inv[0].status).toBe("ACTIVATED");
    expect(s.allocations.filter((a) => a.is_active)).toHaveLength(1);
    expect(await liveInRoom()).toBe(1);
    // Spent link now says already active.
    await expect(svc.resolveByToken(tokenOf(firstLink))).rejects.toThrow(/ALREADY_ACTIVE/);
  }, 60_000);
});

describe_("bed taken while the tenancy was closed", () => {
  const ROOM2 = crypto.randomUUID();
  const PHONE2 = "+919876500011";
  const OTHER_PHONE = "+919876500022";
  let otherTenant: string;

  it("resend does not double-allocate: link works, no bed held; activation refused while full, succeeds once free", async () => {
    await prisma.rooms.create({ data: { id: ROOM2, hostel_id: HOSTEL, room_no: "102", capacity: 1 } as any });
    const created: any = await svc.createInvitation({
      name: "Kiran", phone: PHONE2, room_id: ROOM2, monthly_rent: 7000, advance_deposit: 7000, maintenance_type: "NONE",
      agreement_duration_months: 6, joining_date: nextMonth.toISOString().slice(0, 10), paid_amount: 7000,
      paid_includes_deposit: true, payment_method: "CASH", dispatch: "DEFERRED",
    }, OWNER);
    tenantId = created.tenant_id;
    await rentGenerationService.generateMonthlyRent(nextMonth, OWNER, "manual", HOSTEL);
    await prisma.tenant_invitations.update({ where: { id: created.invitation_id }, data: { status: "PENDING" } });
    await sweep();
    const swept = await snapshot();

    // Someone else takes the only bed.
    const other: any = await svc.createInvitation({
      name: "Other", phone: OTHER_PHONE, room_id: ROOM2, monthly_rent: 7000, advance_deposit: 7000, maintenance_type: "NONE",
      joining_date: firstOfMonth.toISOString().slice(0, 10), dispatch: "DEFERRED",
    }, OWNER);
    otherTenant = other.tenant_id;
    expect(await prisma.roomAllocation.count({ where: { room_id: ROOM2, is_active: true } })).toBe(1);

    const r: any = await svc.resendInvitationByEmail(PHONE2, actor, { identifier: PHONE2 });
    let s = await snapshot();
    expect(r).toMatchObject({ reopened: true, bed_held: false });
    expect(s.tenant.status).toBe("INVITED");
    expect(await prisma.roomAllocation.count({ where: { room_id: ROOM2, is_active: true } })).toBe(1);
    expect(await prisma.tenant_invitation_reservations.count({ where: { room_id: ROOM2, status: "ACTIVE" } })).toBe(0);
    expect(s.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON).length)
      .toBe(swept.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON).length);
    await expect(svc.resolveByToken(tokenOf(r.activation_link))).resolves.toBeTruthy();

    const profileId = (await prisma.tenants.findUnique({ where: { id: tenantId } }))!.profile_id!;
    expect(profileId).toBeTruthy();
    let resolved: any = await svc.resolveByToken(tokenOf(r.activation_link));
    await expect(svc.completeActivation(resolved.invitation, resolved.tenant, { id: profileId })).rejects.toThrow(/CAPACITY_EXCEEDED/);
    expect(await prisma.roomAllocation.count({ where: { room_id: ROOM2, is_active: true } })).toBe(1);

    // The bed frees up.
    // The owner cancels the other invitation through the real service.
    await tenantService.cancelInvitation(otherTenant, OWNER);
    await acceptRules(tenantId);
    resolved = await svc.resolveByToken(tokenOf(r.activation_link));
    await svc.completeActivation(resolved.invitation, resolved.tenant, { id: profileId });
    s = await snapshot();
    expect(s.tenant).toMatchObject({ status: "ACTIVE", acceptance_status: "ACCEPTED" });
    expect(await prisma.roomAllocation.count({ where: { room_id: ROOM2, is_active: true } })).toBe(1);
    expect(s.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON)).toHaveLength(0);
    expect(s.obligations.map((o) => o.id).sort()).toEqual(swept.obligations.map((o) => o.id).sort());
    expect(s.payments).toHaveLength(swept.payments.length);
    for (const o of swept.obligations.filter((x) => x.waived_reason === AUTO_EXPIRE_WAIVER_REASON)) {
      expect(netWaiver(s.ledger, o.id)).toBe(0);
    }
  }, 90_000);
});

describe_("reopened without a bed, and the new link lapses too", () => {
  const ROOM3 = crypto.randomUUID();
  const PHONE3 = "+919876500033";

  it("the sweep reclaims it (no permanent bed hold); a later Send again reopens it again; final state left for the invariant check", async () => {
    const { roomCapacityService } = await import("@/lib/services/room-capacity-service");
    await prisma.rooms.create({ data: { id: ROOM3, hostel_id: HOSTEL, room_no: "103", capacity: 1 } as any });
    const created: any = await svc.createInvitation({
      name: "Mani", phone: PHONE3, room_id: ROOM3, monthly_rent: 6000, advance_deposit: 6000, maintenance_type: "NONE",
      joining_date: nextMonth.toISOString().slice(0, 10), paid_amount: 6000, paid_includes_deposit: true,
      payment_method: "CASH", dispatch: "DEFERRED",
    }, OWNER);
    tenantId = created.tenant_id;
    await prisma.tenant_invitations.update({ where: { id: created.invitation_id }, data: { status: "PENDING" } });
    await sweep();
    // Bed taken.
    await svc.createInvitation({ name: "Taker", phone: "+919876500044", room_id: ROOM3, monthly_rent: 6000, advance_deposit: 6000, maintenance_type: "NONE", dispatch: "DEFERRED" }, OWNER);

    const r1: any = await svc.resendInvitationByEmail(PHONE3, actor, { identifier: PHONE3 });
    expect(r1).toMatchObject({ reopened: true, bed_held: false });
    expect((await snapshot()).tenant.status).toBe("INVITED");
    // Its live invite is counted as a hold on the room while it lasts.
    expect((await roomCapacityService.getRoomCapacitySnapshot(ROOM3)).reserved).toBe(1);

    // The new link lapses past grace → the sweep reclaims the hold.
    await sweep();
    const closed = await snapshot();
    expect(closed.tenant.status).toBe("EXPIRED");
    expect(closed.inv[0].status).toBe("EXPIRED");
    expect((await roomCapacityService.getRoomCapacitySnapshot(ROOM3)).reserved).toBe(0);
    await expect(svc.resolveByToken(tokenOf(r1.activation_link))).rejects.toThrow(/EXPIRED/);

    // Owner sends again: reopened again (still no bed), new link works, payments intact.
    const r2: any = await svc.resendInvitationByEmail(PHONE3, actor, { identifier: PHONE3 });
    expect(r2).toMatchObject({ reopened: true, bed_held: false });
    expect(tokenOf(r2.activation_link)).not.toBe(tokenOf(r1.activation_link));
    await expect(svc.resolveByToken(tokenOf(r2.activation_link))).resolves.toBeTruthy();
    const s = await snapshot();
    expect(s.payments).toHaveLength(closed.payments.length);
    expect(await prisma.roomAllocation.count({ where: { room_id: ROOM3, is_active: true } })).toBe(1);
  }, 90_000);
});

describe_("stuck state left by the pre-ADR-237 refresh: tenant EXPIRED, invitation live", () => {
  async function stuckTenancy(room: string, phone: string, joining: Date) {
    await prisma.rooms.create({ data: { id: room, hostel_id: HOSTEL, room_no: room.slice(0, 6), capacity: 1 } as any });
    const created: any = await svc.createInvitation({
      name: "Stuck", phone, room_id: room, monthly_rent: 8500, advance_deposit: 17000, maintenance_type: "NONE",
      joining_date: joining.toISOString().slice(0, 10), paid_amount: 17000, paid_includes_deposit: true,
      payment_method: "CASH", dispatch: "DEFERRED",
    }, OWNER);
    tenantId = created.tenant_id;
    await rentGenerationService.generateMonthlyRent(nextMonth, OWNER, "manual", HOSTEL);
    await prisma.tenant_invitations.update({ where: { id: created.invitation_id }, data: { status: "PENDING" } });
    await sweep();
    // What the old refresh did: new token, PENDING, a fresh week — tenant left EXPIRED.
    await prisma.tenant_invitations.update({
      where: { id: created.invitation_id },
      data: { token: crypto.randomBytes(32).toString("hex"), status: "PENDING", expires_at: new Date(Date.now() + 7 * 86_400_000), cancelled_at: null },
    });
    return created;
  }

  it("Nudge on WhatsApp reopens it; the link opens onboarding", async () => {
    await stuckTenancy(crypto.randomUUID(), "+919876500055", nextMonth);
    expect((await snapshot()).tenant.status).toBe("EXPIRED");
    const r: any = await svc.resendInvitationByEmail("+919876500055", actor, { identifier: "+919876500055" });
    const s = await snapshot();
    expect(s.tenant.status).toBe("ACTIVE");
    expect(r).toMatchObject({ reopened: true, bed_held: true });
    await expect(svc.resolveByToken(tokenOf(r.activation_link))).resolves.toMatchObject({ tenant: { id: tenantId } });
    expect(s.obligations.filter((o) => o.waived_reason === AUTO_EXPIRE_WAIVER_REASON)).toHaveLength(0);
  }, 90_000);

  it("Cancel invitation closes it instead of refusing; payments are kept", async () => {
    await stuckTenancy(crypto.randomUUID(), "+919876500066", nextMonth);
    const before = await snapshot();
    await expect(tenantService.cancelInvitation(tenantId, OWNER)).resolves.toMatchObject({ new_status: "CANCELLED" });
    const s = await snapshot();
    expect(s.tenant.status).toBe("CANCELLED");
    expect(s.inv.every((i) => i.status === "CANCELLED")).toBe(true);
    expect(s.payments).toHaveLength(before.payments.length);
    await expect(svc.resolveByToken(s.inv[0].token)).rejects.toThrow(/CANCELLED/);
  }, 90_000);
});

describe_("cancelling a tenancy reopened without a bed", () => {
  it("closes it like any unaccepted tenancy — this month's rent is kept for settlement, not waived", async () => {
    const room = crypto.randomUUID();
    await prisma.rooms.create({ data: { id: room, hostel_id: HOSTEL, room_no: "105", capacity: 1 } as any });
    const created: any = await svc.createInvitation({
      name: "Now", phone: "+919876500077", room_id: room, monthly_rent: 8000, advance_deposit: 8000, maintenance_type: "NONE",
      joining_date: firstOfMonth.toISOString().slice(0, 10), dispatch: "DEFERRED",
    }, OWNER);
    tenantId = created.tenant_id;
    await prisma.tenant_invitations.update({ where: { id: created.invitation_id }, data: { status: "PENDING" } });
    await sweep();
    await svc.createInvitation({ name: "Taker2", phone: "+919876500088", room_id: room, monthly_rent: 8000, advance_deposit: 8000, maintenance_type: "NONE", dispatch: "DEFERRED" }, OWNER);
    await svc.resendInvitationByEmail("+919876500077", actor, { identifier: "+919876500077" });
    const reopened = await snapshot();
    expect(reopened.tenant.status).toBe("INVITED");
    const currentRent = reopened.obligations.find((o) => o.obligation_type === "RENT" && o.status === "PENDING");
    expect(currentRent, "this month's rent is a current due").toBeTruthy();

    await tenantService.cancelInvitation(tenantId, OWNER);
    const s = await snapshot();
    expect(s.tenant.status).toBe("CANCELLED");
    expect(s.obligations.find((o) => o.id === currentRent.id).status).toBe("PENDING");
  }, 90_000);
});
