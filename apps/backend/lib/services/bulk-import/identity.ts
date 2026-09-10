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
 * spreadsheet — `=`, `+`, `-` or `@` first. Rejected rather than stored, so a
 * value we later export cannot become a formula-injection vector.
 */
export function isSpreadsheetFormula(value: unknown): boolean {
  const text = String(value || "").trim();
  return /^[=+\-@]/.test(text);
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
