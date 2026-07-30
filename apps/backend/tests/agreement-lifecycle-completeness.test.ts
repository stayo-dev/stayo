import { describe, expect, it } from "vitest";
import {
  AgreementLifecycleCompletenessError,
  assertAgreementLifecycleComplete,
  buildOnboardingAgreementLifecycle,
  buildRenewalAgreementLifecycle,
  getMissingAgreementLifecycleFields,
} from "@/src/services/tenants/agreement-lifecycle-completeness";

describe("agreement lifecycle completeness helpers", () => {
  it("builds onboarding lifecycle metadata from tenant source data", () => {
    const lifecycle = buildOnboardingAgreementLifecycle({
      joiningDate: "2026-06-14",
      monthlyRent: 8500,
      advanceDeposit: 10000,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
      paymentFrequency: "MONTHLY",
    });

    expect(lifecycle).toMatchObject({
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 10000,
      contract_maintenance: 0,
      contract_maintenance_type: "NONE",
      contract_payment_frequency: "MONTHLY",
    });
    expect(lifecycle.agreement_start_date.toISOString().slice(0, 10)).toBe("2026-06-14");
    expect(lifecycle.agreement_end_date.toISOString().slice(0, 10)).toBe("2027-06-14");
  });

  it("accepts zero maintenance as complete lifecycle metadata", () => {
    const agreement = {
      id: "agreement-1",
      agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
      agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 10000,
      contract_maintenance: 0,
      contract_maintenance_type: "NONE",
      contract_payment_frequency: "MONTHLY",
    };

    expect(getMissingAgreementLifecycleFields(agreement)).toEqual([]);
    expect(() => assertAgreementLifecycleComplete(agreement)).not.toThrow();
  });

  it("reports structured missing lifecycle fields", () => {
    expect(() =>
      assertAgreementLifecycleComplete({
        id: "agreement-1",
        agreement_start_date: "2026-06-14",
        contract_maintenance: 0,
      })
    ).toThrow(AgreementLifecycleCompletenessError);

    try {
      assertAgreementLifecycleComplete({
        id: "agreement-1",
        agreement_start_date: "2026-06-14",
        contract_maintenance: 0,
      });
    } catch (error: any) {
      expect(error).toMatchObject({
        code: "AGREEMENT_LIFECYCLE_INCOMPLETE",
        status: 409,
        details: {
          agreementId: "agreement-1",
          missingFields: expect.arrayContaining([
            "agreement_end_date",
            "agreement_duration_months",
            "contract_rent",
            "contract_security_deposit",
            "contract_maintenance_type",
            "contract_payment_frequency",
          ]),
        },
      });
    }
  });

  it("requires explicit dates and duration for renewal lifecycle metadata", () => {
    const lifecycle = buildRenewalAgreementLifecycle({
      agreement_start_date: "2027-06-14",
      agreement_end_date: "2028-06-14",
      agreement_duration_months: 12,
    });

    expect(lifecycle.agreement_start_date?.toISOString().slice(0, 10)).toBe("2027-06-14");
    expect(lifecycle.agreement_end_date?.toISOString().slice(0, 10)).toBe("2028-06-14");
    expect(lifecycle.agreement_duration_months).toBe(12);
  });
});
