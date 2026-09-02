/**
 * What to store as the hostel's registered name.
 *
 * The field is for the case where an owner's legal entity differs from the
 * name tenants know — "Adithya Hospitality Pvt Ltd" behind "Sri Adithya Boys
 * Hostel". Its own hint says to leave it blank otherwise.
 *
 * A value identical to the hostel name is therefore not an answer, it is a
 * duplicate, and it costs something real: receipts stop following the hostel
 * when it is renamed, because the copy taken at some earlier moment wins. It
 * also leaves the owner unable to tell a deliberate setting from a default.
 *
 * So an identical name stores as null, and the placeholder does the work of
 * showing what will be used.
 */
export function legalNameToStore(
  legalName: string | null | undefined,
  hostelName: string | null | undefined,
): string | null {
  const legal = String(legalName ?? '').trim();
  if (!legal) return null;

  const hostel = String(hostelName ?? '').trim();
  if (legal.toLowerCase() === hostel.toLowerCase()) return null;

  return legal;
}
