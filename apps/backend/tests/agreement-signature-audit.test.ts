import { describe, expect, it } from "vitest";
import { describeDevice, parseUserAgent, sanitizeIp } from "@/src/services/agreements/agreement-signature-audit";
import { buildAgreementDocument, type AgreementDocumentInput } from "@/src/services/agreements/agreement-document";

/**
 * The signature audit stamp.
 *
 * An electronic signature is worth what its trail is worth, so who signed, from
 * where, on what device and at what moment must read the same on the copy the
 * tenant reads and the copy that is filed.
 */

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SIGNED_AT = new Date("2026-09-17T13:04:05.000Z"); // 18:34:05 IST

const input = (over: Partial<AgreementDocumentInput> = {}): AgreementDocumentInput => ({
  reference: "AGR-42",
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  versionNumber: 1,
  status: "SIGNED",
  generatedAt: "2026-09-17T00:00:00.000Z",
  executionDateDisplay: "17-09-2026",
  verificationUrl: null,
  facts: [],
  terms: [],
  rules: null,
  variables: {},
  isFinal: true,
  signatures: {
    tenantName: "B. Vineeth",
    tenantSignatureUrl: "https://img/tenant.png",
    tenantSignedAt: SIGNED_AT,
    tenantIp: "103.43.12.33, 172.68.22.45",
    tenantUserAgent: ANDROID_UA,
    guardianName: null,
    guardianSignatureUrl: null,
    guardianRelation: null,
    guardianSignedAt: null,
    guardianIp: null,
    guardianUserAgent: null,
    ownerSignatureUrl: "https://img/owner.png",
    ownerSignedAt: SIGNED_AT,
  },
  ...over,
});

const panels = (over: Partial<AgreementDocumentInput> = {}) =>
  (buildAgreementDocument(input(over)).blocks.find((b) => b.kind === "signatures") as any).panels;
const tenant = (over: Partial<AgreementDocumentInput> = {}) =>
  panels(over).find((p: any) => p.role === "tenant");

describe("describeDevice", () => {
  it("names the device, OS and browser on one line", () => {
    expect(describeDevice(ANDROID_UA)).toBe("Mobile (Android 14, Chrome)");
  });

  it("says so plainly when the user agent tells us nothing", () => {
    expect(describeDevice(null)).toBe("Unknown Device (Unknown OS, Unknown Browser)");
  });
});

describe("parseUserAgent", () => {
  it("distinguishes a tablet from a phone", () => {
    const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
    expect(parseUserAgent(ipad).device).toBe("Tablet");
  });
});

describe("the stamp on the composed document", () => {
  it("records the signing moment in IST, not UTC", () => {
    // Every party to these agreements is in India; a UTC timestamp on a
    // tenancy contract invites the wrong reading.
    expect(tenant().signedAt).toBe("17-09-2026, 18:34:05 IST");
  });

  it("records the originating address, taking the client from an XFF chain", () => {
    expect(tenant().ip).toBe("103.43.12.33");
  });

  it("records the device, OS and browser", () => {
    expect(tenant().device).toBe("Mobile (Android 14, Chrome)");
  });

  it("keeps the raw user agent alongside the readable summary", () => {
    expect(tenant().userAgent).toBe(ANDROID_UA);
  });

  it("stamps nothing on a panel that has not been signed", () => {
    // A date and an IP on an unsigned panel would describe an event that
    // never happened.
    const guardian = panels().find((p: any) => p.role === "guardian");
    expect(guardian).toMatchObject({ signedAt: null, ip: null, device: null, userAgent: null });
  });

  it("stamps the owner's date but no device, because they sign by stored stamp", () => {
    const owner = panels().find((p: any) => p.role === "owner");
    expect(owner.signedAt).toBe("17-09-2026, 18:34:05 IST");
    expect(owner.device).toBeNull();
    expect(owner.ip).toBeNull();
  });

  it("stamps a guardian who did sign", () => {
    const withGuardian = input();
    withGuardian.signatures = {
      ...withGuardian.signatures,
      guardianName: "Ramesh",
      guardianSignatureUrl: "https://img/g.png",
      guardianRelation: "Father",
      guardianSignedAt: SIGNED_AT,
      guardianIp: "49.207.1.2",
      guardianUserAgent: ANDROID_UA,
    };
    const guardian = (buildAgreementDocument(withGuardian).blocks.find((b) => b.kind === "signatures") as any)
      .panels.find((p: any) => p.role === "guardian");
    expect(guardian).toMatchObject({
      signedAt: "17-09-2026, 18:34:05 IST",
      ip: "49.207.1.2",
      device: "Mobile (Android 14, Chrome)",
      relation: "Father",
    });
  });

  it("leaves the content hash unchanged, because the stamp is not agreed content", () => {
    // Two renders of the same agreement, signed from different devices, are
    // still the same agreement.
    const a = input();
    const b = input();
    b.signatures = { ...b.signatures, tenantIp: "1.2.3.4", tenantUserAgent: "something else" };
    expect(buildAgreementDocument(a).contentHash).toBe(buildAgreementDocument(b).contentHash);
  });
});

describe("sanitizeIp", () => {
  it("returns N/A rather than a misleading value when there is no address", () => {
    expect(sanitizeIp("unknown")).toBe("N/A");
  });
});
