/** Normalises an Indian mobile number to E.164 (`+91XXXXXXXXXX`), or null. */
export function normalizeImportPhone(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return `+${cleaned}`;
  }
  if (cleaned.length === 13 && cleaned.startsWith("091")) {
    return `+${cleaned.substring(1)}`;
  }
  return null;
}

export function isValidImportEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * A cell that would execute as a formula when the file is reopened in a
 * spreadsheet. Rejected rather than stored, so a value we later export cannot
 * become a formula-injection vector.
 *
 * The leading character alone is not enough to decide. `+91 80080 46952` is
 * how a great many people write an Indian mobile number, and flagging it told
 * owners their phone cell "contains a formula" — an error with no possible
 * fix, since the number was right. A formula needs something to act on: a
 * cell reference, a function name, an operator. Digits, spaces, brackets and
 * dashes after the sign are just a phone number.
 */
export function isSpreadsheetFormula(value: unknown): boolean {
  const text = String(value || "").trim();
  if (!text) return false;

  // `=` always starts a formula, whatever follows.
  if (text.startsWith("=")) return true;

  if (!/^[+\-@]/.test(text)) return false;

  // `+`, `-` or `@` followed by nothing but number punctuation is a number.
  return !/^[+\-@][\d\s()\-]*$/.test(text);
}

/**
 * The comparable identity of an Indian mobile number: its last 10 digits.
 *
 * Production stores `profiles.phone` as bare 10 digits and
 * `tenant_invitations.phone` as E.164 (`+91…`), so comparing the raw strings
 * — or a normalised E.164 against a profile's bare digits — never matches,
 * and an existing tenant re-imported would get a second tenancy.
 */
export function indianPhoneKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}
