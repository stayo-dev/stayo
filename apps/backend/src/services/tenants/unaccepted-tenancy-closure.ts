import { obligationEngine } from "@/src/services/payments/obligation-engine";

/**
 * Close a live-but-unaccepted tenancy (`status = ACTIVE`,
 * `acceptance_status = PENDING`) — owner cancellation or automatic expiry.
 *
 * The tenancy was operationally live: it held a real room allocation and rent
 * obligations generated on schedule. Closing it must:
 *   - free the room (end the active allocation),
 *   - void only the obligations that fall in a *future* billing period AND
 *     carry no payment — the tenant is walking away before those come due,
 *   - preserve everything else: the current/past periods, anything with a
 *     recorded payment, the security deposit, the ledger, and every payment
 *     and receipt — that history is what a settlement is built from,
 *   - cancel the still-open invitation(s),
 *   - set the terminal `tenants.status`.
 *
 * `acceptance_status` is deliberately left `PENDING`: the terminal
 * `tenants.status` (CANCELLED / EXPIRED) is the signal every reader keys on,
 * and "was invited, never accepted" stays true.
 *
 * Must be called INSIDE a `prisma.$transaction`.
 */
export async function closeUnacceptedTenancy(
  tx: any,
  params: {
    tenantId: string;
    actorId: string;
    terminalStatus: "CANCELLED" | "EXPIRED";
    invitationStatus: "CANCELLED" | "EXPIRED";
    reason: string;
  },
): Promise<{
  endedAllocations: number;
  waivedObligationIds: string[];
  cancelledInvitationIds: string[];
}> {
  const { tenantId, actorId, terminalStatus, invitationStatus, reason } = params;
  const now = new Date();

  // The first-of-month UTC anchor for the period containing "now". Obligations
  // with a strictly greater `rent_month` are in a future period. For non-monthly
  // frequencies this is a conservative approximation — it keeps the current
  // period's obligation and only voids ones anchored to a later month, which
  // errs toward preserving a claim rather than dropping one.
  const currentPeriodAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // 1. Free the room.
  const endedAllocations = await tx.roomAllocation.updateMany({
    where: { tenant_id: tenantId, is_active: true, end_date: null },
    data: { is_active: false, end_date: now },
  });

  // 2. Void future, unpaid RENT / MAINTENANCE obligations only.
  const futureObligations = await tx.rent_obligations.findMany({
    where: {
      tenant_id: tenantId,
      obligation_type: { in: ["RENT", "MAINTENANCE"] },
      status: { in: ["PENDING", "PARTIAL", "UPCOMING", "OVERDUE"] },
      rent_month: { gt: currentPeriodAnchor },
      payments: { none: {} },
    },
    select: { id: true },
  });
  const waivedObligationIds = futureObligations.map((o: any) => o.id);
  if (waivedObligationIds.length > 0) {
    await obligationEngine.bulkWaiveInTx(tx, {
      obligationIds: waivedObligationIds,
      reason,
      actorId,
    });
  }

  // 3. Close open invitations.
  const openInvitations = await tx.tenant_invitations.findMany({
    where: {
      tenant_id: tenantId,
      status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED"] },
    },
    select: { id: true },
  });
  const cancelledInvitationIds = openInvitations.map((i: any) => i.id);
  if (cancelledInvitationIds.length > 0) {
    await tx.tenant_invitations.updateMany({
      where: { id: { in: cancelledInvitationIds } },
      data: { status: invitationStatus, cancelled_at: now, updated_at: now },
    });
  }

  // 4. Release any lingering reservation (a new-model tenancy released its
  //    reservation at invite time, so this is normally a no-op).
  await tx.tenant_invitation_reservations.updateMany({
    where: { tenant_id: tenantId, status: "ACTIVE" },
    data: {
      status: "RELEASED",
      released_by: actorId,
      released_at: now,
      release_reason: invitationStatus,
      updated_at: now,
    },
  });

  // 5. Terminal tenancy status.
  await tx.tenants.update({
    where: { id: tenantId },
    data: { status: terminalStatus, updated_at: now },
  });

  return {
    endedAllocations: endedAllocations.count ?? 0,
    waivedObligationIds,
    cancelledInvitationIds,
  };
}
