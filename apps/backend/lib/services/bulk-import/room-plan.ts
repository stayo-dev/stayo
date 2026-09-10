import { buildIssue, type RowIssue } from "./issues";
import type { RoomImportRow } from "./rooms-sheet";

export type ExistingRoom = {
  id: string;
  room_no: string;
  capacity: number;
  base_rent: number | null;
  is_active: boolean;
  occupied_count: number;
  reserved_count: number;
  floor: number | null;
};

export type RoomPlan = {
  create: RoomImportRow[];
  update: Array<{
    id: string;
    room_no: string;
    from: { capacity: number; base_rent: number | null };
    to: { capacity?: number; base_rent?: number };
  }>;
  unchanged: string[];
  issues: RowIssue[];
};

/** Rooms-sheet data starts at row 2, under the header. */
const FIRST_DATA_ROW = 2;

/** What `RoomBulkCreateSchema` allows, mirrored so the owner hears it at preview. */
const MIN_BEDS = 1;
const MAX_BEDS = 20;

const key = (roomNo: string) => roomNo.trim().toUpperCase();

/**
 * What the Rooms sheet means for this hostel: which rooms to create, which to
 * update, and what the owner has to fix first.
 *
 * Pure by design — it takes the existing rooms as an argument, so it can be
 * tested without a database and so the owner can be shown the plan before
 * anything is written. Every row is examined; one bad room does not hide the
 * next.
 */
export function buildRoomPlan(sheet: RoomImportRow[], existing: ExistingRoom[]): RoomPlan {
  const plan: RoomPlan = { create: [], update: [], unchanged: [], issues: [] };
  const byKey = new Map(existing.map((r) => [key(r.room_no), r]));
  const seen = new Map<string, number>();

  sheet.forEach((row, index) => {
    const rowNumber = index + FIRST_DATA_ROW;
    const k = key(row.room_no);

    if (seen.has(k)) {
      plan.issues.push(
        buildIssue("ROOM_SHEET_DUPLICATE", rowNumber, {
          roomNo: row.room_no,
          otherRows: [seen.get(k)!],
        })
      );
      return;
    }
    seen.set(k, rowNumber);

    const numbers = [
      {
        field: "capacity" as const,
        label: "number of beds",
        value: row.capacity,
        hint: "Enter the number of beds as a whole number, like 3.",
      },
      {
        field: "base_rent" as const,
        label: "rent",
        value: row.base_rent,
        hint: "Enter the rent in rupees using digits, like 8500. A ₹ sign and commas are fine.",
      },
      {
        field: "floor" as const,
        label: "floor",
        value: row.floor,
        hint: "Enter the floor as a number — 0 for the ground floor.",
      },
    ];

    let unreadable = false;
    for (const n of numbers) {
      if (n.value !== undefined && Number.isNaN(n.value)) {
        unreadable = true;
        plan.issues.push(
          buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
            roomNo: row.room_no,
            value: row.raw_values?.[n.field] ?? "",
            fieldLabel: n.label,
            hint: n.hint,
          })
        );
      }
    }
    if (unreadable) return;

    // base_rent is an Int column. A fractional or negative rent would either
    // fail the whole floor with a raw database message, or persist as
    // nonsense.
    if (row.base_rent !== undefined && (!Number.isInteger(row.base_rent) || row.base_rent < 0)) {
      plan.issues.push(
        buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
          roomNo: row.room_no,
          value: row.raw_values?.base_rent ?? String(row.base_rent),
          fieldLabel: "rent",
          hint: "Enter the rent in whole rupees, like 8500 — no paise.",
        })
      );
      return;
    }

    if (
      row.capacity !== undefined &&
      (!Number.isInteger(row.capacity) || row.capacity < MIN_BEDS || row.capacity > MAX_BEDS)
    ) {
      plan.issues.push(
        buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
          roomNo: row.room_no,
          value: row.raw_values?.capacity ?? String(row.capacity),
          fieldLabel: "number of beds",
          hint: `Enter a whole number of beds between ${MIN_BEDS} and ${MAX_BEDS}.`,
        })
      );
      return;
    }

    const match = byKey.get(k);

    if (!match) {
      if (row.capacity === undefined) {
        plan.issues.push(
          buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
            roomNo: row.room_no,
            value: "",
            fieldLabel: "number of beds",
            hint: "This room is new, so we need to know how many beds it has.",
          })
        );
        return;
      }
      plan.create.push(row);
      return;
    }

    // Beds already spoken for: people living there plus rooms held by a
    // pending invitation. Shrinking below that would strand someone.
    const inUse = match.occupied_count + match.reserved_count;
    if (row.capacity !== undefined && row.capacity < inUse) {
      plan.issues.push(
        buildIssue("ROOM_CAPACITY_BELOW_OCCUPANCY", rowNumber, {
          roomNo: row.room_no,
          capacity: row.capacity,
          occupied: inUse,
        })
      );
      return;
    }

    const to: { capacity?: number; base_rent?: number } = {};
    if (row.capacity !== undefined && row.capacity !== match.capacity) to.capacity = row.capacity;
    if (row.base_rent !== undefined && row.base_rent !== (match.base_rent ?? undefined)) {
      to.base_rent = row.base_rent;
    }

    if (Object.keys(to).length === 0) {
      plan.unchanged.push(match.room_no);
    } else {
      plan.update.push({
        id: match.id,
        room_no: match.room_no,
        from: { capacity: match.capacity, base_rent: match.base_rent },
        to,
      });
    }
  });

  return plan;
}
