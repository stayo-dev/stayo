import { describe, expect, it } from "vitest";
import {
  isGuardianSignatureRequired,
  validateAgreementSignatures,
} from "../src/services/tenants/agreement-requirement";

/**
 * Who has to sign.
 *
 * The rule used to be "tenant, guardian, or both", which meant a tenancy could
 * be activated with no signature from the person who actually lives there.
 */

const complete = {
  tenantSignatureUrl: "https://img/tenant.png",
  tenantSignatureName: "B. Vineeth",
  guardianSignatureUrl: "",
  guardianSignatureName: "",
  guardianRelation: "",
  guardianRequired: false,
};

const problem = (over: Partial<typeof complete> = {}) =>
  validateAgreementSignatures({ ...complete, ...over });

describe("isGuardianSignatureRequired", () => {
  it("defaults to not required when the flag is absent", () => {
    // Opposite default to isAgreementRequired: requiring a co-signature is a
    // deliberate choice, so a hostel predating the setting must not suddenly
    // block its tenants.
    expect(isGuardianSignatureRequired({})).toBe(false);
    expect(isGuardianSignatureRequired({ tenant_rules: {} })).toBe(false);
    expect(isGuardianSignatureRequired(undefined)).toBe(false);
    expect(isGuardianSignatureRequired(null)).toBe(false);
  });

  it("reads the flag from a normalized policy", () => {
    expect(isGuardianSignatureRequired({ tenant_rules: { guardian_signature_required: true } })).toBe(true);
    expect(isGuardianSignatureRequired({ tenant_rules: { guardian_signature_required: false } })).toBe(false);
  });

  it("reads the flag from a policy response wrapper", () => {
    expect(isGuardianSignatureRequired({ policy: { tenant_rules: { guardian_signature_required: true } } })).toBe(true);
  });

  it("treats an explicitly null flag as not required", () => {
    expect(isGuardianSignatureRequired({ tenant_rules: { guardian_signature_required: null } })).toBe(false);
  });
});

describe("validateAgreementSignatures", () => {
  it("accepts a complete tenant signature with no guardian", () => {
    expect(problem()).toBeNull();
  });

  it("rejects an agreement with no tenant signature at all", () => {
    expect(problem({ tenantSignatureUrl: "", tenantSignatureName: "" }))
      .toMatch(/tenant'?s signature is required/i);
  });

  it("rejects a guardian-only signature", () => {
    // The hole this closes.
    expect(problem({
      tenantSignatureUrl: "",
      tenantSignatureName: "",
      guardianSignatureUrl: "https://img/g.png",
      guardianSignatureName: "Ramesh",
      guardianRelation: "Father",
    })).toMatch(/tenant'?s signature is required/i);
  });

  it("rejects a signature image with no typed name", () => {
    expect(problem({ tenantSignatureName: "" })).toMatch(/typed/i);
  });

  it("rejects a typed name with no signature image", () => {
    expect(problem({ tenantSignatureUrl: "" })).toMatch(/signature/i);
  });

  it("requires a guardian signature when the hostel policy asks for one", () => {
    expect(problem({ guardianRequired: true })).toMatch(/parent or guardian/i);
  });

  it("requires the guardian's typed name when one is required", () => {
    expect(problem({ guardianRequired: true, guardianSignatureUrl: "https://img/g.png" }))
      .toMatch(/typed/i);
  });

  it("requires the guardian's relationship when one is required", () => {
    expect(problem({
      guardianRequired: true,
      guardianSignatureUrl: "https://img/g.png",
      guardianSignatureName: "Ramesh",
    })).toMatch(/relationship/i);
  });

  it("accepts a complete guardian co-signature when one is required", () => {
    expect(problem({
      guardianRequired: true,
      guardianSignatureUrl: "https://img/g.png",
      guardianSignatureName: "Ramesh",
      guardianRelation: "Father",
    })).toBeNull();
  });

  it("still validates a volunteered guardian signature when none is required", () => {
    // Offering one and half-filling it is a mistake worth catching either way.
    expect(problem({ guardianSignatureUrl: "https://img/g.png" })).toMatch(/typed/i);
  });

  it("ignores whitespace-only values", () => {
    expect(problem({ tenantSignatureName: "   " })).toMatch(/typed/i);
  });
});
