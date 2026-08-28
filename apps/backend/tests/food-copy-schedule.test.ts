import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { copyScheduleToHostels } from '@/lib/services/food/copy-schedule';
import { createTestOwner, createTestHostel } from './factories/owner-factory';

const MONTH = new Date('2026-08-01T00:00:00.000Z');
const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'] as const;

async function createSchedule(hostelId: string, ownerId: string, status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') {
  const schedule = await prisma.food_schedules.create({
    data: { hostel_id: hostelId, owner_id: ownerId, month: MONTH, status, source: 'MANUAL', published_at: status === 'PUBLISHED' ? new Date() : null },
  });
  await prisma.food_schedule_meals.createMany({
    data: DAY_ORDER.flatMap((day) =>
      MEAL_TYPES.map((mealType) => ({ schedule_id: schedule.id, day_of_week: day, meal_type: mealType, menu_item_id: null, item_name: 'Not set' })),
    ),
  });
  return schedule;
}

/** Directly fills one cell with items, creating library entries by name as needed — mirrors what the meals PATCH route would persist. */
async function fillCell(scheduleId: string, ownerId: string, hostelId: string, day: (typeof DAY_ORDER)[number], mealType: (typeof MEAL_TYPES)[number], names: string[]) {
  const meal = await prisma.food_schedule_meals.findFirstOrThrow({ where: { schedule_id: scheduleId, day_of_week: day, meal_type: mealType } });
  const items: { menu_item_id: string; item_name: string }[] = [];
  for (const name of names) {
    let item = await prisma.food_menu_items.findFirst({ where: { hostel_id: hostelId, meal_type: mealType, name } });
    if (!item) item = await prisma.food_menu_items.create({ data: { hostel_id: hostelId, owner_id: ownerId, meal_type: mealType, name } });
    items.push({ menu_item_id: item.id, item_name: item.name });
  }
  await prisma.food_schedule_meal_items.deleteMany({ where: { schedule_meal_id: meal.id } });
  if (items.length > 0) {
    await prisma.food_schedule_meal_items.createMany({
      data: items.map((item, index) => ({ schedule_meal_id: meal.id, menu_item_id: item.menu_item_id, item_name: item.item_name, display_order: index })),
    });
  }
  await prisma.food_schedule_meals.update({
    where: { id: meal.id },
    data: { menu_item_id: items[0]?.menu_item_id ?? null, item_name: items.map((i) => i.item_name).join(', ') },
  });
  return meal.id;
}

async function readCell(hostelId: string, day: (typeof DAY_ORDER)[number], mealType: (typeof MEAL_TYPES)[number]) {
  const schedule = await prisma.food_schedules.findUnique({ where: { hostel_id_month: { hostel_id: hostelId, month: MONTH } } });
  if (!schedule) return null;
  const meal = await prisma.food_schedule_meals.findFirst({
    where: { schedule_id: schedule.id, day_of_week: day, meal_type: mealType },
    include: { food_schedule_meal_items: { orderBy: { display_order: 'asc' } } },
  });
  return { schedule, meal };
}

describe('copyScheduleToHostels', () => {
  let owner: any;
  let sourceHostel: any;
  let targetHostel: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    sourceHostel = await createTestHostel(owner.id);
    targetHostel = await createTestHostel(owner.id);
  });

  it('copies a DRAFT source into a target with no schedule yet, landing as DRAFT', async () => {
    const source = await createSchedule(sourceHostel.id, owner.id, 'DRAFT');
    await fillCell(source.id, owner.id, sourceHostel.id, 'MONDAY', 'BREAKFAST', ['Idli', 'Sambar']);

    const result: any = await copyScheduleToHostels(source.id, owner.id, [targetHostel.id], false);

    expect(result.copied).toEqual([{ hostelId: targetHostel.id, hostelName: targetHostel.name, scheduleId: expect.any(String), status: 'DRAFT' }]);

    const target = await readCell(targetHostel.id, 'MONDAY', 'BREAKFAST');
    expect(target?.schedule.status).toBe('DRAFT');
    expect(target?.meal?.food_schedule_meal_items.map((i) => i.item_name)).toEqual(['Idli', 'Sambar']);

    // A distinct library entry must have been created in the target hostel — item ids never carry across hostels.
    const targetItem = await prisma.food_menu_items.findFirst({ where: { hostel_id: targetHostel.id, meal_type: 'BREAKFAST', name: 'Idli' } });
    const sourceItem = await prisma.food_menu_items.findFirst({ where: { hostel_id: sourceHostel.id, meal_type: 'BREAKFAST', name: 'Idli' } });
    expect(targetItem?.id).toBeDefined();
    expect(targetItem?.id).not.toBe(sourceItem?.id);
  });

  it('publishes the target automatically when the source is PUBLISHED', async () => {
    const source = await createSchedule(sourceHostel.id, owner.id, 'PUBLISHED');
    await fillCell(source.id, owner.id, sourceHostel.id, 'MONDAY', 'BREAKFAST', ['Idli']);

    const result: any = await copyScheduleToHostels(source.id, owner.id, [targetHostel.id], false);

    expect(result.copied[0].status).toBe('PUBLISHED');
    const target = await prisma.food_schedules.findUnique({ where: { hostel_id_month: { hostel_id: targetHostel.id, month: MONTH } } });
    expect(target?.status).toBe('PUBLISHED');
    expect(target?.published_at).not.toBeNull();
  });

  it('matches an existing active item and reactivates an inactive one in the target library, by name', async () => {
    const source = await createSchedule(sourceHostel.id, owner.id, 'DRAFT');
    await fillCell(source.id, owner.id, sourceHostel.id, 'MONDAY', 'BREAKFAST', ['Idli', 'Sambar']);

    const existingActive = await prisma.food_menu_items.create({ data: { hostel_id: targetHostel.id, owner_id: owner.id, meal_type: 'BREAKFAST', name: 'Idli' } });
    const existingInactive = await prisma.food_menu_items.create({
      data: { hostel_id: targetHostel.id, owner_id: owner.id, meal_type: 'BREAKFAST', name: 'Sambar', is_active: false },
    });

    await copyScheduleToHostels(source.id, owner.id, [targetHostel.id], false);

    const target = await readCell(targetHostel.id, 'MONDAY', 'BREAKFAST');
    const itemIds = target?.meal?.food_schedule_meal_items.map((i) => i.menu_item_id);
    expect(itemIds).toEqual([existingActive.id, existingInactive.id]);

    const reactivated = await prisma.food_menu_items.findUniqueOrThrow({ where: { id: existingInactive.id } });
    expect(reactivated.is_active).toBe(true);

    // No duplicate library rows were created for names that already existed.
    const count = await prisma.food_menu_items.count({ where: { hostel_id: targetHostel.id, meal_type: 'BREAKFAST', name: { in: ['Idli', 'Sambar'] } } });
    expect(count).toBe(2);
  });

  it('returns pendingOverwrite and writes nothing when a target already has content, until confirmOverwrite is passed', async () => {
    const source = await createSchedule(sourceHostel.id, owner.id, 'DRAFT');
    await fillCell(source.id, owner.id, sourceHostel.id, 'MONDAY', 'BREAKFAST', ['Idli']);

    const target = await createSchedule(targetHostel.id, owner.id, 'DRAFT');
    await fillCell(target.id, owner.id, targetHostel.id, 'MONDAY', 'BREAKFAST', ['Existing Dish']);

    const blocked: any = await copyScheduleToHostels(source.id, owner.id, [targetHostel.id], false);
    expect(blocked.pendingOverwrite).toEqual([{ hostelId: targetHostel.id, hostelName: targetHostel.name }]);

    const untouched = await readCell(targetHostel.id, 'MONDAY', 'BREAKFAST');
    expect(untouched?.meal?.food_schedule_meal_items.map((i) => i.item_name)).toEqual(['Existing Dish']);

    const confirmed: any = await copyScheduleToHostels(source.id, owner.id, [targetHostel.id], true);
    expect(confirmed.copied[0].hostelId).toBe(targetHostel.id);

    const overwritten = await readCell(targetHostel.id, 'MONDAY', 'BREAKFAST');
    expect(overwritten?.meal?.food_schedule_meal_items.map((i) => i.item_name)).toEqual(['Idli']);
  });

  it('rejects a target hostel that does not belong to the same owner', async () => {
    const otherOwner = await createTestOwner();
    const otherHostel = await createTestHostel(otherOwner.id);
    const source = await createSchedule(sourceHostel.id, owner.id, 'DRAFT');

    await expect(copyScheduleToHostels(source.id, owner.id, [otherHostel.id], false)).rejects.toThrow(/FORBIDDEN/);
  });
});
