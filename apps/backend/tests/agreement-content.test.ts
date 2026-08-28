import { describe, expect, it } from "vitest";
import {
  clauseBody,
  executionStatement,
  numberClauses,
  pageFooter,
  placeFromAddress,
  platformAttestation,
  preamble,
  rupees,
  standardLegalClauses,
  type AgreementContentInput,
} from "@/lib/pdf/agreement-content";

const base = (over: Partial<AgreementContentInput> = {}): AgreementContentInput => ({
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  agreementReference: "AGR-2026-00042",
  executionDateDisplay: "31-05-2026",
  placeOfExecution: "Hyderabad",
  terms: [],
  verificationUrl: "https://yourstayo.com/verify/agreement/abc",
  ...over,
});

describe("amounts", () => {
  it("prints the rupee sign on a document stating what someone owes", () => {
    // The generator rewrote ₹ to "Rs. ", then stripped every character above
    // U+00FF — which deleted the sign outright once the rewrite was removed.
    expect(rupees(8500)).toBe("₹8,500");
    expect(rupees(1600000)).toBe("₹16,00,000");
  });
});

describe("clause titles are not printed twice", () => {
  it("strips a title the stored content repeats", () => {
    // Produced "4. Notice Period: Notice Period: Either party must provide…"
    expect(clauseBody("Notice Period", "Notice Period: Either party must provide 30 days notice.")).toBe(
      "Either party must provide 30 days notice."
    );
    expect(clauseBody("Hostel Rules Compliance", "Hostel Rules Compliance: The Lessee agrees.")).toBe(
      "The Lessee agrees."
    );
  });

  it("tolerates the separators people actually type", () => {
    expect(clauseBody("Rent", "Rent - payable monthly.")).toBe("payable monthly.");
    expect(clauseBody("Rent", "Rent — payable monthly.")).toBe("payable monthly.");
    expect(clauseBody("rent", "Rent: payable monthly.")).toBe("payable monthly.");
  });

  it("leaves content that does not repeat its title alone", () => {
    expect(clauseBody("Rent Payment", "Monthly rent is payable in advance.")).toBe(
      "Monthly rent is payable in advance."
    );
  });

  it("never empties a clause, even if content is only the title", () => {
    // Better a redundant line than a numbered clause with no body.
    expect(clauseBody("Rent", "Rent:")).toBe("Rent:");
  });

  it("numbers clauses from one, in order", () => {
    const clauses = numberClauses([
      { title: "A", content: "A: first" },
      { title: "B", content: "second" },
    ]);
    expect(clauses).toEqual([
      { number: 1, title: "A", body: "first" },
      { number: 2, title: "B", body: "second" },
    ]);
  });
});

describe("place of execution and forum", () => {
  it("takes the city, not the state, from an Indian address", () => {
    // "the courts at Telangana" names a state, not a forum.
    expect(placeFromAddress("Plot 14, Gachibowli, Hyderabad, Telangana 500032")).toBe("Hyderabad");
    expect(placeFromAddress("12-75/1, Balaji Nagar, Kodangal, Telangana 509338")).toBe("Kodangal");
  });

  it("falls back to the last part when there is no PIN", () => {
    expect(placeFromAddress("Some Road, Bengaluru")).toBe("Bengaluru");
  });

  it("returns null rather than guessing from an address it cannot parse", () => {
    // A wrong forum is worse than an unstated one.
    expect(placeFromAddress("Hyderabad")).toBeNull();
    expect(placeFromAddress("")).toBeNull();
    expect(placeFromAddress(null)).toBeNull();
  });

  it("states a generic forum when the place is unknown", () => {
    const clauses = standardLegalClauses(base({ placeOfExecution: null }));
    const governing = clauses.find((c) => c.title === "Governing Law and Jurisdiction");
    expect(governing?.content).toContain("laws of India");
    expect(governing?.content).toContain("location of the hostel");
    expect(governing?.content).not.toContain("courts at null");
  });
});

describe("the document reads as an instrument", () => {
  it("opens by naming the parties, the date and the place", () => {
    const text = preamble(base());
    expect(text).toContain("made on 31-05-2026");
    expect(text).toContain("at Hyderabad");
    expect(text).toContain("Mohammed Shoeb");
    expect(text).toContain("B. Vineeth");
    expect(text).toContain('the "Owner"');
    expect(text).toContain('the "Resident"');
  });

  it("carries the clauses a contract needs and this one lacked", () => {
    const titles = standardLegalClauses(base()).map((c) => c.title);
    expect(titles).toEqual([
      "Entire Agreement",
      "Amendment",
      "Severability",
      "Governing Law and Jurisdiction",
      "Stamp Duty",
    ]);
  });

  it("does not imply the electronic record is itself stamped", () => {
    const stamp = standardLegalClauses(base()).find((c) => c.title === "Stamp Duty");
    expect(stamp?.content).toContain("not itself a stamped instrument");
  });

  it("states when and where it was executed", () => {
    const text = executionStatement(base());
    expect(text).toContain("IN WITNESS WHEREOF");
    expect(text).toContain("at Hyderabad");
    expect(text).toContain("on 31-05-2026");
  });

  it("numbers every page against the agreement reference", () => {
    // A contract without this can lose or gain a page undetectably.
    expect(pageFooter("AGR-2026-00042", 2, 5)).toBe("AGR-2026-00042  ·  Page 2 of 5");
    expect(pageFooter("", 1, 3)).toBe("Page 1 of 3");
  });
});

describe("Stayo is not a party to this contract", () => {
  it("attests to the record without claiming to be a party", () => {
    const text = platformAttestation("https://yourstayo.com/verify/agreement/abc");
    expect(text).toContain("Generated and digitally recorded via Stayo");
    expect(text).toContain("yourstayo.com");

    // Nothing that could read as Stayo being owner, licensor or guarantor.
    for (const word of ["party", "guarantor", "licensor", "landlord", "between"]) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
  });

  it("still attests when there is no verification link", () => {
    expect(platformAttestation(null)).toBe("Generated and digitally recorded via Stayo.");
  });

  it("keeps Stayo out of the operative text entirely", () => {
    const operative = [
      preamble(base()),
      executionStatement(base()),
      ...standardLegalClauses(base()).map((c) => `${c.title} ${c.content}`),
    ].join(" ");
    expect(operative.toLowerCase()).not.toContain("stayo");
  });
});
