import { describe, it, expect } from "vitest";
import {
  partitionTenantOnlyFields,
  TENANT_ONLY_FIELDS,
  isInCorrectionWindow,
} from "@/src/services/change-management/field-classification";

/**
 * ADR-165: while `acceptance_status = PENDING` the owner cannot fill in
 * tenant-only details on the tenant's behalf. These are the pure rules behind
 * that block (`tenant-service.ts`'s `updateTenant` calls `partitionTenantOnlyFields`).
 */
describe("partitionTenantOnlyFields", () => {
  it("flags guardian, college and ID-verification fields", () => {
    const blocked = partitionTenantOnlyFields({
      guardian_name: "A",
      guardian_phone: "9990001111",
      college_name: "IIT",
      course: "CS",
      roll_number: "42",
      date_of_birth: "2000-01-01",
      gender: "M",
      document_verified: true,
    });
    expect(blocked.sort()).toEqual(
      [
        "guardian_name",
        "guardian_phone",
        "college_name",
        "course",
        "roll_number",
        "date_of_birth",
        "gender",
        "document_verified",
      ].sort(),
    );
  });

  it("leaves owner-operable fields alone", () => {
    expect(
      partitionTenantOnlyFields({
        display_name: "New Name",
        phone_1: "9990001111",
        monthly_rent: 9000,
        mobile_verified: true,
        temporary_address: "Hostel",
      }),
    ).toEqual([]);
  });

  it("guardian phone aliases phone_2 / emergency phone_3 are covered", () => {
    expect(TENANT_ONLY_FIELDS.has("phone_2")).toBe(true);
    expect(TENANT_ONLY_FIELDS.has("phone_3")).toBe(true);
  });
});

describe("isInCorrectionWindow", () => {
  it("never opens for a live-but-unaccepted (PENDING) tenancy", () => {
    expect(
      isInCorrectionWindow({ status: "ACTIVE", hasPayments: false, acceptanceStatus: "PENDING" }),
    ).toBe(false);
    // Even the (impossible) INVITED + PENDING shape stays closed.
    expect(
      isInCorrectionWindow({ status: "INVITED", hasPayments: false, acceptanceStatus: "PENDING" }),
    ).toBe(false);
  });

  it("still opens for a legacy INVITED tenancy with no payments", () => {
    expect(isInCorrectionWindow({ status: "INVITED", hasPayments: false })).toBe(true);
    expect(
      isInCorrectionWindow({ status: "INVITED", hasPayments: false, acceptanceStatus: "NOT_REQUIRED" }),
    ).toBe(true);
  });

  it("closes once there are payments, as before", () => {
    expect(isInCorrectionWindow({ status: "INVITED", hasPayments: true })).toBe(false);
  });
});
