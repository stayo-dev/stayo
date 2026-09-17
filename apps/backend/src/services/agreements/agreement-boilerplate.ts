/**
 * The agreement's legal furniture — the parts a tenancy contract needs in
 * order to function as an instrument, decided separately from how it is drawn.
 *
 * What the rendered agreement was missing, and why each matters:
 *
 * - **No page numbering.** A multi-page contract with no "Page 2 of 5" can
 *   have a page removed or substituted without either party being able to
 *   show it. This is the single most important omission here.
 * - **No reference on the page.** Nothing tied a sheet of paper to the
 *   agreement record it came from.
 * - **No execution block.** The document ended in signature images with no
 *   statement of *when and where* it was executed — the operative fact that
 *   turns signed pages into an agreement.
 * - **No preamble naming the parties and the date**, which is how a contract
 *   conventionally opens and how the parties are defined for the clauses that
 *   follow.
 * - **No governing law or jurisdiction**, so a dispute has no stated forum.
 * - **No note on stamping.** In India a leave-and-licence/rental instrument
 *   generally attracts stamp duty; a document silent on it invites the
 *   assumption that it was handled.
 * - **Duplicated clause titles** — the renderer prints `"N. {title}: {content}"`
 *   while stored content often *begins* with its own title, producing
 *   "4. Notice Period: Notice Period: Either party…".
 *
 * ── A deliberate difference from the receipt ──
 *
 * The receipt carries Stayo prominently. This document must not. A tenancy
 * agreement is between the hostel and the resident; **Stayo is not a party to
 * it**, and branding a contract like a marketing surface risks implying the
 * platform is a party, guarantor or licensor. Stayo appears here only as what
 * it actually is — the system that generated and can authenticate the record —
 * in a single footer line. There is no watermark.
 *
 * PURE MODULE — no pdf-lib, no I/O. Tested directly.
 *
 * NOT LEGAL ADVICE. The boilerplate below is conventional, neutral wording
 * intended to make the document structurally complete. It has not been
 * reviewed by a lawyer and should be before it is relied on.
 */

export type Clause = { number: number; title: string; body: string };

export type AgreementContentInput = {
  hostelName: string;
  hostelAddress: string;
  ownerName: string;
  tenantName: string;
  agreementReference: string;
  executionDateDisplay: string | null;
  /** Where the agreement was executed. Derived from the hostel address. */
  placeOfExecution: string | null;
  terms: Array<{ title: string; content: string }>;
  verificationUrl: string | null;
};

/** `₹8,500` — the real symbol. The old template rewrote it to "Rs. ". */
export function rupees(amount: number): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `₹${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)}`;
}

/**
 * Strip a clause title that the stored content repeats.
 *
 * Done at render time rather than by correcting the seed rows, because owners
 * can save their own terms and nothing stops them writing the title into the
 * body the same way the defaults do.
 */
export function clauseBody(title: string, content: string): string {
  const cleanTitle = String(title || "").trim();
  const cleanContent = String(content || "").trim();
  if (!cleanTitle) return cleanContent;

  const prefix = new RegExp(`^${cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–—]\\s*`, "i");
  return cleanContent.replace(prefix, "").trim() || cleanContent;
}

export function numberClauses(terms: Array<{ title: string; content: string }>): Clause[] {
  return terms.map((term, index) => ({
    number: index + 1,
    title: String(term.title || "").trim(),
    body: clauseBody(term.title, term.content),
  }));
}

/**
 * The city (and state) an address ends in — used as the place of execution
 * and the forum for the jurisdiction clause. Returns null rather than guessing
 * from an address it cannot parse, so the document never asserts a wrong forum.
 */
export function placeFromAddress(address: string | null | undefined): string | null {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];

  // Indian addresses conventionally end "<City>, <State> <PIN>". When the
  // final part carries the PIN it is the *state*, and a jurisdiction clause
  // naming a state instead of a city ("the courts at Telangana") is wrong —
  // so the city is the part before it.
  if (/\b\d{6}\b/.test(last) && parts.length >= 2) {
    const city = parts[parts.length - 2].trim();
    if (city) return city;
  }

  const stripped = last.replace(/\b\d{6}\b/, "").trim();
  return stripped || null;
}

/** The opening recital: who is agreeing, with whom, and when. */
export function preamble(input: AgreementContentInput): string {
  const dated = input.executionDateDisplay ? ` on ${input.executionDateDisplay}` : "";
  const place = input.placeOfExecution ? ` at ${input.placeOfExecution}` : "";
  return (
    `This Hostel Accommodation Agreement is made${dated}${place} between ` +
    `${input.ownerName || "the Owner"}, proprietor of ${input.hostelName || "the hostel"} ` +
    `(the "Owner"), and ${input.tenantName || "the Resident"} (the "Resident"). ` +
    `The Owner agrees to provide accommodation on the terms set out below, and the ` +
    `Resident agrees to occupy it on those terms.`
  );
}

/**
 * Clauses every contract of this kind should carry and this one did not.
 * Appended after the hostel's own terms so an owner's wording always leads.
 */
export function standardLegalClauses(input: AgreementContentInput): Array<{ title: string; content: string }> {
  const forum = input.placeOfExecution;
  return [
    {
      title: "Entire Agreement",
      content:
        "This Agreement, together with the hostel rules incorporated by reference, constitutes the entire " +
        "agreement between the parties on its subject matter and supersedes any prior understanding.",
    },
    {
      title: "Amendment",
      content:
        "No change to this Agreement is effective unless recorded in writing and accepted by both parties " +
        "through the same system that recorded this Agreement.",
    },
    {
      title: "Severability",
      content:
        "If any clause of this Agreement is held to be invalid or unenforceable, the remaining clauses " +
        "continue in full force.",
    },
    {
      title: "Governing Law and Jurisdiction",
      content: forum
        ? `This Agreement is governed by the laws of India, and the courts at ${forum} shall have jurisdiction ` +
          "over any dispute arising from it."
        : "This Agreement is governed by the laws of India, and the courts having jurisdiction over the " +
          "location of the hostel shall hear any dispute arising from it.",
    },
    {
      title: "Stamp Duty",
      content:
        "Stamp duty and registration, where applicable to this instrument under the law of the State in " +
        "which the hostel is situated, are the responsibility of the parties. This electronic record is not " +
        "itself a stamped instrument.",
    },
  ];
}

/** "IN WITNESS WHEREOF…" — the operative execution statement. */
export function executionStatement(input: AgreementContentInput): string {
  const dated = input.executionDateDisplay ? ` on ${input.executionDateDisplay}` : "";
  const place = input.placeOfExecution ? ` at ${input.placeOfExecution}` : "";
  return (
    `IN WITNESS WHEREOF the parties have signed this Agreement${place}${dated}, ` +
    `each having read and understood it.`
  );
}

/**
 * The per-page footer. Page numbering is the point: it is what stops a page
 * being removed or substituted without either party being able to show it.
 */
export function pageFooter(reference: string, page: number, total: number): string {
  const ref = String(reference || "").trim();
  return ref ? `${ref}  ·  Page ${page} of ${total}` : `Page ${page} of ${total}`;
}

/**
 * Platform attestation — deliberately one line, and deliberately not a claim
 * to be a party. It says what Stayo did (generated and can authenticate the
 * record), which is true and useful, and nothing more.
 */
export function platformAttestation(verificationUrl: string | null): string {
  return verificationUrl
    ? `Generated and digitally recorded via Stayo. Authenticity can be checked at ${verificationUrl}`
    : "Generated and digitally recorded via Stayo.";
}
