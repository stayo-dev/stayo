import { describe, expect, it } from "vitest";
import {
  consentStateOf,
  type ConsentRecord,
} from "@/src/services/stay/stay-guardian-consent-state";
import { decideStayGuardianNotice } from "@/lib/services/notifications/command-center/stay-guardian-policy";

/** Stands in for normalizeWhatsAppPhone: digits only, last 10. */
const normalise = (phone: string) => String(phone || "").replace(/\D/g, "").slice(-10);

const row = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
  granted: true,
  guardianPhone: "9876543210",
  revokedAt: null,
  stoppedAt: null,
  ...over,
});

describe("consentStateOf", () => {
  it("is UNASKED when there is no row at all", () => {
    expect(consentStateOf(null, "9876543210", normalise)).toBe("UNASKED");
  });

  it("is GRANTED for a live yes", () => {
    expect(consentStateOf(row(), "9876543210", normalise)).toBe("GRANTED");
  });

  it("is DECLINED for a stored no — the row is the memory of having asked", () => {
    expect(consentStateOf(row({ granted: false }), "9876543210", normalise)).toBe("DECLINED");
  });

  it("is REVOKED when the tenant switched it off", () => {
    expect(consentStateOf(row({ revokedAt: new Date() }), "9876543210", normalise)).toBe("REVOKED");
  });

  it("is STOPPED when the guardian said STOP, and STOP outranks a later re-grant", () => {
    const reGranted = row({ granted: true, revokedAt: null, stoppedAt: new Date() });
    expect(consentStateOf(reGranted, "9876543210", normalise)).toBe("STOPPED");
  });

  it("is STOPPED even when the tenant also revoked — the stricter fact wins", () => {
    const both = row({ revokedAt: new Date(), stoppedAt: new Date() });
    expect(consentStateOf(both, "9876543210", normalise)).toBe("STOPPED");
  });

  it("is PHONE_CHANGED when the guardian number no longer matches the snapshot", () => {
    // Consent was given to tell a person, not to tell a field.
    expect(consentStateOf(row(), "9000000001", normalise)).toBe("PHONE_CHANGED");
  });

  it("is NOT PHONE_CHANGED for the same number written differently", () => {
    // The schema stores phone numbers inconsistently; comparison is on digits.
    expect(consentStateOf(row(), "+91 98765 43210", normalise)).toBe("GRANTED");
    expect(consentStateOf(row(), "09876543210", normalise)).toBe("GRANTED");
  });

  it("is UNASKED when the guardian number was removed entirely", () => {
    expect(consentStateOf(row(), null, normalise)).toBe("UNASKED");
    expect(consentStateOf(row(), "  ", normalise)).toBe("UNASKED");
  });
});

describe("decideStayGuardianNotice", () => {
  const base = {
    eventType: "LEAVE_STARTED",
    consentState: "GRANTED" as const,
    guardianPhone: "9876543210",
    residentPhone: "9123456789",
    guardianVerified: true,
    normalise,
  };

  it("notifies on the two notifiable events", () => {
    expect(decideStayGuardianNotice(base)).toEqual({ notify: true, reason: "LEAVE" });
    expect(decideStayGuardianNotice({ ...base, eventType: "RETURNED" })).toEqual({
      notify: true,
      reason: "RETURN",
    });
  });

  it("is silent on every other event type", () => {
    for (const eventType of ["RETURN_DATE_CHANGED", "LEAVE_CANCELLED", "PRESENCE_CONFIRMED", "LATE"]) {
      expect(decideStayGuardianNotice({ ...base, eventType }), eventType).toEqual({
        notify: false,
        reason: "NOT_NOTIFIABLE",
      });
    }
  });

  it("refuses when there is no guardian number", () => {
    for (const guardianPhone of [null, undefined, "", "   "]) {
      expect(decideStayGuardianNotice({ ...base, guardianPhone }), String(guardianPhone)).toEqual({
        notify: false,
        reason: "NO_GUARDIAN_PHONE",
      });
    }
  });

  it("refuses when one handset is in both fields, however it is written", () => {
    // Two identical messages seconds apart reads as a malfunction, and is the
    // fastest way to get a WhatsApp number reported as spam.
    expect(
      decideStayGuardianNotice({ ...base, guardianPhone: "+91 91234 56789", residentPhone: "9123456789" }),
    ).toEqual({ notify: false, reason: "SAME_AS_RESIDENT" });
  });

  it("maps each consent state to its own reason", () => {
    const cases = [
      ["UNASKED", "NO_CONSENT"],
      ["DECLINED", "DECLINED"],
      ["REVOKED", "REVOKED"],
      ["STOPPED", "STOPPED_BY_GUARDIAN"],
      ["PHONE_CHANGED", "PHONE_CHANGED_SINCE_CONSENT"],
    ] as const;
    for (const [consentState, reason] of cases) {
      expect(decideStayGuardianNotice({ ...base, consentState }), consentState).toEqual({
        notify: false,
        reason,
      });
    }
  });

  it("refuses an unverified guardian, even with consent", () => {
    // A resident's movements are more sensitive than a rent balance, and
    // guardian_phone is typed by hand. ADR-212 deferral leaves real tenancies
    // with an unproved number.
    expect(decideStayGuardianNotice({ ...base, guardianVerified: false })).toEqual({
      notify: false,
      reason: "GUARDIAN_UNVERIFIED",
    });
  });

  it("checks the event type before anything else, so an unrelated event is never a consent question", () => {
    expect(
      decideStayGuardianNotice({
        ...base,
        eventType: "PRESENCE_CONFIRMED",
        consentState: "UNASKED",
        guardianPhone: null,
      }),
    ).toEqual({ notify: false, reason: "NOT_NOTIFIABLE" });
  });
});
