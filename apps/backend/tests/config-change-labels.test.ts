import { describe, expect, it } from "vitest";
import { describeConfigChange, moduleForDomain } from "@/lib/services/config/config-change-labels";

/**
 * The Recent Changes timeline shows one line per configuration change, in the
 * owner's language: "Late fee raised to ₹50 / day", not
 * "billing.late_fee.rules[0].amount: 20 → 50".
 *
 * Pure and I/O-free so the phrasing — including whether a number went up or
 * down — is verifiable without a database.
 */
describe("describeConfigChange", () => {
  it("names the direction a number moved", () => {
    expect(describeConfigChange({ domain: "billing", field: "grace_days", from: 1, to: 3 }))
      .toBe("Grace period raised to 3 days");
    expect(describeConfigChange({ domain: "billing", field: "grace_days", from: 5, to: 3 }))
      .toBe("Grace period lowered to 3 days");
  });

  it("describes a late fee amount with its rupee sign", () => {
    expect(describeConfigChange({ domain: "billing", field: "late_fee.amount", from: 20, to: 50 }))
      .toBe("Late fee raised to ₹50");
  });

  it("describes turning something on and off", () => {
    expect(describeConfigChange({ domain: "billing", field: "late_fee.enabled", from: false, to: true }))
      .toBe("Late fees turned on");
    expect(describeConfigChange({ domain: "receipts", field: "auto_email", from: true, to: false }))
      .toBe("Receipt auto-email turned off");
  });

  it("describes rent dates as calendar days", () => {
    expect(describeConfigChange({ domain: "billing", field: "auto_rent_day", from: 1, to: 2 }))
      .toBe("Rent generation moved to the 2nd");
    expect(describeConfigChange({ domain: "billing", field: "due_day", from: 5, to: 7 }))
      .toBe("Rent due date moved to the 7th");
  });

  it("describes deposit months in months", () => {
    expect(describeConfigChange({ domain: "billing", field: "deposit.deposit_months", from: 2, to: 1 }))
      .toBe("Security deposit lowered to 1 month");
  });

  it("falls back to a readable field name rather than a raw path", () => {
    const label = describeConfigChange({ domain: "tenant_rules", field: "tenant_segment", from: "A", to: "B" });

    expect(label).toBe("Tenant segment updated");
    expect(label).not.toContain("tenant_segment");
  });

  it("does not leak a value it has no phrasing for", () => {
    // A new policy field must never dump a JSON blob into the owner's activity
    // feed just because nobody taught this function about it yet.
    const label = describeConfigChange({
      domain: "operations",
      field: "some_future_thing",
      from: { a: 1 },
      to: { a: 2 },
    });

    expect(label).toBe("Some future thing updated");
  });
});

describe("moduleForDomain", () => {
  it.each([
    ["billing", "Finance"],
    ["receipts", "Finance"],
    ["branding", "Hostel"],
    ["tenant_rules", "Hostel"],
    ["automation", "Automation"],
    ["notifications", "Notifications"],
  ])("maps %s to the %s module", (domain, expected) => {
    expect(moduleForDomain(domain)).toBe(expected);
  });

  it("labels an unmapped domain as Configuration rather than guessing", () => {
    expect(moduleForDomain("something_new")).toBe("Configuration");
  });
});
