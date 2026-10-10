/**
 * A hostel's food menu continues from month to month until the owner changes it.
 *
 * `food_schedules` is one row per `(hostel_id, month)`, and since ADR-114 a
 * month's row was only ever created empty — so on the 1st every owner found a
 * blank Meal Plan and had to build the week again, and the owner Home card,
 * Kitchen Sheet and Food page showed nothing. This module makes a month with
 * no menu of its own *inherit the owner's most recent menu*.
 *
 * It is not the removed carry-forward cron, and it is not generation: no dish
 * is chosen, ranked or invented. The latest week the owner **authored** is
 * reused exactly. Rules:
 *
 * - **Authored** = `source` is not `CARRIED_FORWARD` and at least one cell has
 *   a dish. Editing any cell (the meals PATCH) already sets `source: MANUAL`,
 *   so an edited copy becomes the new authored menu and flows onward.
 * - A month that is authored is never touched.
 * - A month with no row, an untouched empty draft (created by navigating to
 *   it), or a `CARRIED_FORWARD` copy gets the latest authored menu *before* it.
 *   A copy is re-synced whenever that source changed, so editing September
 *   after October was copied still reaches October.
 * - A copy is PUBLISHED only for the current or an earlier month, and only if
 *   its source was published — tenants never see a future month early, and
 *   the owner never has to re-publish monthly. A PUBLISHED row is never
 *   un-published.
 *
 * Pure decision functions first (node-testable), then the one DB entry point.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { deriveLegacyFields } from "./meal-items";

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;
const EMPTY_CELL_NAME = "Not set";

/** How many earlier months to look back for the latest authored menu. */
const LOOKBACK_MONTHS = 24;

type ScheduleStatus = "DRAFT" | "PUBLISHED";
type ScheduleSource = "GENERATED" | "CARRIED_FORWARD" | "MANUAL";

export interface CellSnapshot {
  day_of_week: string;
  meal_type: string;
  items: { menu_item_id: string | null; item_name: string }[];
}

export interface ScheduleSnapshot {
  id: string;
  month: Date;
  status: ScheduleStatus;
  source: ScheduleSource;
  cells: CellSnapshot[];
}

export function filledCellCount(schedule: Pick<ScheduleSnapshot, "cells">): number {
  return schedule.cells.filter((c) => c.items.length > 0).length;
}

export function isAuthored(schedule: ScheduleSnapshot): boolean {
  return schedule.source !== "CARRIED_FORWARD" && filledCellCount(schedule) > 0;
}

/** Order-sensitive fingerprint of a week's dishes, for "is this copy current?". */
export function weekSignature(schedule: Pick<ScheduleSnapshot, "cells">): string {
  const byKey = new Map(schedule.cells.map((c) => [`${c.day_of_week}:${c.meal_type}`, c]));
  return DAY_ORDER.flatMap((day) =>
    MEAL_TYPES.map((meal) => {
      const cell = byKey.get(`${day}:${meal}`);
      return `${day}:${meal}=${(cell?.items ?? []).map((i) => i.menu_item_id ?? `#${i.item_name}`).join(",")}`;
    }),
  ).join("|");
}

export function firstOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The latest authored menu strictly before `target`, or null. */
export function pickCarrySource(candidates: ScheduleSnapshot[], target: Date): ScheduleSnapshot | null {
  return (
    candidates
      .filter((s) => s.month.getTime() < target.getTime() && isAuthored(s))
      .sort((a, b) => b.month.getTime() - a.month.getTime())[0] ?? null
  );
}

export type MonthDecision =
  | { action: "keep" }
  | { action: "create-empty" }
  | { action: "copy"; into: "new" | "existing"; status: ScheduleStatus };

/**
 * What to do for `target`, given its row (if any) and the latest authored
 * earlier menu (if any).
 *
 * `allowCreateEmpty`: only the owner's Meal Plan (`POST /api/food/schedules`)
 * creates an empty scaffold when there is nothing to carry. Read paths never
 * create an empty row — they only carry an existing menu forward.
 */
export function decideMonth(input: {
  existing: ScheduleSnapshot | null;
  source: ScheduleSnapshot | null;
  target: Date;
  currentMonth: Date;
  allowCreateEmpty: boolean;
}): MonthDecision {
  const { existing, source, target, currentMonth } = input;

  if (existing && isAuthored(existing)) return { action: "keep" };

  if (!source) {
    return !existing && input.allowCreateEmpty ? { action: "create-empty" } : { action: "keep" };
  }

  const live = source.status === "PUBLISHED" && target.getTime() <= currentMonth.getTime();
  const status: ScheduleStatus = live || existing?.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  if (!existing) return { action: "copy", into: "new", status };

  const contentCurrent = existing.source === "CARRIED_FORWARD" && weekSignature(existing) === weekSignature(source);
  if (contentCurrent && existing.status === status) return { action: "keep" };
  return { action: "copy", into: "existing", status };
}

// ── DB entry point ──────────────────────────────────────────────────────────

const MEALS_INCLUDE = {
  food_schedule_meals: { include: { food_schedule_meal_items: { orderBy: { display_order: "asc" as const } } } },
} satisfies Prisma.food_schedulesInclude;

type ScheduleRow = Prisma.food_schedulesGetPayload<{ include: typeof MEALS_INCLUDE }>;

function toSnapshot(row: ScheduleRow): ScheduleSnapshot {
  return {
    id: row.id,
    month: row.month,
    status: row.status as ScheduleStatus,
    source: row.source as ScheduleSource,
    cells: row.food_schedule_meals.map((m) => ({
      day_of_week: m.day_of_week,
      meal_type: m.meal_type,
      items: m.food_schedule_meal_items.map((i) => ({ menu_item_id: i.menu_item_id, item_name: i.item_name })),
    })),
  };
}

type Tx = Prisma.TransactionClient;

async function writeCells(tx: Tx, scheduleId: string, source: ScheduleSnapshot, now: Date) {
  const meals = await tx.food_schedule_meals.findMany({ where: { schedule_id: scheduleId } });
  const sourceByKey = new Map(source.cells.map((c) => [`${c.day_of_week}:${c.meal_type}`, c]));

  await tx.food_schedule_meal_items.deleteMany({ where: { schedule_meal_id: { in: meals.map((m) => m.id) } } });

  const itemRows: Prisma.food_schedule_meal_itemsCreateManyInput[] = [];
  for (const meal of meals) {
    const items = sourceByKey.get(`${meal.day_of_week}:${meal.meal_type}`)?.items ?? [];
    items.forEach((item, index) =>
      itemRows.push({ schedule_meal_id: meal.id, menu_item_id: item.menu_item_id, item_name: item.item_name, display_order: index }),
    );
    const legacy = items.length > 0
      ? deriveLegacyFields(items.map((i) => ({ menu_item_id: i.menu_item_id as string, item_name: i.item_name })))
      : { menu_item_id: null, item_name: EMPTY_CELL_NAME };
    await tx.food_schedule_meals.update({ where: { id: meal.id }, data: { ...legacy, updated_at: now } });
  }
  if (itemRows.length > 0) await tx.food_schedule_meal_items.createMany({ data: itemRows });
}

async function createScaffold(tx: Tx, hostelId: string, ownerId: string, month: Date, data: { status: ScheduleStatus; source: ScheduleSource; published_at: Date | null }) {
  const schedule = await tx.food_schedules.create({
    data: { hostel_id: hostelId, owner_id: ownerId, month, ...data },
  });
  await tx.food_schedule_meals.createMany({
    data: DAY_ORDER.flatMap((day) =>
      MEAL_TYPES.map((mealType) => ({
        schedule_id: schedule.id,
        day_of_week: day,
        meal_type: mealType,
        menu_item_id: null,
        item_name: EMPTY_CELL_NAME,
      })),
    ),
  });
  return schedule;
}

/**
 * Make sure `month` shows the owner's current menu, and return its row (or
 * null when there is no menu at all and `allowCreateEmpty` is false).
 *
 * Idempotent: a month that is already current is returned without writing.
 */
export async function ensureMonthSchedule(params: {
  hostelId: string;
  ownerId: string;
  month: Date;
  allowCreateEmpty: boolean;
  now?: Date;
}): Promise<ScheduleRow | null> {
  const { hostelId, ownerId, month, allowCreateEmpty } = params;
  const now = params.now ?? new Date();
  const where = { hostel_id_month: { hostel_id: hostelId, month } };

  const run = () =>
    prisma.$transaction(async (tx: Tx) => {
      const existingRow = await tx.food_schedules.findUnique({ where, include: MEALS_INCLUDE });
      const existing = existingRow ? toSnapshot(existingRow) : null;
      if (existing && isAuthored(existing)) return existingRow;

      const earlier = await tx.food_schedules.findMany({
        where: { hostel_id: hostelId, month: { lt: month }, source: { not: "CARRIED_FORWARD" } },
        orderBy: { month: "desc" },
        take: LOOKBACK_MONTHS,
        include: MEALS_INCLUDE,
      });
      const source = pickCarrySource(earlier.map(toSnapshot), month);

      const decision = decideMonth({ existing, source, target: month, currentMonth: firstOfMonthUtc(now), allowCreateEmpty });
      if (decision.action === "keep") return existingRow;

      if (decision.action === "create-empty") {
        await createScaffold(tx, hostelId, ownerId, month, { status: "DRAFT", source: "MANUAL", published_at: null });
        return tx.food_schedules.findUnique({ where, include: MEALS_INCLUDE });
      }

      const publishedAt = decision.status === "PUBLISHED" ? existingRow?.published_at ?? now : null;
      const scheduleId = decision.into === "new"
        ? (await createScaffold(tx, hostelId, ownerId, month, { status: decision.status, source: "CARRIED_FORWARD", published_at: publishedAt })).id
        : existingRow!.id;
      if (decision.into === "existing") {
        await tx.food_schedules.update({
          where: { id: scheduleId },
          data: { status: decision.status, source: "CARRIED_FORWARD", published_at: publishedAt, updated_at: now },
        });
      }
      await writeCells(tx, scheduleId, source!, now);
      return tx.food_schedules.findUnique({ where, include: MEALS_INCLUDE });
    });

  try {
    return await run();
  } catch (error: any) {
    // Two requests materialising the same month at once: the loser hits the
    // (hostel_id, month) unique index. The winner's row is the answer.
    if (error?.code === "P2002") return prisma.food_schedules.findUnique({ where, include: MEALS_INCLUDE });
    throw error;
  }
}
