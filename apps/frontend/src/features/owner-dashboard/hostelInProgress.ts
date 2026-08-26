/**
 * Which hostel, if any, is a build the owner left unfinished.
 *
 * "No rooms yet" is the signal — derived from the data rather than a stored
 * setup flag, which would drift the moment rooms were added or deleted from
 * the Rooms tab.
 *
 * **It must also be a hostel that can still be built.** That qualifier is not
 * decoration: the dashboard fetches with `include_archived: true` so the
 * ARCHIVED tab has rows, and an archived hostel reports no active rooms — so
 * without a status filter it looks exactly like an unfinished build. Owners
 * were sent into the builder on an archived hostel and hit
 * `Cannot modify rooms/floors of an archived hostel` in production the moment
 * they saved a floor.
 *
 * INACTIVE is excluded for the same reason: `propertyService` refuses room and
 * floor writes on it too, with its own message. Only an ACTIVE hostel can be
 * built into.
 *
 * PURE MODULE — `apps/frontend` tests run without a DOM, and this is a derived
 * signal that has already cost real owners a dead end once.
 */

export interface InProgressCandidate {
  id: string;
  name: string;
  /** ACTIVE | INACTIVE | ARCHIVED. Anything else is treated as un-buildable. */
  status?: string | null;
  /** Beds across the hostel. Zero means no rooms exist yet. */
  totalCapacity?: number | null;
}

/** The only status whose rooms and floors the backend will accept writes for. */
const BUILDABLE_STATUS = 'ACTIVE';

export function findHostelInProgress<T extends InProgressCandidate>(
  properties: T[] | null | undefined,
): T | null {
  const list = Array.isArray(properties) ? properties : [];
  return (
    list.find(
      (property) =>
        String(property?.status ?? '').toUpperCase() === BUILDABLE_STATUS &&
        Number(property?.totalCapacity ?? 0) === 0,
    ) ?? null
  );
}
