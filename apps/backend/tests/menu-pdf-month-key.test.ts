import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';

/**
 * A regression test for a bug that reached a running app.
 *
 * `GET /api/food/menu-pdf` takes `month` as `YYYY-MM` — the API's shape — and
 * passed that string straight into `food_schedules.findUnique`. The column is
 * `DateTime @db.Date`, so every request failed with *"Invalid value for
 * argument `month`: premature end of input. Expected ISO-8601 DateTime"* and
 * no owner could print a menu at all.
 *
 * Nothing that existed could have caught it: the content model is pure and
 * knows nothing of Prisma, and the PDF renderer was verified by rendering, not
 * by querying. The gap was that the route itself was never run against a
 * database. This closes that specific gap — it asserts the conversion the
 * route performs actually matches the column, which is the only part of that
 * route a unit test can meaningfully own.
 *
 * See ADR-144.
 */

/** Exactly the conversion `app/api/food/menu-pdf/route.ts` performs. */
function firstOfMonth(value: string): Date | null {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

describe('menu-pdf month key', () => {
  let hostelId: string;

  beforeAll(async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    hostelId = hostel.id;
    await prisma.food_schedules.create({
      data: {
        hostel_id: hostelId,
        owner_id: owner.id,
        month: firstOfMonth('2026-08')!,
        status: 'DRAFT',
      },
    });
  });

  afterAll(async () => {
    await prisma.food_schedules.deleteMany({ where: { hostel_id: hostelId } });
  });

  it('finds the schedule when the month is converted to a date', () => {
    return expect(
      prisma.food_schedules.findUnique({
        where: { hostel_id_month: { hostel_id: hostelId, month: firstOfMonth('2026-08')! } },
      }),
    ).resolves.not.toBeNull();
  });

  it('rejects the raw YYYY-MM string — the shape the route used to send', async () => {
    // Asserting the failure, not just the fix: if `month` ever became a string
    // column this test should be re-read rather than silently keep passing.
    await expect(
      prisma.food_schedules.findUnique({
        where: { hostel_id_month: { hostel_id: hostelId, month: '2026-08' as any } },
      }),
    ).rejects.toThrow(/ISO-8601 DateTime/);
  });

  it('anchors to the first of the month, whatever day the caller sends', () => {
    const anchor = firstOfMonth('2026-08');
    expect(anchor?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(firstOfMonth('2026-08-29')?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('returns null for a month it cannot read, so the route can answer 400', () => {
    expect(firstOfMonth('nonsense')).toBeNull();
  });
});
