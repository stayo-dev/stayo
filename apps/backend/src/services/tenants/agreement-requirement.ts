/**
 * Which onboarding steps a given tenancy actually has to complete.
 *
 * Two independent exemptions live here:
 *
 * 1. **The agreement ceremony** (`agreementRequired`) — a hostel that does not
 *    use tenant agreements skips RULES and AGREEMENT entirely.
 * 2. **The guardian step** (`guardianRequired`) — a working professional is not
 *    asked for a parent or guardian, so GUARDIAN is not part of their sequence.
 *
 * The file is still called `agreement-requirement` because `isAgreementRequired`
 * is its most-used export and renaming it would churn three importers, a test
 * file and the pure-test allowlist for no behavioural gain. Its actual subject
 * is the step list.
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

export type ActivationStep = "ACCOUNT" | "RULES" | "AGREEMENT" | "PROFILE" | "GUARDIAN" | "ACTIVATE";

/**
 * What this particular tenancy is asked for. Both flags are properties of the
 * tenancy-plus-hostel, not of the product, and both are recomputed on every
 * read — `guardianRequired` in particular depends on `profile_type`, which the
 * tenant chooses on the PROFILE step itself, so the sequence legitimately grows
 * a step partway through.
 */
export interface ActivationApplicability {
  agreementRequired: boolean;
  guardianRequired: boolean;
}

export interface ActivationCompletion {
  accountSetupCompleted: boolean;
  rulesAccepted: boolean;
  agreementSigned: boolean;
  profileCompleted: boolean;
  guardianCompleted: boolean;
  activationCompleted: boolean;
}

/**
 * Every step, in order, when everything applies.
 *
 * PROFILE precedes AGREEMENT (ADR-070) — the tenant completes their identity
 * before reviewing and signing the residency agreement, matching the
 * `stayo onbaording/Stayo Onboarding.dc.html` design source. This governs the
 * server-enforced completion order via `nextActivationStep()` below and
 * `activation-workflow-service.ts`'s `assertTransition()`/`blockedSteps()`.
 *
 * GUARDIAN sits between them (ADR-213): you say who you are, then who vouches
 * for you, then you sign. It has to precede AGREEMENT rather than follow it,
 * because a guardian may co-sign the agreement and `signAgreement()` writes
 * `guardian_relation` — which this step now collects up front instead.
 */
export const ALL_ACTIVATION_STEPS: ActivationStep[] = [
  "ACCOUNT",
  "RULES",
  "PROFILE",
  "GUARDIAN",
  "AGREEMENT",
  "ACTIVATE",
];

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

/** The ordered steps this tenancy must complete. */
export function requiredActivationSteps(applicability: ActivationApplicability): ActivationStep[] {
  return ALL_ACTIVATION_STEPS.filter((step) => {
    if (!applicability.agreementRequired && AGREEMENT_STEPS.includes(step)) return false;
    if (!applicability.guardianRequired && step === "GUARDIAN") return false;
    return true;
  });
}

/** Whether a given step applies at all to this tenancy. */
export function isStepApplicable(step: ActivationStep, applicability: ActivationApplicability): boolean {
  return requiredActivationSteps(applicability).includes(step);
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
  completion: ActivationCompletion,
  applicability: ActivationApplicability,
): ActivationStep {
  const done: Record<ActivationStep, boolean> = {
    ACCOUNT: completion.accountSetupCompleted,
    RULES: completion.rulesAccepted,
    AGREEMENT: completion.agreementSigned,
    PROFILE: completion.profileCompleted,
    GUARDIAN: completion.guardianCompleted,
    ACTIVATE: completion.activationCompleted,
  };

  const steps = requiredActivationSteps(applicability);
  return steps.find((step) => !done[step]) ?? "ACTIVATE";
}

/**
 * The steps that count as done, for progress reporting. Steps that do not apply
 * are excluded entirely rather than counted as complete, so progress is a
 * fraction of what this hostel actually asks for.
 */
export function completedApplicableSteps(
  completion: ActivationCompletion,
  applicability: ActivationApplicability,
): ActivationStep[] {
  const done: Record<ActivationStep, boolean> = {
    ACCOUNT: completion.accountSetupCompleted,
    RULES: completion.rulesAccepted,
    AGREEMENT: completion.agreementSigned,
    PROFILE: completion.profileCompleted,
    GUARDIAN: completion.guardianCompleted,
    ACTIVATE: completion.activationCompleted,
  };

  return requiredActivationSteps(applicability).filter((step) => done[step]);
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
 * live tenancies is not on the table. See ADR-216.
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
