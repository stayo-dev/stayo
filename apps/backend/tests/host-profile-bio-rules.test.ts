import { describe, expect, it } from "vitest";
import {
  BIO_MAX_CHARS, containsContactDetails, fullName, normaliseBio, validateBio,
  validateDisplayName, validateHostingSince, validateLanguages,
} from "@/src/services/host-profile/bio-rules";

describe("fullName", () => {
  it("is the whole name, tidied, or null", () => {
    expect(fullName("  Shiva   Prakash ")).toBe("Shiva Prakash");
    expect(fullName("   ")).toBeNull();
    expect(fullName(null)).toBeNull();
  });
});

describe("containsContactDetails", () => {
  it.each([
    "Call me on 9876543210",
    "Call +91 98765 43210 anytime",
    "Phone: 98765-43210",
    "(040) 2345 6789 is the office",
    "whatsapp 91 9876 543 210",
  ])("rejects a phone number: %s", (text) => {
    expect(containsContactDetails(text)).toMatch(/phone number/);
  });

  it("rejects an email", () => {
    expect(containsContactDetails("Write to shiva.p@gmail.com")).toMatch(/email/);
  });

  it.each(["See https://sriadithya.in", "www.sriadithya.com", "wa.me/919876543210", "visit sriadithya.in"])(
    "rejects a link: %s",
    (text) => {
      expect(containsContactDetails(text)).not.toBeNull();
    },
  );

  it("rejects a social handle", () => {
    expect(containsContactDetails("Follow @sriadithya_hostel")).toMatch(/handle/);
  });

  it.each([
    "I started Sri Adithya in 2015 with 40 beds across 2 floors.",
    "Rooms 101, 102 and 103 face the park.",
    "Dinner is at 8.30 pm, breakfast at 7.",
    "B.Tech students and working professionals welcome.",
    "B.Com and M.Com students get a quiet study room.",
  ])("lets ordinary prose with numbers through: %s", (text) => {
    expect(containsContactDetails(text)).toBeNull();
  });
});

describe("validateBio", () => {
  it("treats empty and whitespace as no bio", () => {
    expect(validateBio("   \n ")).toEqual({ ok: true, value: null });
    expect(validateBio(null)).toEqual({ ok: true, value: null });
    expect(validateBio(undefined)).toEqual({ ok: true, value: null });
  });

  it("keeps paragraphs but collapses runs of blank lines", () => {
    expect(normaliseBio("  Hello\r\n\r\n\r\n\r\nWorld  ")).toBe("Hello\n\nWorld");
    expect(validateBio("Line one\nLine two")).toEqual({ ok: true, value: "Line one\nLine two" });
  });

  it("counts length after normalising and caps it", () => {
    expect(validateBio("a".repeat(BIO_MAX_CHARS)).ok).toBe(true);
    const over = validateBio("a".repeat(BIO_MAX_CHARS + 1));
    expect(over).toEqual({ ok: false, reason: `Keep it under ${BIO_MAX_CHARS} characters — this is ${BIO_MAX_CHARS + 1}.` });
  });

  it("refuses contact details with the reason the owner will see", () => {
    expect(validateBio("Call 9876543210")).toEqual({
      ok: false,
      reason: "Remove the phone number — residents reach you through Stayo.",
    });
  });

  it("refuses non-text", () => {
    expect(validateBio(42).ok).toBe(false);
  });
});

describe("validateLanguages", () => {
  it("accepts known languages, deduped, in the order given", () => {
    expect(validateLanguages(["Telugu", "Hindi", "Telugu"])).toEqual({ ok: true, value: ["Telugu", "Hindi"] });
  });
  it("defaults to none", () => {
    expect(validateLanguages(undefined)).toEqual({ ok: true, value: [] });
  });
  it("refuses unknown languages and more than six", () => {
    expect(validateLanguages(["Klingon"]).ok).toBe(false);
    expect(validateLanguages(["Telugu", "Hindi", "English", "Tamil", "Kannada", "Malayalam", "Marathi"]).ok).toBe(false);
    expect(validateLanguages("Telugu").ok).toBe(false);
  });
});

describe("validateHostingSince", () => {
  const now = new Date("2026-09-14T00:00:00Z");
  it("accepts a year from 1950 to this year, or nothing", () => {
    expect(validateHostingSince(2015, now)).toEqual({ ok: true, value: 2015 });
    expect(validateHostingSince("2015", now)).toEqual({ ok: true, value: 2015 });
    expect(validateHostingSince(null, now)).toEqual({ ok: true, value: null });
    expect(validateHostingSince("", now)).toEqual({ ok: true, value: null });
  });
  it("refuses the future, the implausible past, and fractions", () => {
    expect(validateHostingSince(2027, now).ok).toBe(false);
    expect(validateHostingSince(1949, now).ok).toBe(false);
    expect(validateHostingSince(2015.5, now).ok).toBe(false);
  });
});

describe("validateDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateDisplayName("  Shiva   Prakash ")).toEqual({ ok: true, value: "Shiva Prakash" });
  });
  it("refuses too short, too long, and non-text", () => {
    expect(validateDisplayName("S").ok).toBe(false);
    expect(validateDisplayName("x".repeat(81)).ok).toBe(false);
    expect(validateDisplayName(null).ok).toBe(false);
  });
});
