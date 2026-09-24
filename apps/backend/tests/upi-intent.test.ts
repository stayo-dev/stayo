import { describe, it, expect } from "vitest";
import {
  isValidVpa,
  buildUpiUri,
  upiPayeeName,
  sanitiseUpiNote,
  formatUpiAmount,
} from "@/src/services/payments/upi/upi-intent";

/**
 * The UPI intent string.
 *
 * This is the whole payment instruction. There is no gateway to catch a mistake
 * and no callback to reveal one: a malformed VPA produces a QR that fails inside
 * the tenant's UPI app, where nobody on our side ever sees it, and the tenant
 * concludes Stayo is broken. So every rule lives in a pure module and is pinned
 * here.
 *
 * Pure: no I/O, no database, no client.
 */

describe("isValidVpa", () => {
  it("accepts the shapes real UPI handles take", () => {
    expect(isValidVpa("adithya@okhdfcbank")).toBe(true);
    expect(isValidVpa("9876543210@ybl")).toBe(true);
    expect(isValidVpa("sri.adithya-hostel@okaxis")).toBe(true);
    expect(isValidVpa("owner_1@upi")).toBe(true);
  });

  it("refuses anything that is not name@handle", () => {
    expect(isValidVpa("adithya")).toBe(false);
    expect(isValidVpa("@okhdfcbank")).toBe(false);
    expect(isValidVpa("adithya@")).toBe(false);
    expect(isValidVpa("a@b@c")).toBe(false);
    expect(isValidVpa("")).toBe(false);
    expect(isValidVpa(null as unknown as string)).toBe(false);
  });

  it("refuses a VPA with whitespace or a scheme in it", () => {
    // Pasted from a chat message or a browser bar — both are common.
    expect(isValidVpa("adithya @okhdfcbank")).toBe(false);
    expect(isValidVpa(" adithya@okhdfcbank")).toBe(false);
    expect(isValidVpa("upi://adithya@okhdfcbank")).toBe(false);
  });

  it("refuses an email address, which owners will absolutely paste", () => {
    // A handle with a dot is how an email differs from a UPI handle.
    expect(isValidVpa("owner@gmail.com")).toBe(false);
  });
});

describe("formatUpiAmount", () => {
  it("renders paise as rupees with exactly two decimals", () => {
    // Money is stored in integer paise; UPI wants a decimal rupee string.
    expect(formatUpiAmount(850000)).toBe("8500.00");
    expect(formatUpiAmount(1040050)).toBe("10400.50");
    expect(formatUpiAmount(1)).toBe("0.01");
  });

  it("never groups digits — a comma breaks the URI", () => {
    expect(formatUpiAmount(10000000)).toBe("100000.00");
    expect(formatUpiAmount(10000000)).not.toContain(",");
  });

  it("refuses a non-positive or non-finite amount", () => {
    expect(() => formatUpiAmount(0)).toThrow(/amount/i);
    expect(() => formatUpiAmount(-500)).toThrow(/amount/i);
    expect(() => formatUpiAmount(NaN)).toThrow(/amount/i);
  });
});

describe("sanitiseUpiNote", () => {
  it("keeps a plain rent note intact", () => {
    expect(sanitiseUpiNote("Rent Sept 2026")).toBe("Rent Sept 2026");
  });

  it("strips characters that break the intent string", () => {
    // & and = would be read as further URI parameters; # truncates.
    expect(sanitiseUpiNote("Rent & deposit = 9000 #101")).toBe("Rent deposit 9000 101");
  });

  it("collapses whitespace rather than emitting a ragged note", () => {
    expect(sanitiseUpiNote("Rent    Sept\n2026")).toBe("Rent Sept 2026");
  });

  it("truncates to what UPI apps actually display", () => {
    const note = sanitiseUpiNote("R".repeat(200));
    expect(note.length).toBeLessThanOrEqual(50);
  });
});

describe("upiPayeeName", () => {
  it("uses the hostel name, so the tenant recognises the payee", () => {
    // Not the owner's personal name: "Sri Adithya Boys Hostel" is what the
    // tenant knows. A stranger's legal name in a UPI app reads like a scam.
    expect(upiPayeeName("Sri Adithya Boys Hostel")).toBe("Sri Adithya Boys Hostel");
  });

  it("strips characters UPI apps mangle, and truncates", () => {
    expect(upiPayeeName("Sri Adithya & Co. Hostel")).toBe("Sri Adithya Co. Hostel");
    expect(upiPayeeName("H".repeat(100)).length).toBeLessThanOrEqual(50);
  });

  it("falls back to a neutral payee rather than an empty one", () => {
    expect(upiPayeeName("")).toBe("Hostel");
    expect(upiPayeeName(null as unknown as string)).toBe("Hostel");
  });
});

describe("buildUpiUri", () => {
  const ok = {
    vpa: "adithya@okhdfcbank",
    payeeName: "Sri Adithya Boys Hostel",
    amountPaise: 850000,
    note: "Rent Sept 2026",
  };

  it("builds the intent UPI apps expect", () => {
    const uri = buildUpiUri(ok);
    expect(uri.startsWith("upi://pay?")).toBe(true);
    expect(uri).toContain("pa=adithya%40okhdfcbank");
    expect(uri).toContain("cu=INR");
    expect(uri).toContain("am=8500.00");
  });

  it("URL-encodes the payee name instead of emitting raw spaces", () => {
    const uri = buildUpiUri(ok);
    expect(uri).not.toMatch(/pn=[^&]*\s/);
    expect(uri).toContain("Sri%20Adithya%20Boys%20Hostel");
  });

  it("refuses to build anything at all without a valid VPA", () => {
    // Returning a half-formed URI would produce a QR that silently fails in the
    // tenant's app. Failing here is the only failure anyone can see.
    expect(() => buildUpiUri({ ...ok, vpa: "not-a-vpa" })).toThrow(/UPI ID/i);
    expect(() => buildUpiUri({ ...ok, vpa: "" })).toThrow(/UPI ID/i);
  });

  it("omits the amount entirely when none is given", () => {
    // An open QR the tenant types into is legitimate — a fixed ₹0 is not.
    const uri = buildUpiUri({ ...ok, amountPaise: null });
    expect(uri).not.toContain("am=");
    expect(uri).toContain("pa=adithya%40okhdfcbank");
  });

  it("omits the note when there is nothing left after sanitising", () => {
    const uri = buildUpiUri({ ...ok, note: "&&&" });
    expect(uri).not.toContain("tn=");
  });

  it("produces a stable ordering, so a QR image is reproducible", () => {
    // Two calls with the same input must give the same string, or cached QR
    // images and the link beside them can disagree.
    expect(buildUpiUri(ok)).toBe(buildUpiUri({ ...ok }));
  });
});
