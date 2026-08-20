/**
 * How much room there actually is, and where your things go.
 *
 * The listing's job here is to turn two tape measurements into something a
 * person can feel. Three rules hold this together, and each of them is a way
 * of refusing to overstate:
 *
 * 1. **Per-bed floor area is the number that matters**, not total area. A
 *    140 sq ft room is 35 sq ft a person at 4-sharing and 23 at 6-sharing —
 *    the same photograph, a very different life. Nobody publishes this, which
 *    is exactly why it is worth publishing.
 * 2. **Storage is counted objects, never adjectives.** "One lockable cupboard
 *    per person · a large suitcase fits under each bed" is checkable. "Ample
 *    storage" is not, and every listing claims it.
 * 3. **Nothing is said about rooms that were never measured.** A tier with no
 *    dimensions returns null and the listing shows nothing there, rather than
 *    a plausible default. And where rooms of one sharing size differ, the
 *    listing says they differ instead of averaging them into a fiction.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type UnderBedStorage = "NONE" | "CABIN_BAG" | "LARGE_SUITCASE";
export type StudyDesk = "NONE" | "SHARED" | "PER_BED";

export interface RoomSpaceInput {
  capacity: number;
  length_ft?: number | string | null;
  width_ft?: number | string | null;
  cupboard_per_bed?: boolean | null;
  under_bed_storage?: string | null;
  study_desk?: string | null;
  windows?: number | null;
}

export interface RoomSpace {
  /** "11 × 13 ft", or a range when rooms of this size differ. */
  dimensions: string | null;
  /** Whole square feet of floor per bed. */
  perBedArea: number | null;
  /** A plain-language size anchor, or null when we cannot honestly give one. */
  anchor: string | null;
  /** Counted objects, in the order someone unpacks them. */
  storage: string[];
  windows: number | null;
  /** True when rooms of this sharing size are not all the same. */
  varies: boolean;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** "11 × 13 ft" — the owner's own two measurements, not a derived area. */
export function dimensionLabel(length: number | null, width: number | null): string | null {
  if (length == null || width == null) return null;
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return `${format(length)} × ${format(width)} ft`;
}

export function perBedArea(
  length: number | null,
  width: number | null,
  capacity: number,
): number | null {
  if (length == null || width == null || !Number.isFinite(capacity) || capacity < 1) return null;
  return Math.round((length * width) / capacity);
}

/**
 * A size in words, from the per-bed area.
 *
 * Deliberately coarse — four bands, not a smooth scale — because the
 * underlying measurement is a tape against a wall and anything finer implies
 * a precision nobody has. The bands come from what a person can do in the
 * space, which is the only thing they care about.
 *
 * Nothing flattering: the smallest band says what it is. A listing that calls
 * 18 sq ft "cosy" is the reason people distrust listings.
 */
export function spaceAnchor(perBed: number | null): string | null {
  if (perBed == null) return null;
  if (perBed < 25) return "Tight — room for a bed and a cupboard, not much floor";
  if (perBed < 40) return "About average for a shared hostel room";
  if (perBed < 60) return "Roomy — space to move around your bed";
  return "Unusually spacious for a shared room";
}

const UNDER_BED_TEXT: Record<UnderBedStorage, string | null> = {
  NONE: null,
  CABIN_BAG: "A cabin bag fits under each bed",
  LARGE_SUITCASE: "A large suitcase fits under each bed",
};

const DESK_TEXT: Record<StudyDesk, string | null> = {
  NONE: null,
  SHARED: "A shared study table in the room",
  PER_BED: "A study desk for every bed",
};

/** Storage as things that fit, in the order someone unpacks them. */
export function storageLines(room: RoomSpaceInput): string[] {
  const lines: string[] = [];
  if (room.cupboard_per_bed === true) lines.push("One lockable cupboard per person");
  else if (room.cupboard_per_bed === false) lines.push("Shared cupboard space");

  const underBed = UNDER_BED_TEXT[(room.under_bed_storage ?? "") as UnderBedStorage];
  if (underBed) lines.push(underBed);

  const desk = DESK_TEXT[(room.study_desk ?? "") as StudyDesk];
  if (desk) lines.push(desk);

  return lines;
}

/**
 * One sharing size, summarised from the real rooms of that capacity.
 *
 * Where those rooms disagree — two 4-sharing rooms of different sizes — the
 * result says so and gives the range. Averaging them would invent a room
 * nobody can be shown.
 */
export function summariseSpace(rooms: RoomSpaceInput[]): RoomSpace | null {
  const measured = rooms
    .map((room) => ({
      room,
      length: toNumber(room.length_ft),
      width: toNumber(room.width_ft),
    }))
    .filter((entry) => entry.length != null && entry.width != null);

  if (measured.length === 0) return null;

  const areas = measured.map((entry) => perBedArea(entry.length, entry.width, entry.room.capacity)!);
  const smallest = Math.min(...areas);
  const largest = Math.max(...areas);
  const varies = smallest !== largest;

  const first = measured[0];
  const dimensions = varies
    ? `${smallest}–${largest} sq ft per bed`
    : dimensionLabel(first.length, first.width);

  // Only claim storage that is true of *every* room of this size; one room
  // with a cupboard does not make it a feature of the tier.
  const allLines = measured.map((entry) => storageLines(entry.room));
  const storage = allLines[0].filter((line) => allLines.every((lines) => lines.includes(line)));

  const windowCounts = measured.map((entry) => entry.room.windows).filter((count): count is number => count != null);
  const windows =
    windowCounts.length === measured.length && new Set(windowCounts).size === 1 ? windowCounts[0] : null;

  return {
    dimensions,
    // The smaller figure when they differ: the promise a listing makes should
    // be the one every room of that size can keep.
    perBedArea: smallest,
    anchor: spaceAnchor(smallest),
    storage,
    windows,
    varies,
  };
}
