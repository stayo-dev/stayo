export interface ApplyRentChangeParams {
  agreementId: string;
  hostelId: string;
  newRentAmount: number;
  effectiveFromMonth: Date;
  actorId: string;
  reason: string;
}

export interface RentChangeResult {
  agreementId: string;
  tenantId: string;
  oldRentAmount: number;
  newRentAmount: number;
  effectiveFromMonth: Date;
  obligationsUpdated: number;
  updatedObligationIds: string[];
}

function money(value: unknown): number {
  const n = Number(value || 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/**
 * Changes a tenant's rent effective from a chosen month onward. Reuses the
 * same safety rule already established in agreement-rent-schedule-service.ts
 * (a rent_obligations row may be repriced in place ONLY when it has zero
 * recorded payments) but adds month-scoping that service lacks — implemented
 * as a standalone function rather than a modification to that shared,
 * renewal-critical service.
 */
export async function applyRentChangeInTx(
  tx: any,
  params: ApplyRentChangeParams
): Promise<RentChangeResult> {
  const { agreementId, hostelId, newRentAmount, effectiveFromMonth, reason } = params;

  if (!(newRentAmount > 0)) {
    throw new Error("VALIDATION_ERROR: newRentAmount must be greater than 0");
  }
  if (!reason || !reason.trim()) {
    throw new Error("VALIDATION_ERROR: reason is required");
  }

  // Table name confirmed against prisma/schema.prisma: model `Agreement` has
  // no @@map, so the Postgres table is literally "Agreement".
  await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${agreementId}::uuid FOR UPDATE`;

  const agreement = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });

  if (agreement.hostel_id !== hostelId) {
    throw new Error(`Agreement ${agreementId} does not belong to hostel ${hostelId}`);
  }

  const oldRentAmount = money(agreement.contract_rent);

  const candidates = await tx.rent_obligations.findMany({
    where: {
      agreement_id: agreementId,
      obligation_type: "RENT",
      is_superseded: false,
      lifecycle_status: "ACTIVE",
      settlement_status: "UNPAID",
      rent_month: { gte: effectiveFromMonth },
    },
    include: { payments: { select: { id: true } } },
  });

  const safeToReprice = candidates.filter((ob: any) => !ob.payments || ob.payments.length === 0);

  await tx.agreement.update({
    where: { id: agreementId },
    data: { contract_rent: newRentAmount },
  });

  // Keep tenants.monthly_rent in sync with the agreement's contract_rent —
  // the same tenant-contract-sync pattern used by renewal activation (see
  // renewal-activation-engine.ts's tenantContractSync / tx.tenants.update
  // call). Without this, the frontend (which sources "current rent" from
  // tenant.monthly_rent, not agreement.contract_rent) shows the stale rent
  // after a successful change.
  await tx.tenants.update({
    where: { id: agreement.tenant_id },
    data: { monthly_rent: newRentAmount },
  });

  const updatedObligationIds: string[] = [];
  for (const obligation of safeToReprice) {
    await tx.rent_obligations.update({
      where: { id: obligation.id },
      data: {
        amount: newRentAmount,
        total_amount: newRentAmount,
        updated_at: new Date(),
      },
    });
    updatedObligationIds.push(obligation.id);
  }

  return {
    agreementId,
    tenantId: agreement.tenant_id,
    oldRentAmount,
    newRentAmount: money(newRentAmount),
    effectiveFromMonth,
    obligationsUpdated: updatedObligationIds.length,
    updatedObligationIds,
  };
}
