/**
 * Whether a hostel requires its tenants to accept rules and sign a residency
 * agreement before activation — and which onboarding steps follow from that.
 *
 * **Scope of "off" (ADR-059).** This governs the *signing ceremony* only: the
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

/**
 * Every step, in order, when the agreement ceremony applies.
 *
 * PROFILE precedes AGREEMENT (ADR-070) — the tenant completes their identity
 * profile before reviewing and signing the residency agreement, matching the
 * `stayo onbaording/Stayo Onboarding.dc.html` design source. This governs the
 * server-enforced completion order via `nextActivationStep()` below and
 * `activation-workflow-service.ts`'s `assertTransition()`/`blockedSteps()`.
 */
export const ALL_ACTIVATION_STEPS: ActivationStep[] = ["ACCOUNT", "RULES", "PROFILE", "AGREEMENT", "ACTIVATE"];

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

/**
 * Whether this hostel insists on a parent/guardian co-signature.
 *
 * Mirrors `isAgreementRequired`, with the opposite default: an absent flag
 * means *not* required. Requiring one is a deliberate choice a hostel makes, so
 * a hostel predating the setting must not suddenly block its tenants.
 */
export function isGuardianSignatureRequired(policy: any): boolean {
  const rules = policy?.policy?.tenant_rules ?? policy?.tenant_rules ?? policy ?? {};
  return rules?.guardian_signature_required === true;
}

export type AgreementSignatureInput = {
  tenantSignatureUrl: string;
  tenantSignatureName: string;
  guardianSignatureUrl: string;
  guardianSignatureName: string;
  guardianRelation: string;
  guardianRequired: boolean;
};

/**
 * Who has to sign, as one pure rule.
 *
 * Returns the problem, or null when the signatures are acceptable.
 *
 * The rule used to be "at least one signature — tenant or parent/guardian",
 * which meant a tenancy could be activated with no signature from the person
 * who actually lives there. The tenant now always signs; a guardian is a
 * genuine co-signature, required only when the hostel asks for one.
 *
 * This validates a *submission*. Agreements already signed guardian-only stay
 * valid — nothing here re-checks stored rows, and retroactively invalidating
 * live tenancies is not on the table. See ADR-218.
 */
export function validateAgreementSignatures(input: AgreementSignatureInput): string | null {
  const tenantUrl = String(input.tenantSignatureUrl || "").trim();
  const tenantName = String(input.tenantSignatureName || "").trim();
  const guardianUrl = String(input.guardianSignatureUrl || "").trim();
  const guardianName = String(input.guardianSignatureName || "").trim();
  const guardianRelation = String(input.guardianRelation || "").trim();

  if (!tenantUrl) return "The tenant's signature is required";
  if (!tenantName) return "The tenant's typed full name is required";

  if (input.guardianRequired && !guardianUrl) {
    return "This hostel requires a parent or guardian co-signature";
  }

  // A volunteered guardian signature is validated the same way a required one
  // is: half-filling it is a mistake worth catching either way.
  if (guardianUrl) {
    if (!guardianName) return "The parent or guardian's typed full name is required";
    if (!guardianRelation) return "The parent or guardian's relationship is required";
  }

  return null;
}
