import { describe, it, expect } from 'vitest';
import { planFloorRoomSave, type ExistingRoom } from '@/lib/services/property/floor-room-plan';

const FLOOR = 'floor-1';
const OTHER = 'floor-2';

const room = (over: Partial<ExistingRoom> & { room_no: string }): ExistingRoom => ({
  id: `id-${over.room_no}`,
  floor_id: FLOOR,
  is_active: true,
  capacity: 4,
  active_allocations: 0,
  ...over,
});

const ok = (plan: ReturnType<typeof planFloorRoomSave>) => {
  if (!plan.ok) throw new Error(`expected a plan, got: ${plan.reason}`);
  return plan;
};

describe('planFloorRoomSave — a first save', () => {
  it('creates every room when the floor is empty', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [
        { room_no: '101', capacity: 4, base_rent: 6000 },
        { room_no: '102', capacity: 2, base_rent: 9000 },
      ], []),
    );

    expect(plan.create.map((r) => r.room_no)).toEqual(['101', '102']);
    expect(plan.update).toEqual([]);
    expect(plan.deactivate).toEqual([]);
  });

  it('keeps the order the owner arranged as sort_order', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [
        { room_no: '103', capacity: 4 },
        { room_no: '101', capacity: 4 },
      ], []),
    );
    expect(plan.create.map((r) => r.sort_order)).toEqual([0, 1]);
  });

  it('carries an unset rent through as null rather than inventing one', () => {
    const plan = ok(planFloorRoomSave(FLOOR, [{ room_no: '101', capacity: 3 }], []));
    expect(plan.create[0].base_rent).toBeNull();
  });

  it('trims the numbers it was given', () => {
    const plan = ok(planFloorRoomSave(FLOOR, [{ room_no: '  101 ', capacity: 4 }], []));
    expect(plan.create[0].room_no).toBe('101');
  });
});

// The bug this planner exists for: the builder's Review screen offers a pencil
// on every floor, and taking it used to lead to "Room 101 already exists".
describe('planFloorRoomSave — saving a floor a second time', () => {
  const saved = [room({ room_no: '101' }), room({ room_no: '102' })];

  it('updates rather than conflicting when nothing has changed', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [
        { room_no: '101', capacity: 4 },
        { room_no: '102', capacity: 4 },
      ], saved),
    );

    expect(plan.create).toEqual([]);
    expect(plan.update.map((r) => r.id)).toEqual(['id-101', 'id-102']);
    expect(plan.deactivate).toEqual([]);
  });

  it('carries edited capacity and rent onto the existing row', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [
        { room_no: '101', capacity: 2, base_rent: 9500 },
        { room_no: '102', capacity: 4 },
      ], saved),
    );

    expect(plan.update[0]).toMatchObject({ id: 'id-101', capacity: 2, base_rent: 9500 });
  });

  it('creates only the rooms that are genuinely new', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [
        { room_no: '101', capacity: 4 },
        { room_no: '102', capacity: 4 },
        { room_no: '103', capacity: 4 },
      ], saved),
    );

    expect(plan.create.map((r) => r.room_no)).toEqual(['103']);
    expect(plan.update).toHaveLength(2);
  });

  it('retires a room the owner removed', () => {
    const plan = ok(planFloorRoomSave(FLOOR, [{ room_no: '101', capacity: 4 }], saved));
    expect(plan.deactivate).toEqual(['id-102']);
  });

  it('marks neither moved nor reactivated for an ordinary re-save', () => {
    const plan = ok(planFloorRoomSave(FLOOR, [{ room_no: '101', capacity: 4 }], saved));
    expect(plan.update[0]).toMatchObject({ moved: false, reactivated: false });
  });
});

describe('planFloorRoomSave — numbers owned by another floor', () => {
  it('refuses a number a live room on another floor already holds', () => {
    const plan = planFloorRoomSave(
      FLOOR,
      [{ room_no: '201', capacity: 4 }],
      [room({ room_no: '201', floor_id: OTHER })],
    );

    expect(plan).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect((plan as any).reason).toMatch(/Room 201 already exists/);
  });

  // `@@unique([hostel_id, room_no])` covers inactive rows too, so a retired
  // room still owns its number — inserting a second one would fail on the
  // index with a raw Postgres error instead of doing what was asked.
  it('revives a retired room from another floor instead of inserting a duplicate', () => {
    const plan = ok(
      planFloorRoomSave(
        FLOOR,
        [{ room_no: '201', capacity: 4 }],
        [room({ room_no: '201', floor_id: OTHER, is_active: false })],
      ),
    );

    expect(plan.create).toEqual([]);
    expect(plan.update[0]).toMatchObject({ id: 'id-201', moved: true, reactivated: true });
  });

  it('revives a room retired from this same floor', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [{ room_no: '104', capacity: 4 }], [room({ room_no: '104', is_active: false })]),
    );
    expect(plan.update[0]).toMatchObject({ id: 'id-104', moved: false, reactivated: true });
  });
});

describe('planFloorRoomSave — occupancy is protected', () => {
  it('refuses to remove a room someone lives in', () => {
    const plan = planFloorRoomSave(
      FLOOR,
      [{ room_no: '101', capacity: 4 }],
      [room({ room_no: '101' }), room({ room_no: '102', active_allocations: 2 })],
    );

    expect(plan).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect((plan as any).reason).toMatch(/Room 102 still has someone living in it/);
  });

  it('refuses to shrink a room below the people in it', () => {
    const plan = planFloorRoomSave(
      FLOOR,
      [{ room_no: '101', capacity: 2 }],
      [room({ room_no: '101', capacity: 4, active_allocations: 3 })],
    );

    expect(plan).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect((plan as any).reason).toMatch(/3 people in it.*cannot be set to 2-sharing/);
  });

  it('says "person" for one occupant', () => {
    const plan = planFloorRoomSave(
      FLOOR,
      [{ room_no: '101', capacity: 0 }],
      [room({ room_no: '101', active_allocations: 1 })],
    );
    expect((plan as any).reason).toMatch(/1 person in it/);
  });

  it('allows shrinking down to exactly the number of occupants', () => {
    const plan = planFloorRoomSave(
      FLOOR,
      [{ room_no: '101', capacity: 2 }],
      [room({ room_no: '101', capacity: 4, active_allocations: 2 })],
    );
    expect(plan.ok).toBe(true);
  });

  it('allows an empty room to be removed', () => {
    const plan = ok(
      planFloorRoomSave(FLOOR, [], [room({ room_no: '101' })]),
    );
    expect(plan.deactivate).toEqual(['id-101']);
  });
});

describe('planFloorRoomSave — bad input', () => {
  it('rejects a number repeated inside the request', () => {
    const plan = planFloorRoomSave(FLOOR, [
      { room_no: '101', capacity: 4 },
      { room_no: '101', capacity: 2 },
    ], []);

    expect(plan).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect((plan as any).reason).toMatch(/listed twice/);
  });

  it('rejects a blank number, naming its position', () => {
    const plan = planFloorRoomSave(FLOOR, [
      { room_no: '101', capacity: 4 },
      { room_no: '   ', capacity: 4 },
    ], []);

    expect(plan).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect((plan as any).reason).toMatch(/Room 2 needs a number/);
  });

  // Nothing is written when the plan is refused — the caller never gets a
  // partial list to apply, which is what keeps the save all-or-nothing.
  it('returns no writes at all when it refuses', () => {
    const plan = planFloorRoomSave(FLOOR, [{ room_no: '', capacity: 4 }], []);
    expect(plan).not.toHaveProperty('create');
    expect(plan).not.toHaveProperty('deactivate');
  });
});
