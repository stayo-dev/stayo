import { rentChangeableAgreementWhere } from "../tenants/agreement-status";

export interface ApplyRentChangeParams {
  tenantId: string;
  hostelId: string;
  newRentAmount: number;
  effectiveFromMonth: Date;
  actorId: string;
  reason: string;
}

export interface RentChangeResult {
  tenantId: string;
  /** The agreement kept in step, when the tenant had one. Null is ordinary. */
  agreementId: string | null;
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
 * Changes a tenant's rent from a chosen month onward, and reprices the charges
 * that month and later which nobody has paid against yet.
 *
 * **The tenant is the anchor, not an agreement.** This used to take an
 * `agreementId`: it read the old rent from `contract_rent`, locked the
 * `Agreement` row, selected obligations by `agreement_id`, and the calling
 * route refused the whole operation when no suitable agreement existed. That
 * made money depend on an optional record. `tenant_rules.agreement_required`
 * (ADR-059) lets an owner switch the signing ceremony off entirely, and then no
 * signed agreement is ever created — so rent was unchangeable for every tenant
 * of every such hostel, and even where an agreement existed the monthly cron's
 * obligations (written with no `agreement_id`) were never repriced.
 *
 * `tenants.monthly_rent` is the source of truth. The rest of the codebase
 * already agrees: every reader of `contract_rent` falls back to it
 * (`agreement?.contract_rent ?? monthly_rent`).
 *
 * An agreement, when one exists, is a **snapshot kept in step** — updated
 * because those same readers prefer it when present, so leaving it stale would
 * have renewals and settlement quoting the old rent. It is never a
 * precondition, and its absence is an ordinary outcome rather than an error.
 *
 * The zero-payment rule is unchanged: an obligation may be repriced in place
 * only while nothing has been paid against it (the same safety rule
 * `agreement-rent-schedule-service` established), with month-scoping that
 * service lacks.
 */
export async function applyRentChangeInTx(
  tx: any,
  params: ApplyRentChangeParams
): Promise<RentChangeResult> {
  const { tenantId, hostelId, newRentAmount, effectiveFromMonth, reason } = params;

  if (!(newRentAmount > 0)) {
    throw new Error("VALIDATION_ERROR: newRentAmount must be greater than 0");
  }
  if (!reason || !reason.trim()) {
    throw new Error("VALIDATION_ERROR: reason is required");
  }

  // Serialises concurrent rent changes for one tenant. The lock moved here
  // from the Agreement row along with the anchor — a tenant with no agreement
  // would otherwise have had nothing to lock.
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

  const tenant = await tx.tenants.findUniqueOrThrow({
    where: { id: tenantId },
    select: { id: true, hostel_id: true, monthly_rent: true },
  });

  // The agreement's hostel used to prove the caller was operating on the right
  // property. With the agreement optional, the tenant's own hostel is the only
  // check left, so it has to be made explicitly.
  if (tenant.hostel_id !== hostelId) {
    throw new Error(`Tenant ${tenantId} does not belong to hostel ${hostelId}`);
  }

  const oldRentAmount = money(tenant.monthly_rent);

  const candidates = await tx.rent_obligations.findMany({
    where: {
      // By tenant and hostel — never by agreement. Both generation paths set
      // these two columns, whereas only `agreement-rent-schedule-service` sets
      // `agreement_id`; the monthly cron omits it entirely. Hostel scoping
      // keeps a transferred tenant's charges at their previous property out of
      // this change.
      tenant_id: tenantId,
      hostel_id: hostelId,
      obligation_type: "RENT",
      is_superseded: false,
      lifecycle_status: "ACTIVE",
      settlement_status: "UNPAID",
      rent_month: { gte: effectiveFromMonth },
    },
    include: { payments: { select: { id: true } } },
  });

  const safeToReprice = candidates.filter((ob: any) => !ob.payments || ob.payments.length === 0);

  await tx.tenants.update({
    where: { id: tenantId },
    data: { monthly_rent: newRentAmount },
  });

  // Best-effort snapshot sync. Excludes RENEWED and TERMINATED: a later
  // agreement governs, or none does, and rewriting a closed contract's rent
  // would falsify history.
  const agreement = await tx.agreement.findFirst({
    where: {
      tenant_id: tenantId,
      hostel_id: hostelId,
      status: rentChangeableAgreementWhere(),
    },
    orderBy: { generated_at: "desc" },
    select: { id: true },
  });

  if (agreement) {
    await tx.agreement.update({
      where: { id: agreement.id },
      data: { contract_rent: newRentAmount },
    });
  }

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
    tenantId,
    agreementId: agreement?.id ?? null,
    oldRentAmount,
    newRentAmount: money(newRentAmount),
    effectiveFromMonth,
    obligationsUpdated: updatedObligationIds.length,
    updatedObligationIds,
  };
}
