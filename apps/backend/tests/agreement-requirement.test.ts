import { describe, expect, it } from "vitest";
import {
  completedApplicableSteps,
  isAgreementRequired,
  isStepApplicable,
  nextActivationStep,
  requiredActivationSteps,
} from "../src/services/tenants/agreement-requirement";

const completion = (overrides: Partial<Parameters<typeof nextActivationStep>[0]> = {}) => ({
  accountSetupCompleted: false,
  rulesAccepted: false,
  agreementSigned: false,
  profileCompleted: false,
  activationCompleted: false,
  ...overrides,
});

describe("isAgreementRequired", () => {
  it("defaults to required when the flag is absent", () => {
    // A hostel predating the setting must keep requiring a signed agreement —
    // an absent flag must never silently relax a legal step.
    expect(isAgreementRequired({})).toBe(true);
    expect(isAgreementRequired({ tenant_rules: {} })).toBe(true);
    expect(isAgreementRequired(undefined)).toBe(true);
    expect(isAgreementRequired(null)).toBe(true);
  });

  it("defaults to required when the flag is explicitly null", () => {
    expect(isAgreementRequired({ tenant_rules: { agreement_required: null } })).toBe(true);
  });

  it("reads the flag from a normalized policy", () => {
    expect(isAgreementRequired({ tenant_rules: { agreement_required: false } })).toBe(false);
    expect(isAgreementRequired({ tenant_rules: { agreement_required: true } })).toBe(true);
  });

  it("reads the flag from a policy response wrapper", () => {
    expect(isAgreementRequired({ policy: { tenant_rules: { agreement_required: false } } })).toBe(false);
  });
});

describe("requiredActivationSteps", () => {
  it("includes every step when an agreement is required", () => {
    expect(requiredActivationSteps(true)).toEqual(["ACCOUNT", "RULES", "AGREEMENT", "PROFILE", "ACTIVATE"]);
  });

  it("drops only the rules and agreement steps when it is not", () => {
    expect(requiredActivationSteps(false)).toEqual(["ACCOUNT", "PROFILE", "ACTIVATE"]);
  });

  it("never drops account setup, profile or activation", () => {
    // Those are operationally required regardless of paperwork: an activated
    // tenant with no verified phone or profile would break allocation.
    for (const step of ["ACCOUNT", "PROFILE", "ACTIVATE"] as const) {
      expect(isStepApplicable(step, false)).toBe(true);
    }
  });

  it("returns a fresh array, so callers cannot mutate the canonical order", () => {
    const steps = requiredActivationSteps(true);
    steps.push("PROFILE");

    expect(requiredActivationSteps(true)).toHaveLength(5);
  });
});

describe("nextActivationStep", () => {
  it("walks the full sequence when an agreement is required", () => {
    expect(nextActivationStep(completion(), true)).toBe("ACCOUNT");
    expect(nextActivationStep(completion({ accountSetupCompleted: true }), true)).toBe("RULES");
    expect(nextActivationStep(completion({ accountSetupCompleted: true, rulesAccepted: true }), true)).toBe(
      "AGREEMENT",
    );
    expect(
      nextActivationStep(
        completion({ accountSetupCompleted: true, rulesAccepted: true, agreementSigned: true }),
        true,
      ),
    ).toBe("PROFILE");
  });

  it("goes straight from account setup to profile when no agreement is required", () => {
    expect(nextActivationStep(completion({ accountSetupCompleted: true }), false)).toBe("PROFILE");
  });

  it("does not stall on an unsigned agreement a hostel never asked for", () => {
    // The bug this prevents: agreement_signed stays false forever when the
    // ceremony is skipped, so a sequence that consults it would never advance.
    const state = completion({ accountSetupCompleted: true, profileCompleted: true });

    expect(nextActivationStep(state, false)).toBe("ACTIVATE");
    expect(nextActivationStep(state, true)).toBe("RULES");
  });

  it("reports ACTIVATE once everything applicable is done", () => {
    expect(
      nextActivationStep(
        completion({ accountSetupCompleted: true, profileCompleted: true, activationCompleted: true }),
        false,
      ),
    ).toBe("ACTIVATE");
  });
});

describe("completedApplicableSteps", () => {
  it("counts only steps this hostel actually asks for", () => {
    const state = completion({ accountSetupCompleted: true, profileCompleted: true });

    expect(completedApplicableSteps(state, false)).toEqual(["ACCOUNT", "PROFILE"]);
  });

  it("excludes skipped steps rather than counting them as complete", () => {
    // Counting them done would report 5/5 for a tenant who signed nothing, and
    // make progress indistinguishable from a hostel that requires signing.
    const state = completion({ accountSetupCompleted: true, profileCompleted: true });

    expect(completedApplicableSteps(state, false)).not.toContain("AGREEMENT");
    expect(completedApplicableSteps(state, false)).not.toContain("RULES");
  });

  it("gives 2 of 3 for a skipped-agreement hostel, not 2 of 5", () => {
    const state = completion({ accountSetupCompleted: true, profileCompleted: true });

    expect(completedApplicableSteps(state, false).length / requiredActivationSteps(false).length).toBeCloseTo(
      2 / 3,
    );
  });

  it("still credits a signature that was collected before the setting changed", () => {
    // Turning the requirement off later must not erase a real signed record.
    const state = completion({ accountSetupCompleted: true, rulesAccepted: true, agreementSigned: true });

    expect(completedApplicableSteps(state, true)).toEqual(["ACCOUNT", "RULES", "AGREEMENT"]);
  });
});
