/**
 * The agreement's term, as the tenant is asked to understand it.
 *
 * The Agreement screen used to show rules and two signature pads and never once
 * say how long the stay was for — someone could sign an eleven-month commitment
 * without the number "11" appearing anywhere. The data was there the whole
 * time (`Agreement.agreement_duration_months`, `agreement_start_date`,
 * `agreement_end_date`); it simply was not sent to the client.
 *
 * Everything here is pure so it can be tested — this app has no jsdom, so the
 * commitment sheet stays a renderer over these functions.
 */

export type AgreementTerm = {
  duration_months: number | null;
  start_date: string | null;
  end_date: string | null;
  monthly_rent: number | null;
  security_deposit: number | null;
};

/**
 * Whether there is a term concrete enough to ask someone to commit to.
 * Mirrors the server's `hasStatableTerm` — with no duration there is no promise
 * to put into words, and the screen shows the agreement without the ceremony
 * rather than inventing a length.
 */
export function hasStatableTerm(term: AgreementTerm | null | undefined): boolean {
  return Boolean(term && typeof term.duration_months === 'number' && term.duration_months > 0);
}

/** `months` / `month`, because three live invitations are for a single month. */
export function monthWord(months: number | null | undefined): string {
  return months === 1 ? 'month' : 'months';
}

/**
 * `1 Sep 2026`, parsed as integer parts.
 *
 * Never `new Date(iso)` — that applies the viewer's timezone and shifts the day
 * west of UTC, which would show a tenant a commitment window one day off from
 * the one recorded against their name.
 */
export function formatDay(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** `11 months` — the headline length. */
export function formatDuration(term: AgreementTerm | null | undefined): string {
  if (!hasStatableTerm(term)) return '';
  const months = term!.duration_months as number;
  return `${months} ${monthWord(months)}`;
}

/** `1 Sep 2026 → 31 Jul 2027`, or '' when either end is unknown. */
export function formatWindow(term: AgreementTerm | null | undefined): string {
  const from = formatDay(term?.start_date);
  const to = formatDay(term?.end_date);
  return from && to ? `${from} → ${to}` : '';
}

/** Indian grouping, no decimals — rent and deposit are always whole rupees here. */
export function formatMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/**
 * The sentence the tenant agrees to, in the first person.
 *
 * Kept byte-identical to the server's `commitmentStatement`, because the server
 * stores what it generates and the tenant must be recorded as agreeing to the
 * words they actually read.
 */
export function commitmentStatement(hostelName: string, term: AgreementTerm | null | undefined): string {
  if (!hasStatableTerm(term)) return '';
  const months = term!.duration_months as number;
  const where = hostelName?.trim() || 'this hostel';
  const window =
    term!.start_date && term!.end_date
      ? ` — from ${formatDay(term!.start_date)} until ${formatDay(term!.end_date)}`
      : '';
  return `I am committing to stay at ${where} for ${months} ${monthWord(months)}${window}.`;
}

export type CommitmentChecks = { readAgreement: boolean; acceptTerm: boolean };

/**
 * Whether the tenant may give their word.
 *
 * Both boxes, neither pre-ticked. A pre-ticked commitment is not a commitment,
 * and the whole point of this screen is that the person made a deliberate act.
 */
export function canGiveWord(checks: CommitmentChecks): boolean {
  return Boolean(checks.readAgreement && checks.acceptTerm);
}

/**
 * What each side is promising, rendered as two columns.
 *
 * Both halves matter. A commitment screen that lists only the tenant's
 * obligations reads as extraction; showing what the hostel owes in return is
 * what makes it a mutual word rather than a demand — and it is all true,
 * derived from the contract terms already stored on the agreement.
 */
export function promises(input: {
  hostelName: string;
  roomNumber?: string | null;
  term: AgreementTerm;
}): { tenant: string[]; hostel: string[] } {
  const duration = formatDuration(input.term);
  const window = formatWindow(input.term);
  const rent = formatMoney(input.term.monthly_rent);
  const deposit = formatMoney(input.term.security_deposit);
  const where = input.hostelName?.trim() || 'the hostel';

  const tenant = [
    window ? `Stay for ${duration} — ${window}` : `Stay for ${duration}`,
    rent ? `Pay ${rent} rent on time each month` : 'Pay the rent on time each month',
    'Follow the house rules you have just read',
  ];

  const hostel = [
    input.roomNumber
      ? `Keep room ${input.roomNumber} yours for the full ${duration}`
      : `Keep your bed yours for the full ${duration}`,
    rent ? `Hold the rent at ${rent} for these ${duration}` : `Hold your rent steady for these ${duration}`,
    deposit ? `Return your ${deposit} deposit when you settle up` : 'Return your deposit when you settle up',
  ];

  return { tenant, hostel };
}
