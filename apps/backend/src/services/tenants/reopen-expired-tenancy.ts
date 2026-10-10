import { roomCapacityService } from "../../../lib/services/room-capacity-service";
import { tenantFinancialLedgerService } from "../payments/tenant-financial-ledger-service";
import { assertOwnerCanActivateTenant } from "@/src/services/platform-billing/tenant-activation-guard";
import { ensureActiveAllocation } from "./tenancy-allocation";
import { AUTO_EXPIRE_WAIVER_REASON } from "./unaccepted-tenancy-closure";

/**
 * Reopen a tenancy the expiry sweep closed, because the owner re-sent its
 * invitation — the inverse of `closeUnacceptedTenancy` for `EXPIRED`.
 *
 * The owner pressing "Send again" is the owner saying the offer still stands,
 * so the link they send has to work: `resolveByToken` refuses any tenancy whose
 * status is EXPIRED, whatever its invitation says.
 *
 * - **Bed free** → the tenancy goes back to exactly what `createInvitation`
 *   made it: ACTIVE, owner-managed, acceptance still PENDING, holding a real
 *   allocation (the one the sweep ended, reopened in place). The future rent
 *   the sweep voided comes back — see `restoreSweptObligations`.
 * - **Room full** (someone took the bed meanwhile) → the tenancy reopens as
 *   INVITED and holds nothing: no allocation, no reservation, no rent. The link
 *   still works; the tenant gets the room at activation if a bed is free then
 *   (`completeActivation` allocates the invitation's room under the same
 *   capacity guard), and the voided rent comes back at that point.
 *
 * Payments, receipts, past dues and the deposit are never touched — the sweep
 * kept them and so does this.
 *
 * Must run INSIDE a `prisma.$transaction`. A tenancy that is not EXPIRED is
 * left alone (`reopened: false`), so a retried resend is harmless.
 */
export async function reopenExpiredTenancy(
  tx: any,
  params: { tenantId: string; roomId: string; hostelId: string; ownerId: string; actorId: string },
): Promise<{ reopened: boolean; bedHeld: boolean; restoredObligationIds: string[] }> {
  const { tenantId, roomId, hostelId, ownerId, actorId } = params;

  const rows = await tx.$queryRaw`
    SELECT id, status, phone_1, joined_on FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
  `;
  const tenant = rows?.[0];
  if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
  if (tenant.status !== "EXPIRED") return { reopened: false, bedHeld: false, restoredObligationIds: [] };

  // Since the sweep, this person may have been invited again (fresh link,
  // same phone). Reopening the old tenancy too would give them two live stays.
  if (tenant.phone_1) {
    const other = await tx.tenants.findFirst({
      where: { id: { not: tenantId }, phone_1: tenant.phone_1, status: { in: ["ACTIVE", "INVITED"] } },
      select: { id: true },
    });
    if (other) {
      throw new Error("BAD_REQUEST: This person already has another active stay — this older invitation can't be reopened");
    }
  }

  await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
  const now = new Date();

  if (!(await hasBedFreeFor(tx, roomId, tenantId))) {
    await tx.tenants.update({ where: { id: tenantId }, data: { status: "INVITED", updated_at: now } });
    return { reopened: true, bedHeld: false, restoredObligationIds: [] };
  }

  // Reopen the allocation the sweep ended, so the rent rows that point at it
  // still do. Only if there is none (legacy rows) is a new one made.
  const ended = await tx.roomAllocation.findFirst({
    where: { tenant_id: tenantId, room_id: roomId, is_active: false },
    orderBy: { end_date: "desc" },
  });
  let allocationId: string;
  if (ended) {
    await tx.roomAllocation.update({ where: { id: ended.id }, data: { is_active: true, end_date: null } });
    allocationId = ended.id;
  } else {
    ({ allocationId } = await ensureActiveAllocation(tx, {
      tenantId,
      roomId,
      hostelId,
      startDate: tenant.joined_on || now,
    }));
  }

  // ADR-172 Phase 3: going ACTIVE again counts against the owner's plan,
  // exactly as the original invite did.
  await assertOwnerCanActivateTenant(ownerId, { tx, tenantId, context: "invitation-resend-reopen" });

  // access_mode / acceptance_status were never changed by the sweep
  // (OWNER_MANAGED / PENDING) — only the terminal status needs undoing.
  await tx.tenants.update({ where: { id: tenantId }, data: { status: "ACTIVE", updated_at: now } });

  const restoredObligationIds = await restoreSweptObligations(tx, { tenantId, ownerId, hostelId, allocationId, actorId });
  return { reopened: true, bedHeld: true, restoredObligationIds };
}

/**
 * Bring back the future rent the expiry sweep voided, in place.
 *
 * In place, not regenerated: `rent_obligations` is unique per
 * (allocation, month, type) and (agreement, month, type), and the waived row
 * still holds that slot — a fresh row would either collide or, on a new
 * allocation, sit beside it as a duplicate. Only rows the sweep itself waived
 * (`AUTO_EXPIRE_WAIVER_REASON`) with no payment against them come back; a
 * month the owner waived by hand stays waived, and a month that has since got
 * another live row (the owner added it manually) is skipped.
 *
 * Each restored row's waiver debit is reversed on the ledger, then rows whose
 * month has started go through `activatePayableObligations` — the same path a
 * new invite's dues take (UPCOMING → PENDING, then available credit applied).
 * Future rows: RENT → UPCOMING (promoted by the daily rent cron at month
 * start), MAINTENANCE → PENDING (nothing promotes an UPCOMING maintenance row).
 *
 * Must run INSIDE a `prisma.$transaction`. Returns the restored ids.
 */
export async function restoreSweptObligations(
  tx: any,
  params: { tenantId: string; ownerId: string; hostelId: string; allocationId: string; actorId: string },
): Promise<string[]> {
  const { tenantId, ownerId, hostelId, allocationId, actorId } = params;

  const waived = await tx.rent_obligations.findMany({
    where: {
      tenant_id: tenantId,
      status: "WAIVED",
      waived_reason: AUTO_EXPIRE_WAIVER_REASON,
      obligation_type: { in: ["RENT", "MAINTENANCE"] },
      payments: { none: {} },
    },
    select: { id: true, rent_month: true, obligation_type: true },
    orderBy: { rent_month: "asc" },
  });
  if (waived.length === 0) return [];

  const now = new Date();
  const currentPeriodAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const restored: string[] = [];
  const payableNow: string[] = [];

  for (const ob of waived) {
    const live = await tx.rent_obligations.findFirst({
      where: {
        tenant_id: tenantId,
        id: { not: ob.id },
        rent_month: ob.rent_month,
        obligation_type: ob.obligation_type,
        status: { notIn: ["WAIVED", "CANCELLED"] },
      },
      select: { id: true },
    });
    if (live) continue;

    // The sweep overwrote the original status. Months that have started go
    // payable below. A future RENT row is UPCOMING — the daily rent cron
    // (`agreementRentScheduleService.syncDueStatuses`) makes it PENDING when
    // its month starts; that job promotes RENT only, so a future MAINTENANCE
    // row goes back as PENDING, as the rent generator raises it.
    const started = new Date(ob.rent_month) <= currentPeriodAnchor;
    await tx.rent_obligations.update({
      where: { id: ob.id },
      data: {
        status: started || ob.obligation_type === "RENT" ? "UPCOMING" : "PENDING",
        lifecycle_status: "ACTIVE",
        settlement_status: "UNPAID",
        waived_at: null,
        waived_reason: null,
        waived_by: null,
        waived_amount: null,
        allocation_id: allocationId,
        updated_at: now,
      },
    });
    await tenantFinancialLedgerService.reverseObligationWaiverInTx(tx, {
      obligationId: ob.id,
      tenantId,
      ownerId,
      createdBy: actorId,
      label: `${new Date(ob.rent_month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })} ${String(ob.obligation_type).toLowerCase()}`,
    });
    restored.push(ob.id);
    if (started) payableNow.push(ob.id);
  }

  if (payableNow.length > 0) {
    const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
    await financialLifecycleService.activatePayableObligations(tx, { tenantId, ownerId, hostelId, obligationIds: payableNow });
  }
  return restored;
}

/**
 * Is there a bed in `roomId` for this tenant, counting everyone else's
 * occupancy and holds but not the tenant's own?
 *
 * `roomCapacityService` counts every live invitation and active reservation
 * as a held bed (deduplicated per tenant). A tenancy being reopened or
 * activated can still have one of its own — a link refreshed before ADR-237
 * left the invitation live behind an EXPIRED tenancy — and that hold is the
 * bed it is asking for, not a rival for it. Caller holds the room lock.
 */
export async function hasBedFreeFor(tx: any, roomId: string, tenantId: string): Promise<boolean> {
  const capacity = await roomCapacityService.getRoomCapacitySnapshot(roomId, { tx });
  const [ownInvites, ownReservations] = await Promise.all([
    tx.tenant_invitations.count({
      where: { tenant_id: tenantId, room_id: roomId, status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED", "QUEUED"] } },
    }),
    tx.tenant_invitation_reservations.count({ where: { tenant_id: tenantId, room_id: roomId, status: "ACTIVE" } }),
  ]);
  const ownHold = ownInvites + ownReservations > 0 ? 1 : 0;
  const heldByOthers = Math.max(0, capacity.reserved - ownHold);
  return capacity.occupied + heldByOthers < capacity.capacity;
}
