/**
 * Whether a hostel requires its tenants to accept rules and sign a residency
 * agreement before activation — and which onboarding steps follow from that.
 *
 * **Scope of "off" (ADR-057).** This governs the *signing ceremony* only: the
 * RULES and AGREEMENT onboarding steps, and the transition guards that enforce
 * them. It deliberately does **not** stop `Agreement` rows being created. That
 * record is the financial contract — `contract_rent` is what rent changes,
 * obligations, renewals and move-out settlement are keyed to (see
 * `payments/rent-change-service.ts`), so suppressing it would break billing
 * rather than skip paperwork.
 *
 * **Default is "required".** An absent flag means a hostel that predates the
 * setting, and an absent flag must never silently relax a legal step.
 *
 * Pure, so the progression rules are testable without a database.
 */

export type ActivationStep = "ACCOUNT" | "RULES" | "AGREEMENT" | "PROFILE" | "ACTIVATE";

/** Every step, in order, when the agreement ceremony applies. */
export const ALL_ACTIVATION_STEPS: ActivationStep[] = ["ACCOUNT", "RULES", "AGREEMENT", "PROFILE", "ACTIVATE"];

/** The steps skipped when a hostel does not require an agreement. */
const AGREEMENT_STEPS: ActivationStep[] = ["RULES", "AGREEMENT"];

/**
 * Reads the flag out of a hostel policy (nested `tenant_rules`) or a raw
 * `preferences_config`, tolerating either shape and any absent level.
 */
export function isAgreementRequired(source: unknown): boolean {
  const root = source && typeof source === "object" ? (source as Record<string, any>) : {};
  // `policy.tenant_rules` when handed a normalized policy; `tenant_rules` when
  // handed the stored preferences_config directly.
  const tenantRules = (root.tenant_rules ?? root.policy?.tenant_rules) as Record<string, any> | undefined;
  const flag = tenantRules?.agreement_required;
  return flag === undefined || flag === null ? true : Boolean(flag);
}

/** The ordered steps a tenant of this hostel must complete. */
export function requiredActivationSteps(agreementRequired: boolean): ActivationStep[] {
  if (agreementRequired) return [...ALL_ACTIVATION_STEPS];
  return ALL_ACTIVATION_STEPS.filter((step) => !AGREEMENT_STEPS.includes(step));
}

/** Whether a given step applies at all to this hostel. */
export function isStepApplicable(step: ActivationStep, agreementRequired: boolean): boolean {
  return requiredActivationSteps(agreementRequired).includes(step);
}

/**
 * The next step a tenant should be shown, skipping steps this hostel does not
 * require.
 *
 * `completion` reports what has genuinely happened; steps that do not apply are
 * not consulted, so an un-signed agreement cannot hold up a hostel that never
 * asked for one.
 */
export function nextActivationStep(
  completion: {
    accountSetupCompleted: boolean;
    rulesAccepted: boolean;
    agreementSigned: boolean;
    profileCompleted: boolean;
    activationCompleted: boolean;
  },
  agreementRequired: boolean,
): ActivationStep {
  const done: Record<ActivationStep, boolean> = {
    ACCOUNT: completion.accountSetupCompleted,
    RULES: completion.rulesAccepted,
    AGREEMENT: completion.agreementSigned,
    PROFILE: completion.profileCompleted,
    ACTIVATE: completion.activationCompleted,
  };

  const steps = requiredActivationSteps(agreementRequired);
  return steps.find((step) => !done[step]) ?? "ACTIVATE";
}

/**
 * The steps that count as done, for progress reporting. Steps that do not apply
 * are excluded entirely rather than counted as complete, so progress is a
 * fraction of what this hostel actually asks for.
 */
export function completedApplicableSteps(
  completion: {
    accountSetupCompleted: boolean;
    rulesAccepted: boolean;
    agreementSigned: boolean;
    profileCompleted: boolean;
    activationCompleted: boolean;
  },
  agreementRequired: boolean,
): ActivationStep[] {
  const done: Record<ActivationStep, boolean> = {
    ACCOUNT: completion.accountSetupCompleted,
    RULES: completion.rulesAccepted,
    AGREEMENT: completion.agreementSigned,
    PROFILE: completion.profileCompleted,
    ACTIVATE: completion.activationCompleted,
  };

  return requiredActivationSteps(agreementRequired).filter((step) => done[step]);
}
