/**
 * The owner's payout account — where their settled rent is sent.
 *
 * Entered by the OWNER in their own Settings, never transcribed by an admin
 * from a phone call: a mistyped digit sends rent to a stranger and there is no
 * undo on an IMPS transfer, and only the owner can check it against their own
 * passbook.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type PayoutAccountInput = {
  holder_name?: string | null;
  account_no?: string | null;
  account_no_confirm?: string | null;
  ifsc?: string | null;
  bank_name?: string | null;
};

export type PayoutAccountValid = {
  ok: true;
  holder_name: string;
  account_no: string;
  ifsc: string;
  bank_name: string | null;
};

/** 4 letters, a literal 0, then 6 alphanumerics — the RBI format. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** People group digits as they read them off a passbook. */
const stripSpaces = (v: unknown) => String(v ?? "").replace(/\s+/g, "");

export function validatePayoutAccount(
  input: PayoutAccountInput,
): PayoutAccountValid | { ok: false; reason: string } {
  const holder = String(input.holder_name ?? "").trim();
  if (!holder) {
    return { ok: false, reason: "Enter the account holder's name exactly as the bank has it." };
  }

  const account = stripSpaces(input.account_no);
  const confirm = stripSpaces(input.account_no_confirm);

  if (!/^\d{6,20}$/.test(account)) {
    return { ok: false, reason: "Enter a valid account number — digits only." };
  }

  // Compared after stripping spaces so "5010 0443" and "50100443" match: the
  // check is for a wrong DIGIT, not for different formatting.
  if (account !== confirm) {
    return {
      ok: false,
      reason: "The two account numbers do not match. Re-check them — a wrong digit sends your rent to someone else.",
    };
  }

  const ifsc = String(input.ifsc ?? "").trim().toUpperCase();
  if (!IFSC.test(ifsc)) {
    return { ok: false, reason: "Enter a valid IFSC, like HDFC0001204." };
  }

  const bank = String(input.bank_name ?? "").trim();
  return { ok: true, holder_name: holder, account_no: account, ifsc, bank_name: bank || null };
}
