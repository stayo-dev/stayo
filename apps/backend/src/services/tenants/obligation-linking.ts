/**
 * Which of a tenancy's obligations should be bound to its room allocation.
 *
 * **The bug this exists for — a tenant billed twice for the same month.**
 *
 * `initializeOnboardingFinancials` writes an invited tenant's obligations,
 * including the backfilled months of a mid-year adoption, *before* the room
 * allocation exists — `createInvitation` creates a reservation, then the
 * obligations, and only then converts the reservation into an allocation. So
 * those rows are written with `allocation_id: null`, which is correct at the
 * moment they are written and never corrected afterwards.
 *
 * Every duplicate guard downstream is allocation-scoped. The monthly rent cron
 * looks for existing rows with `allocation_id: { in: allocationIds }`
 * (`rent-generation-service.ts`) and `obligationEngine.upsertObligation`
 * matches on `allocation_id + rent_month + obligation_type`. A row whose
 * `allocation_id` is NULL matches neither — `NULL IN (...)` is never true — so
 * both are blind to the backfilled months and raise the month a second time.
 * Observed in production: one tenant with two identical `RENT` rows for
 * 2026-08, one with an allocation and one without, ₹8,000 of rent they do not
 * owe sitting on the first screen they ever see.
 *
 * Binding the orphans to the allocation as soon as one exists makes every
 * existing check see them, and lets the `(allocation_id, rent_month,
 * obligation_type)` unique index protect these rows too — rather than changing
 * what "duplicate" means in four places.
 *
 * Pure: the collision rule is the part worth testing, and it can be decided
 * from plain data. See ADR-149.
 */

export interface LinkableObligation {
  id: string;
  /** `null` for a row written before the allocation existed. */
  allocation_id: string | null;
  obligation_type: string;
  /** First of the month, as an ISO string or Date — only equality matters. */
  rent_month: Date | string | null;
}

export interface ObligationLinkPlan {
  /** Safe to bind to the allocation. */
  link: string[];
  /**
   * Left unbound on purpose: an obligation already bound to this allocation
   * covers the same month and type, so binding would collide with the unique
   * index. That is the pre-existing duplicate — this planner refuses to turn a
   * data problem into a failed invitation, and reports it instead.
   */
  skipped: string[];
}

function monthKey(value: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function key(obligation: LinkableObligation): string {
  return `${monthKey(obligation.rent_month)}|${obligation.obligation_type}`;
}

/**
 * @param obligations every non-superseded obligation for the tenancy.
 * @param allocationId the allocation they should belong to.
 */
export function planObligationLinking(
  obligations: LinkableObligation[],
  allocationId: string,
): ObligationLinkPlan {
  const taken = new Set<string>();
  for (const obligation of obligations ?? []) {
    if (obligation.allocation_id === allocationId) taken.add(key(obligation));
  }

  const link: string[] = [];
  const skipped: string[] = [];

  for (const obligation of obligations ?? []) {
    if (obligation.allocation_id !== null && obligation.allocation_id !== undefined) continue;

    const k = key(obligation);
    if (taken.has(k)) {
      skipped.push(obligation.id);
      continue;
    }
    // Claim the slot as we go, so two orphans for the same month cannot both
    // be linked and collide with each other.
    taken.add(k);
    link.push(obligation.id);
  }

  return { link, skipped };
}
