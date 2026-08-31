/**
 * Client-side checks for the owner's payout account.
 *
 * This is the one form in the product where a typo costs real money: a wrong
 * digit sends an owner's rent to a stranger's bank account, and nothing
 * downstream can catch it. So the account number is asked for twice, and the
 * comparison ignores spacing — "5010 0443" and "50100443" are the same
 * account, and refusing them as different would train owners to stop reading
 * the error.
 *
 * These rules deliberately mirror `validatePayoutAccount` on the backend,
 * which remains the authority. Duplicating them here is what lets the owner
 * see "these two numbers don't match" while typing rather than after a round
 * trip. The wording is kept identical so one mistake never produces two
 * different explanations.
 */

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface PayoutDraft {
  holderName: string;
  accountNo: string;
  accountNoConfirm: string;
  ifsc: string;
  bankName: string;
}

export interface PayoutCheck {
  ok: boolean;
  /** Which field to point at. */
  field?: 'holderName' | 'accountNo' | 'accountNoConfirm' | 'ifsc';
  reason?: string;
}

export function stripSpaces(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '');
}

export function normalizeIfsc(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

/** `••••4321`, or null when nothing is on file. */
export function maskAccount(accountNo: string | null | undefined): string | null {
  const digits = stripSpaces(accountNo);
  if (digits.length < 4) return null;
  return `••••${digits.slice(-4)}`;
}

export function validatePayoutDraft(draft: PayoutDraft): PayoutCheck {
  if (!String(draft?.holderName ?? '').trim()) {
    return { ok: false, field: 'holderName', reason: "Enter the account holder's name exactly as the bank has it." };
  }

  const account = stripSpaces(draft?.accountNo);
  if (!/^\d{6,20}$/.test(account)) {
    return { ok: false, field: 'accountNo', reason: 'Enter a valid account number — digits only.' };
  }

  if (account !== stripSpaces(draft?.accountNoConfirm)) {
    return {
      ok: false,
      field: 'accountNoConfirm',
      reason: 'The two account numbers do not match. Re-check them — a wrong digit sends your rent to someone else.',
    };
  }

  if (!IFSC.test(normalizeIfsc(draft?.ifsc))) {
    return { ok: false, field: 'ifsc', reason: 'Enter a valid IFSC, like HDFC0001204.' };
  }

  return { ok: true };
}

/** The body `PUT /api/owner/payout-account` expects. */
export function toPayoutPayload(draft: PayoutDraft) {
  return {
    holder_name: String(draft.holderName ?? '').trim(),
    account_no: stripSpaces(draft.accountNo),
    account_no_confirm: stripSpaces(draft.accountNoConfirm),
    ifsc: normalizeIfsc(draft.ifsc),
    bank_name: String(draft.bankName ?? '').trim(),
  };
}

/**
 * What the row in Configure says. An owner with no account on file is not
 * merely "not set" — their money is sitting with Stayo and not moving, and
 * that is the fact worth putting on the row.
 */
export function payoutRowSummary(
  payout: { account_masked?: string | null; bank_name?: string | null } | null | undefined,
): string {
  const masked = payout?.account_masked;
  if (!masked) return 'Not added — payouts are on hold';
  const bank = String(payout?.bank_name ?? '').trim();
  return bank ? `${bank} ${masked}` : masked;
}
