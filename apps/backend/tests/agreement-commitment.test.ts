import { describe, expect, it } from "vitest";
import {
  buildCommitmentRecord,
  commitmentStatement,
  hasStatableTerm,
} from "@/src/services/tenants/agreement-commitment";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const TERM = { durationMonths: 11, startDate: "2026-09-01", endDate: "2027-07-31" };

describe("whether there is a term worth asking about", () => {
  it("accepts a real duration", () => {
    expect(hasStatableTerm(TERM)).toBe(true);
  });

  // `agreement_duration_months` is nullable. With no duration there is no
  // promise to put into words, so the ceremony is skipped rather than a length
  // being invented.
  it("refuses a missing or nonsensical duration", () => {
    expect(hasStatableTerm(null)).toBe(false);
    expect(hasStatableTerm(undefined)).toBe(false);
    expect(hasStatableTerm({ ...TERM, durationMonths: null })).toBe(false);
    expect(hasStatableTerm({ ...TERM, durationMonths: 0 })).toBe(false);
  });
});

describe("the sentence the tenant agrees to", () => {
  it("names the hostel, the length and the window, in the first person", () => {
    expect(commitmentStatement({ hostelName: "Sri Adithya Boys Hostel", term: TERM })).toBe(
      "I am committing to stay at Sri Adithya Boys Hostel for 11 months — from 1 Sep 2026 until 31 Jul 2027.",
    );
  });

  // Three of the live invitations are for a single month; "1 months" would
  // undercut the seriousness of the moment.
  it("says month, not months, for a one-month term", () => {
    const statement = commitmentStatement({
      hostelName: "Sri Adithya",
      term: { durationMonths: 1, startDate: "2026-09-01", endDate: "2026-09-30" },
    });
    expect(statement).toContain("for 1 month —");
    expect(statement).not.toContain("1 months");
  });

  it("still reads properly when the dates are missing", () => {
    expect(
      commitmentStatement({ hostelName: "Sri Adithya", term: { durationMonths: 12, startDate: null, endDate: null } }),
    ).toBe("I am committing to stay at Sri Adithya for 12 months.");
  });

  it("falls back to a neutral phrase rather than an empty hostel name", () => {
    expect(commitmentStatement({ hostelName: "  ", term: TERM })).toContain("stay at this hostel for");
  });

  // Formatting via `new Date('2026-09-01')` and reading local parts shifts the
  // day west of UTC — the same trap the date-of-birth field avoids.
  it("formats the day without a timezone shift", () => {
    const statement = commitmentStatement({ hostelName: "H", term: TERM });
    expect(statement).toContain("1 Sep 2026");
    expect(statement).toContain("31 Jul 2027");
  });
});

describe("recording the commitment", () => {
  const ack = { read_agreement: true, accept_term: true };

  it("stores the term, the time, and the exact wording that was shown", () => {
    const record = buildCommitmentRecord({
      hostelName: "Sri Adithya Boys Hostel",
      term: TERM,
      acknowledgement: ack,
      now: NOW,
      ip: "1.2.3.4",
      userAgent: "Mobile Safari",
    });

    expect(record).toEqual({
      acknowledged_at: "2026-08-25T10:00:00.000Z",
      duration_months: 11,
      start_date: "2026-09-01",
      end_date: "2027-07-31",
      statement:
        "I am committing to stay at Sri Adithya Boys Hostel for 11 months — from 1 Sep 2026 until 31 Jul 2027.",
      ip: "1.2.3.4",
      user_agent: "Mobile Safari",
    });
  });

  // An acknowledgement the system does not keep gives the owner nothing to
  // trust, so the stored statement must be the one the tenant read.
  it("stores the same sentence the screen renders", () => {
    const record = buildCommitmentRecord({ hostelName: "H", term: TERM, acknowledgement: ack, now: NOW });
    expect(record?.statement).toBe(commitmentStatement({ hostelName: "H", term: TERM }));
  });

  it("refuses when the agreement was not confirmed as read", () => {
    expect(() =>
      buildCommitmentRecord({
        hostelName: "H",
        term: TERM,
        acknowledgement: { read_agreement: false, accept_term: true },
        now: NOW,
      }),
    ).toThrow(/read the agreement/i);
  });

  it("refuses when the term itself was not accepted, naming the length", () => {
    expect(() =>
      buildCommitmentRecord({
        hostelName: "H",
        term: TERM,
        acknowledgement: { read_agreement: true, accept_term: false },
        now: NOW,
      }),
    ).toThrow(/11 months/);
  });

  it("refuses a missing acknowledgement outright", () => {
    expect(() =>
      buildCommitmentRecord({ hostelName: "H", term: TERM, acknowledgement: null, now: NOW }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  // A hostel with no duration on file keeps signing exactly as it did before,
  // rather than being blocked by a ceremony that cannot be stated.
  it("records nothing, and demands nothing, when there is no term", () => {
    expect(
      buildCommitmentRecord({
        hostelName: "H",
        term: { durationMonths: null, startDate: null, endDate: null },
        acknowledgement: null,
        now: NOW,
      }),
    ).toBeNull();
  });
});
