/**
 * The month block an owner reconciles against his own notebook.
 *
 * Owners have kept these numbers by hand for decades and will check ours
 * against theirs. If the lines on screen do not add up, the screen is worth
 * less than the notebook and he will keep using the notebook.
 *
 * So the totals here are DERIVED, never accepted. `collected` is defined as
 * its parts rather than computed separately and checked against them — a
 * reconciliation that cannot fail beats one that is validated after the fact,
 * because there is no code path where a rupee is shown twice or lost.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type MonthInputs = {
  /** e.g. "August" — the label the screen says "so far" about. */
  monthLabel: string;
  /**
   * Rent the tenant handed the owner — cash, or UPI to the owner's own ID.
   * He already has this money. It is shown to complete the picture and is
   * NEVER added to anything Stayo owes him.
   */
  direct: number;
  /** Captured by the gateway and already transferred out. */
  inYourBank: number;
  /**
   * Captured by the gateway, still in Stayo's account. Includes FAILED
   * transfers on purpose: a failed payout is money Stayo still holds, and
   * dropping it from this line would make the total shrink at the exact
   * moment the owner most needs to see it.
   */
  withStayo: number;
  /** Not yet paid by anyone. From the collection queue, not recomputed here. */
  stillToCollect: number;
  tenantsOwing: number;
};

export type MonthBlock = {
  monthLabel: string;
  direct: number;
  inYourBank: number;
  withStayo: number;
  /** Derived: inYourBank + withStayo. Every captured rupee is in one of them. */
  throughStayo: number;
  /** Derived: direct + throughStayo. */
  collected: number;
  stillToCollect: number;
  tenantsOwing: number;
};

const round2 = (n: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // Rupee amounts summed as floats otherwise leave 64300.000000000007 in a
  // block whose whole job is to add up on screen.
  return Math.round((v + Number.EPSILON) * 100) / 100;
};

/**
 * Negative money is a data fault, not a balance.
 *
 * A negative sum here would silently reduce the total and make the block
 * reconcile against nothing. Clamping shows a wrong-but-inspectable zero
 * instead of a plausible wrong total.
 */
const amount = (n: number): number => Math.max(0, round2(n));

export function assembleMonth(inputs: MonthInputs): MonthBlock {
  const direct = amount(inputs.direct);
  const inYourBank = amount(inputs.inYourBank);
  const withStayo = amount(inputs.withStayo);
  const throughStayo = round2(inYourBank + withStayo);

  return {
    monthLabel: inputs.monthLabel,
    direct,
    inYourBank,
    withStayo,
    throughStayo,
    collected: round2(direct + throughStayo),
    stillToCollect: amount(inputs.stillToCollect),
    tenantsOwing: Math.max(0, Math.floor(Number(inputs.tenantsOwing) || 0)),
  };
}
