/**
 * What makes a floor name usable — mirrored from the backend's
 * `usableFloorName` so the sheet can say so while the owner types, rather
 * than after a round trip. The server still decides; this only saves a tap.
 */

/** Long enough for "Ground floor — annexe block", short enough for a phone header. */
export const FLOOR_NAME_MAX = 40;

export function tidyFloorName(raw: string): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Why this name can't be saved, or null when it can.
 *
 * `others` are the hostel's other floors — never this one, or renaming
 * "Floor 1" to "floor 1" would call itself a duplicate.
 */
export function floorNameProblem(raw: string, others: readonly string[]): string | null {
  const name = tidyFloorName(raw);
  if (!name) return 'Give the floor a name';
  if (name.length > FLOOR_NAME_MAX) return `Keep it under ${FLOOR_NAME_MAX} characters`;
  const lower = name.toLowerCase();
  if (others.some((other) => tidyFloorName(other).toLowerCase() === lower)) {
    return `There's already a floor called "${name}"`;
  }
  return null;
}

/** Whether Save does anything — an unchanged name is not an edit. */
export function isRename(current: string, raw: string): boolean {
  return tidyFloorName(raw) !== tidyFloorName(current);
}

export interface FloorSummary {
  rooms: number;
  beds: number;
  vacantBeds: number;
}

/** The line under the name in the edit sheet: "6 rooms · 24 beds · 5 free". */
export function describeFloor(summary: FloorSummary): string {
  if (summary.rooms === 0) return 'No rooms yet';
  const rooms = `${summary.rooms} ${summary.rooms === 1 ? 'room' : 'rooms'}`;
  const beds = `${summary.beds} ${summary.beds === 1 ? 'bed' : 'beds'}`;
  const free = summary.vacantBeds === 0 ? 'full' : `${summary.vacantBeds} free`;
  return `${rooms} · ${beds} · ${free}`;
}
