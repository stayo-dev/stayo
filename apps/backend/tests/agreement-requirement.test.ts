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
  guardianCompleted: false,
  activationCompleted: false,
  ...overrides,
});

/** Everything applies: an agreement hostel with a student. */
const FULL = { agreementRequired: true, guardianRequired: true };
/** A working professional at an agreement hostel — no guardian step. */
const NO_GUARDIAN = { agreementRequired: true, guardianRequired: false };
/** A student at a hostel that does not use agreements. */
const NO_AGREEMENT = { agreementRequired: false, guardianRequired: true };
/** Neither ceremony applies. */
const MINIMAL = { agreementRequired: false, guardianRequired: false };

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
  it("includes every step when both ceremonies apply", () => {
    // Identity precedes the agreement (ADR-070), and the guardian sits between
    // them (ADR-213): who you are, who vouches for you, then you sign.
    expect(requiredActivationSteps(FULL)).toEqual([
      "ACCOUNT",
      "RULES",
      "PROFILE",
      "GUARDIAN",
      "AGREEMENT",
      "ACTIVATE",
    ]);
  });

  it("drops rules and agreement for a hostel that does not use them", () => {
    expect(requiredActivationSteps(NO_AGREEMENT)).toEqual(["ACCOUNT", "PROFILE", "GUARDIAN", "ACTIVATE"]);
  });

  it("drops the guardian step for someone not asked for one", () => {
    expect(requiredActivationSteps(NO_GUARDIAN)).toEqual([
      "ACCOUNT",
      "RULES",
      "PROFILE",
      "AGREEMENT",
      "ACTIVATE",
    ]);
  });

  it("strips both exemptions independently", () => {
    expect(requiredActivationSteps(MINIMAL)).toEqual(["ACCOUNT", "PROFILE", "ACTIVATE"]);
  });

  it("always keeps ACCOUNT, PROFILE and ACTIVATE — nothing can exempt those", () => {
    for (const applicability of [FULL, NO_GUARDIAN, NO_AGREEMENT, MINIMAL]) {
      const steps = requiredActivationSteps(applicability);
      for (const step of ["ACCOUNT", "PROFILE", "ACTIVATE"] as const) {
        expect(steps).toContain(step);
      }
    }
  });
});

describe("isStepApplicable", () => {
  it("answers per tenancy, not per product", () => {
    expect(isStepApplicable("GUARDIAN", FULL)).toBe(true);
    expect(isStepApplicable("GUARDIAN", NO_GUARDIAN)).toBe(false);
    expect(isStepApplicable("AGREEMENT", NO_AGREEMENT)).toBe(false);
    expect(isStepApplicable("PROFILE", MINIMAL)).toBe(true);
  });
});

describe("nextActivationStep", () => {
  it("walks the full sequence in order", () => {
    let state = completion();
    expect(nextActivationStep(state, FULL)).toBe("ACCOUNT");

    state = completion({ accountSetupCompleted: true });
    expect(nextActivationStep(state, FULL)).toBe("RULES");

    state = completion({ accountSetupCompleted: true, rulesAccepted: true });
    expect(nextActivationStep(state, FULL)).toBe("PROFILE");

    state = completion({ accountSetupCompleted: true, rulesAccepted: true, profileCompleted: true });
    expect(nextActivationStep(state, FULL)).toBe("GUARDIAN");

    state = completion({
      accountSetupCompleted: true,
      rulesAccepted: true,
      profileCompleted: true,
      guardianCompleted: true,
    });
    expect(nextActivationStep(state, FULL)).toBe("AGREEMENT");

    state = completion({
      accountSetupCompleted: true,
      rulesAccepted: true,
      profileCompleted: true,
      guardianCompleted: true,
      agreementSigned: true,
    });
    expect(nextActivationStep(state, FULL)).toBe("ACTIVATE");
  });

  it("does not stall on a guardian step that does not apply", () => {
    // The regression this guards: an unfinished GUARDIAN on a working
    // professional would park them on a screen they can never complete.
    const state = completion({
      accountSetupCompleted: true,
      rulesAccepted: true,
      profileCompleted: true,
      guardianCompleted: false,
    });
    expect(nextActivationStep(state, NO_GUARDIAN)).toBe("AGREEMENT");
  });

  it("skips straight from account to profile when no ceremony applies", () => {
    expect(nextActivationStep(completion({ accountSetupCompleted: true }), MINIMAL)).toBe("PROFILE");
  });

  it("returns ACTIVATE once everything applicable is done", () => {
    const state = completion({ accountSetupCompleted: true, profileCompleted: true });
    expect(nextActivationStep(state, MINIMAL)).toBe("ACTIVATE");
  });
});

describe("completedApplicableSteps", () => {
  it("counts only steps this tenancy is actually asked for", () => {
    const state = completion({ accountSetupCompleted: true, profileCompleted: true, guardianCompleted: true });
    // guardianCompleted is true but the step does not apply, so it is not
    // counted — progress is a fraction of what was asked, not of what exists.
    expect(completedApplicableSteps(state, NO_GUARDIAN)).toEqual(["ACCOUNT", "PROFILE"]);
    expect(completedApplicableSteps(state, NO_AGREEMENT)).toEqual(["ACCOUNT", "PROFILE", "GUARDIAN"]);
  });

  it("reports nothing done at the start", () => {
    expect(completedApplicableSteps(completion(), FULL)).toEqual([]);
  });
});
