import { prisma } from "@/lib/db";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { notificationService } from "@/lib/services/notification-service";
import { deriveLegacyFields, type OrderedMealItem } from "./meal-items";
import { FoodMealType } from "@prisma/client";

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

export interface CopiedHostelResult {
  hostelId: string;
  hostelName: string;
  scheduleId: string;
  status: "DRAFT" | "PUBLISHED";
}

export interface CopyScheduleResult {
  copied: CopiedHostelResult[];
}

export interface PendingOverwrite {
  pendingOverwrite: { hostelId: string; hostelName: string }[];
}

function fail(prefixedCode: string, message: string): never {
  const err: any = new Error(`${prefixedCode}: ${message}`);
  err.code = prefixedCode;
  throw err;
}

/**
 * Copies a source schedule's full 28-cell weekly pattern into one or more of
 * the owner's other hostels for the same month. Item ids never carry across
 * hostels — `food_menu_items` is a per-hostel library — so items are matched
 * (or created) in each target library **by name**, the same find/reactivate/
 * create logic `POST /api/food/menu-items` already uses on a name collision.
 *
 * The target's publish state is made to match the source: a PUBLISHED
 * source publishes the target too (with the usual tenant notification, only
 * on the DRAFT->PUBLISHED transition); a DRAFT source leaves the target
 * DRAFT.
 *
 * If a target already has real content for this month and `confirmOverwrite`
 * is false, nothing is written — the pending hostel list is returned instead
 * so the caller can warn and retry with `confirmOverwrite: true`. Same
 * check-then-retry shape as the meals PATCH route's `STALE_WRITE` 409.
 */
export async function copyScheduleToHostels(
  sourceScheduleId: string,
  ownerId: string,
  targetHostelIds: unknown,
  confirmOverwrite: boolean,
): Promise<CopyScheduleResult | PendingOverwrite> {
  const source = await prisma.food_schedules.findFirst({
    where: { id: sourceScheduleId, owner_id: ownerId },
    include: { food_schedule_meals: { include: { food_schedule_meal_items: { orderBy: { display_order: "asc" } } } } },
  });
  if (!source) fail("NOT_FOUND", "Schedule not found");

  if (!Array.isArray(targetHostelIds) || targetHostelIds.length === 0) {
    fail("VALIDATION_ERROR", "targetHostelIds must be a non-empty array");
  }
  const uniqueTargets = Array.from(
    new Set((targetHostelIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  const targets = uniqueTargets.filter((id) => id !== source!.hostel_id);
  if (targets.length === 0) fail("VALIDATION_ERROR", "No valid target hostels to copy to");

  for (const targetHostelId of targets) {
    await requireHostelBelongsToOwner(ownerId, targetHostelId);
  }

  if (!confirmOverwrite) {
    const existingTargets = await prisma.food_schedules.findMany({
      where: { hostel_id: { in: targets }, month: source!.month },
      include: { food_schedule_meals: { include: { food_schedule_meal_items: true } } },
    });
    const hostelIdsWithContent = existingTargets
      .filter((s) => s.food_schedule_meals.some((m) => m.food_schedule_meal_items.length > 0))
      .map((s) => s.hostel_id);
    if (hostelIdsWithContent.length > 0) {
      const hostels = await prisma.hostels.findMany({
        where: { id: { in: hostelIdsWithContent } },
        select: { id: true, name: true },
      });
      return { pendingOverwrite: hostels.map((h) => ({ hostelId: h.id, hostelName: h.name })) };
    }
  }

  // Distinct (meal_type, name) pairs used anywhere in the source schedule —
  // resolved once per target hostel below, not once per cell.
  const distinctPairs = new Map<string, { mealType: string; name: string }>();
  for (const meal of source!.food_schedule_meals) {
    for (const item of meal.food_schedule_meal_items) {
      const key = `${meal.meal_type}::${item.item_name}`;
      if (!distinctPairs.has(key)) distinctPairs.set(key, { mealType: meal.meal_type, name: item.item_name });
    }
  }

  const copied: CopiedHostelResult[] = [];

  for (const targetHostelId of targets) {
    const { schedule: updatedSchedule, shouldNotify } = await prisma.$transaction(async (tx) => {
      const itemIdByKey = new Map<string, string>();
      for (const [key, { mealType, name }] of distinctPairs) {
        const existing = await tx.food_menu_items.findFirst({
          where: { hostel_id: targetHostelId, meal_type: mealType as FoodMealType, name },
        });
        if (existing) {
          if (!existing.is_active) {
            const reactivated = await tx.food_menu_items.update({
              where: { id: existing.id },
              data: { is_active: true, updated_at: new Date() },
            });
            itemIdByKey.set(key, reactivated.id);
          } else {
            itemIdByKey.set(key, existing.id);
          }
        } else {
          const created = await tx.food_menu_items.create({
            data: { hostel_id: targetHostelId, owner_id: ownerId, meal_type: mealType as FoodMealType, name },
          });
          itemIdByKey.set(key, created.id);
        }
      }

      let targetSchedule = await tx.food_schedules.findUnique({
        where: { hostel_id_month: { hostel_id: targetHostelId, month: source!.month } },
        include: { food_schedule_meals: true },
      });

      if (!targetSchedule) {
        const createdSchedule = await tx.food_schedules.create({
          data: { hostel_id: targetHostelId, owner_id: ownerId, month: source!.month, status: "DRAFT", source: "MANUAL" },
        });
        await tx.food_schedule_meals.createMany({
          data: DAY_ORDER.flatMap((day) =>
            MEAL_TYPES.map((mealType) => ({
              schedule_id: createdSchedule.id,
              day_of_week: day,
              meal_type: mealType,
              menu_item_id: null,
              item_name: "Not set",
            })),
          ),
        });
        targetSchedule = await tx.food_schedules.findUniqueOrThrow({
          where: { id: createdSchedule.id },
          include: { food_schedule_meals: true },
        });
      }

      const targetMealByDayType = new Map(targetSchedule.food_schedule_meals.map((m) => [`${m.day_of_week}::${m.meal_type}`, m]));

      const now = new Date();
      for (const sourceMeal of source!.food_schedule_meals) {
        const targetMeal = targetMealByDayType.get(`${sourceMeal.day_of_week}::${sourceMeal.meal_type}`);
        if (!targetMeal) continue; // every schedule always has all 28 cells — defensive only

        const mappedItems: OrderedMealItem[] = sourceMeal.food_schedule_meal_items.map((item) => {
          const key = `${sourceMeal.meal_type}::${item.item_name}`;
          const menuItemId = itemIdByKey.get(key);
          if (!menuItemId) throw new Error(`Internal error: no resolved item for ${key}`);
          return { menu_item_id: menuItemId, item_name: item.item_name };
        });
        const legacy = deriveLegacyFields(mappedItems);

        await tx.food_schedule_meal_items.deleteMany({ where: { schedule_meal_id: targetMeal.id } });
        if (mappedItems.length > 0) {
          await tx.food_schedule_meal_items.createMany({
            data: mappedItems.map((item, index) => ({
              schedule_meal_id: targetMeal.id,
              menu_item_id: item.menu_item_id,
              item_name: item.item_name,
              display_order: index,
            })),
          });
        }
        await tx.food_schedule_meals.update({
          where: { id: targetMeal.id },
          data: { menu_item_id: legacy.menu_item_id, item_name: legacy.item_name, updated_at: now },
        });
      }

      const wasAlreadyPublished = targetSchedule.status === "PUBLISHED";
      const shouldPublish = source!.status === "PUBLISHED";
      const schedule = await tx.food_schedules.update({
        where: { id: targetSchedule.id },
        data: {
          source: "MANUAL",
          updated_at: now,
          status: shouldPublish ? "PUBLISHED" : targetSchedule.status,
          published_at: shouldPublish && !wasAlreadyPublished ? now : targetSchedule.published_at,
        },
      });

      return { schedule, shouldNotify: shouldPublish && !wasAlreadyPublished };
    });

    const hostel = await prisma.hostels.findUnique({ where: { id: targetHostelId }, select: { name: true } });
    copied.push({
      hostelId: targetHostelId,
      hostelName: hostel?.name ?? "",
      scheduleId: updatedSchedule.id,
      status: updatedSchedule.status as "DRAFT" | "PUBLISHED",
    });

    if (shouldNotify) {
      const tenants = await prisma.tenants.findMany({
        where: { owner_id: ownerId, hostel_id: targetHostelId, status: "ACTIVE", profile_id: { not: null } },
        select: { profile_id: true },
      });
      await Promise.allSettled(
        tenants
          .filter((t): t is { profile_id: string } => Boolean(t.profile_id))
          .map((t) =>
            notificationService.createNotification(
              t.profile_id,
              "This month's food menu is live",
              "Your hostel owner published the food schedule — check what's cooking this week.",
              "food_schedule_published",
            ),
          ),
      );
    }
  }

  return { copied };
}
