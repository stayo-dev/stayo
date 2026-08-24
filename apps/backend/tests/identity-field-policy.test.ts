import { describe, expect, it } from "vitest";
import {
  deriveGenderFromHostelType,
  resolveGenderRequirement,
} from "@/src/services/tenants/identity-field-policy";

describe("what a hostel's type establishes about gender", () => {
  it("a boys' hostel means Male", () => {
    expect(deriveGenderFromHostelType("BOYS")).toBe("Male");
  });

  it("a girls' hostel means Female", () => {
    expect(deriveGenderFromHostelType("GIRLS")).toBe("Female");
  });

  it("co-living establishes nothing", () => {
    expect(deriveGenderFromHostelType("CO_LIVING")).toBeNull();
  });

  it("working professionals establishes nothing", () => {
    expect(deriveGenderFromHostelType("WORKING_PROS")).toBeNull();
  });

  // `hostels.hostel_type` is a nullable String and was NULL on half the
  // production hostels when this was written. Guessing for those would write a
  // gender nobody supplied into a permanent tenant record.
  it("an unset type establishes nothing, rather than defaulting", () => {
    expect(deriveGenderFromHostelType(null)).toBeNull();
    expect(deriveGenderFromHostelType(undefined)).toBeNull();
    expect(deriveGenderFromHostelType("")).toBeNull();
  });

  it("is case- and whitespace-tolerant, since the column is free text", () => {
    expect(deriveGenderFromHostelType(" boys ")).toBe("Male");
    expect(deriveGenderFromHostelType("Girls")).toBe("Female");
  });

  it("does not guess from an unrecognised value", () => {
    expect(deriveGenderFromHostelType("MENS_PG")).toBeNull();
  });
});

describe("whether the Identity screen must ask", () => {
  it("does not ask when the hostel type already says so", () => {
    expect(resolveGenderRequirement({ tenantGender: null, hostelType: "BOYS" })).toEqual({
      required: false,
      value: "Male",
      reason: "implied_by_hostel",
    });
  });

  it("asks for a co-living hostel", () => {
    expect(resolveGenderRequirement({ tenantGender: null, hostelType: "CO_LIVING" })).toEqual({
      required: true,
      value: null,
      reason: "must_ask",
    });
  });

  it("asks when the hostel type was never set", () => {
    expect(resolveGenderRequirement({ tenantGender: "", hostelType: null }).required).toBe(true);
  });

  // A recorded answer came from a person; a derivation is an inference. The
  // person wins — otherwise someone recorded as "Other" in a boys' hostel gets
  // silently rewritten to "Male" on their next save.
  it("keeps a gender already on the record over anything the hostel implies", () => {
    expect(resolveGenderRequirement({ tenantGender: "Other", hostelType: "BOYS" })).toEqual({
      required: false,
      value: "Other",
      reason: "already_recorded",
    });
  });

  it("does not re-ask someone who already answered in a co-living hostel", () => {
    expect(resolveGenderRequirement({ tenantGender: "Female", hostelType: "CO_LIVING" })).toEqual({
      required: false,
      value: "Female",
      reason: "already_recorded",
    });
  });
});
