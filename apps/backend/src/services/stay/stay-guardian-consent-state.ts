/**
 * What a stored consent row means right now (ADR-234).
 *
 * The single place a row becomes a state. The tenant API renders this for the
 * consent sheet and the notify policy branches on it, so the two cannot drift
 * into disagreeing about whether someone has been asked.
 *
 * PURE MODULE. Takes the row as an argument and reads nothing itself.
 */

export type ConsentState =
  | "UNASKED"
  | "GRANTED"
  | "DECLINED"
  | "REVOKED"
  | "STOPPED"
  | "PHONE_CHANGED";

export interface ConsentRecord {
  granted: boolean;
  /** The guardian number consented to, as stored. Compared on normalised digits. */
  guardianPhone: string;
  revokedAt: Date | string | null;
  stoppedAt: Date | string | null;
}

/**
 * `currentGuardianPhone` is the number on the tenancy *now*.
 *
 * Consent was given to tell a person, not to tell a field: if the number has
 * changed, the stored decision is about somebody else and the tenant is asked
 * again. This is the same rule `guardian-activation` applies when deciding
 * whether a new number has been told anything at all.
 */
export function consentStateOf(
  row: ConsentRecord | null,
  currentGuardianPhone: string | null | undefined,
  normalise: (phone: string) => string,
): ConsentState {
  // No guardian to speak of: there is nothing to have consented to, and the
  // question becomes askable again the moment a number is added.
  if (!currentGuardianPhone || !String(currentGuardianPhone).trim()) return "UNASKED";
  if (!row) return "UNASKED";

  // A guardian who asked to be left alone outranks everything below,
  // including a tenant who later switches the feature back on.
  if (row.stoppedAt) return "STOPPED";

  if (normalise(row.guardianPhone) !== normalise(String(currentGuardianPhone))) {
    return "PHONE_CHANGED";
  }

  if (row.revokedAt) return "REVOKED";
  return row.granted ? "GRANTED" : "DECLINED";
}
