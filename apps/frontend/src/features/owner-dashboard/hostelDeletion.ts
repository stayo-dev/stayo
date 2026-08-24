/**
 * Confirming the one irreversible action in the owner app.
 *
 * Archiving a hostel is reversible and always was. Deleting an archived one
 * for good is not, so it asks for the name to be typed — forgiving about case
 * and stray spaces, strict about the actual words. The point is making sure
 * the right hostel is being destroyed, not testing anyone's shift key.
 *
 * Pure: `apps/frontend` tests run without a DOM, and a confirmation gate that
 * can be satisfied by accident is worth being certain about.
 */
export function confirmHostelDeletion(typed: string, hostelName: string): boolean {
  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const target = normalise(hostelName);
  // A hostel with no name on file must never be deletable by typing nothing.
  if (target === '') return false;
  return normalise(typed) === target;
}
