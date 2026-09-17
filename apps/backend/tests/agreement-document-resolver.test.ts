import { describe, expect, it } from "vitest";
import { agreementDocumentInputFromRenderData } from "@/src/services/agreements/agreement-document-resolver";

/**
 * Stored agreement → composer input.
 *
 * Every decision that shapes what a tenant sees on the facts table lives in
 * this pure mapper, so it can be checked without a database, a PDF or a render.
 */

const renderData: any = {
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  roomNo: "101",
  monthlyRent: 8000,
  advanceDeposit: 16000,
  maintenanceCharge: 500,
  maintenanceType: "MONTHLY",
  joiningDate: "2026-09-01T00:00:00.000Z",
  paymentFrequency: "Monthly",
  hostelRules: { categories: [{ id: "a", title: "Fees", rules: ["Due on the 5th."] }] },
  termsAndConditions: [{ title: "Notice Period", content: "Thirty days." }],
  tenantSignatureName: "B. Vineeth",
  tenantSignatureUrl: null,
  guardianSignatureName: null,
  guardianSignatureUrl: null,
  guardianRelation: null,
  ownerSignatureUrl: "https://img/owner.png",
  ownerSignedAt: "2026-09-17T00:00:00.000Z",
  agreementStartDate: "2026-09-01T00:00:00.000Z",
};

const opts = { reference: "AGR-42", versionNumber: 3, status: "SIGNED", verificationUrl: null };
const map = (over: any = {}) => agreementDocumentInputFromRenderData({ ...renderData, ...over }, opts);
const fact = (label: string, over: any = {}) => map(over).facts.find((f) => f.label === label)!.value;

describe("agreementDocumentInputFromRenderData", () => {
  it("builds the facts table in contractual order", () => {
    expect(map().facts.map((f) => f.label)).toEqual([
      "Room", "Joining Date", "Monthly Rent", "Security Deposit", "Maintenance", "Payment Cycle",
    ]);
  });

  it("formats money with the rupee symbol and Indian grouping", () => {
    expect(fact("Monthly Rent")).toBe("₹8,000");
    expect(fact("Security Deposit")).toBe("₹16,000");
  });

  it("marks maintenance as monthly when there is one", () => {
    expect(fact("Maintenance")).toBe("₹500/mo");
  });

  it("renders a zero maintenance charge as a dash rather than a fake amount", () => {
    expect(fact("Maintenance", { maintenanceCharge: 0 })).toBe("—");
  });

  it("renders a missing room as a dash", () => {
    expect(fact("Room", { roomNo: null })).toBe("—");
  });

  it("falls back to Monthly when no payment cycle is recorded", () => {
    expect(fact("Payment Cycle", { paymentFrequency: null })).toBe("Monthly");
  });

  it("is final, because a stored agreement is being issued and not drafted", () => {
    // An unresolved token must blank rather than print as a token in something
    // somebody is about to sign.
    expect(map().isFinal).toBe(true);
  });

  it("carries the eight substitution variables", () => {
    expect(Object.keys(map().variables).sort()).toEqual([
      "HOSTEL_NAME", "JOINING_DATE", "MAINTENANCE_CHARGE_AMOUNT", "MONTHLY_RENT",
      "OWNER_NAME", "ROOM_NUMBER", "SECURITY_DEPOSIT_AMOUNT", "TENANT_NAME",
    ]);
  });

  it("passes the owner's terms and rules straight through to the composer", () => {
    expect(map().terms).toEqual([{ title: "Notice Period", content: "Thirty days." }]);
    expect(map().rules).toEqual(renderData.hostelRules);
  });

  it("carries the signature state without inventing any", () => {
    expect(map().signatures).toEqual({
      tenantName: "B. Vineeth",
      tenantSignatureUrl: null,
      tenantSignedAt: null,
      tenantIp: null,
      tenantUserAgent: null,
      guardianName: null,
      guardianSignatureUrl: null,
      guardianRelation: null,
      guardianSignedAt: null,
      guardianIp: null,
      guardianUserAgent: null,
      ownerSignatureUrl: "https://img/owner.png",
      ownerSignedAt: "2026-09-17T00:00:00.000Z",
    });
  });

  it("passes the audit trail through untouched, for the composer to format", () => {
    // Raw here, formatted there: the resolver must not decide how an IP or a
    // user agent reads, or the PDF and the reader could format them apart.
    const out = map({
      tenantSignatureUrl: "https://img/t.png",
      tenantSignedAt: "2026-09-17T13:04:05.000Z",
      tenantIp: "103.43.12.33, 172.68.22.45",
      tenantUserAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0.0.0 Mobile Safari/537.36",
    });
    expect(out.signatures.tenantIp).toBe("103.43.12.33, 172.68.22.45");
    expect(out.signatures.tenantSignedAt).toBe("2026-09-17T13:04:05.000Z");
  });

  it("takes reference, version and status from the caller, which holds the row", () => {
    const out = map();
    expect(out.reference).toBe("AGR-42");
    expect(out.versionNumber).toBe(3);
    expect(out.status).toBe("SIGNED");
  });

  it("dates execution from the owner's signature when there is one", () => {
    expect(map().executionDateDisplay).toBe("17-09-2026");
  });

  it("falls back to the agreement start date when the owner has not signed", () => {
    expect(map({ ownerSignedAt: null }).executionDateDisplay).toBe("01-09-2026");
  });
});
