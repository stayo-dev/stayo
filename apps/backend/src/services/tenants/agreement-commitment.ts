/**
 * The tenant's explicit commitment to the agreement's term.
 *
 * Signing used to be a signature and nothing else: the Agreement screen never
 * stated how long the stay was for, so someone could sign an eleven-month
 * commitment without ever reading the number. The owner got a signature; the
 * tenant got no moment where the length of the promise was put to them.
 *
 * This adds that moment, and records it. Recording is the point — an
 * acknowledgement the system does not keep is theatre, and gives the owner
 * nothing to trust.
 *
 * ## What this deliberately is not
 *
 * It is **not** a lock-in and it does not claim to be one. `notice_period_days`
 * is nullable on `AgreementTemplate` and is NULL on every live template, so
 * `move-out-service` currently records no notice violation at all: a tenant can
 * raise a move-out at any time. Copy that implied a penalty would be false, and
 * a commitment screen caught bluffing damages the trust it exists to build. The
 * promise is real; the enforcement is a separate decision nobody has made yet.
 */

export type CommitmentTerm = {
  durationMonths: number | null;
  startDate: string | null;
  endDate: string | null;
};

/**
 * Whether there is a term concrete enough to ask someone to commit to.
 *
 * `agreement_duration_months` is nullable. With no duration there is no promise
 * to put into words, so the screen shows the agreement without the commitment
 * ceremony rather than inventing a length.
 */
export function hasStatableTerm(term: CommitmentTerm | null | undefined): boolean {
  return Boolean(term && typeof term.durationMonths === "number" && term.durationMonths > 0);
}

export type CommitmentAcknowledgement = {
  /** They confirmed having read the agreement and the hostel rules. */
  read_agreement: boolean;
  /** They confirmed the term itself — the actual commitment. */
  accept_term: boolean;
};

export type RecordedCommitment = {
  acknowledged_at: string;
  duration_months: number | null;
  start_date: string | null;
  end_date: string | null;
  /** The exact wording shown, so a later dispute reads what they read. */
  statement: string;
  ip: string | null;
  user_agent: string | null;
};

/**
 * The sentence the tenant is asked to agree to, in the first person.
 *
 * Written out here rather than only in the component so the recorded snapshot
 * and the screen cannot drift — what we store must be what they saw.
 */
export function commitmentStatement(input: {
  hostelName: string;
  term: CommitmentTerm;
}): string {
  const months = input.term.durationMonths;
  const unit = months === 1 ? "month" : "months";
  const where = input.hostelName?.trim() || "this hostel";
  const window =
    input.term.startDate && input.term.endDate
      ? ` — from ${formatDay(input.term.startDate)} until ${formatDay(input.term.endDate)}`
      : "";
  return `I am committing to stay at ${where} for ${months} ${unit}${window}.`;
}

/** `1 Sep 2026`, parsed as parts so no timezone can shift the day. */
function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Validate and shape the acknowledgement for storage.
 *
 * Both boxes are required and neither is pre-ticked on the client. Returning
 * null when there is no statable term is deliberate: it lets a hostel with no
 * duration on file keep signing agreements exactly as before.
 */
export function buildCommitmentRecord(input: {
  hostelName: string;
  term: CommitmentTerm | null | undefined;
  acknowledgement: Partial<CommitmentAcknowledgement> | null | undefined;
  now: Date;
  ip?: string | null;
  userAgent?: string | null;
}): RecordedCommitment | null {
  if (!hasStatableTerm(input.term)) return null;
  const term = input.term as CommitmentTerm;

  const ack = input.acknowledgement || {};
  if (!ack.read_agreement) {
    throw new Error("VALIDATION_ERROR: Confirm you have read the agreement and the hostel rules");
  }
  if (!ack.accept_term) {
    const months = term.durationMonths;
    throw new Error(
      `VALIDATION_ERROR: Confirm your commitment to stay for ${months} ${months === 1 ? "month" : "months"}`,
    );
  }

  return {
    acknowledged_at: input.now.toISOString(),
    duration_months: term.durationMonths,
    start_date: term.startDate,
    end_date: term.endDate,
    statement: commitmentStatement({ hostelName: input.hostelName, term }),
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  };
}
