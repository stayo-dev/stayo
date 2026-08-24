import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { propertyService } from '@/lib/services/property-service';
import { createTestOwner, createTestHostel } from './factories/owner-factory';

/**
 * `saveRoomsForFloor` backs the hostel builder, which fills one floor at a
 * time. The shape that matters is the one the old provisioning path could not
 * express: a single floor holding a mix of sharing sizes at different rents.
 *
 * These exercise it against a real database. The *decision* it executes —
 * create/update/revive/retire, occupancy guards, cross-floor clashes — is
 * `planFloorRoomSave`, covered without a database in `floor-room-plan.test.ts`.
 */
describe('PropertyService.saveRoomsForFloor', () => {
  let owner: any;
  let hostel: any;
  let floor: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    floor = await prisma.floors.create({
      data: { hostel_id: hostel.id, owner_id: owner.id, name: 'Ground Floor', sort_order: 1 },
    });
  });

  const groundFloor = [
    { room_no: '101', capacity: 4, base_rent: 6000 },
    { room_no: '102', capacity: 4, base_rent: 6000 },
    { room_no: '103', capacity: 4, base_rent: 6000 },
    { room_no: '104', capacity: 2, base_rent: 9000 },
  ];

  it('creates a floor that mixes sharing sizes and rents', async () => {
    const created = await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);

    expect(created).toHaveLength(4);
    expect(created.map((r: any) => r.room_no)).toEqual(['101', '102', '103', '104']);
    expect(created.map((r: any) => r.capacity)).toEqual([4, 4, 4, 2]);
    expect(created.map((r: any) => Number(r.base_rent))).toEqual([6000, 6000, 6000, 9000]);
  });

  it('attaches every room to the floor and its hostel', async () => {
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);

    const rooms = await prisma.rooms.findMany({ where: { floor_id: floor.id } });
    expect(rooms).toHaveLength(4);
    expect(rooms.every((r) => r.hostel_id === hostel.id)).toBe(true);
    // The legacy Int column is kept in step with floor_id — parts of the read
    // path still group by it.
    expect(rooms.every((r) => r.floor === floor.sort_order)).toBe(true);
  });

  it('preserves the order the owner arranged the rooms in', async () => {
    const created = await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);
    expect(created.map((r: any) => r.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it('rejects a room number already used elsewhere in the hostel, creating nothing', async () => {
    const otherFloor = await prisma.floors.create({
      data: { hostel_id: hostel.id, owner_id: owner.id, name: 'First Floor', sort_order: 2 },
    });
    await propertyService.saveRoomsForFloor(otherFloor.id, owner.id, [
      { room_no: '201', capacity: 4, base_rent: 6000 },
    ]);

    await expect(
      propertyService.saveRoomsForFloor(floor.id, owner.id, [
        { room_no: '105', capacity: 4, base_rent: 6000 },
        { room_no: '201', capacity: 2, base_rent: 9000 },
      ]),
    ).rejects.toThrow(/Room 201 already exists/);

    // All-or-nothing: the valid room in that batch must not have landed.
    const stray = await prisma.rooms.findFirst({ where: { hostel_id: hostel.id, room_no: '105' } });
    expect(stray).toBeNull();
  });

  it('rejects a batch that repeats a number within itself', async () => {
    await expect(
      propertyService.saveRoomsForFloor(floor.id, owner.id, [
        { room_no: '101', capacity: 4 },
        { room_no: '101', capacity: 2 },
      ]),
    ).rejects.toThrow(/listed twice/);
  });

  it("refuses to fill another owner's floor", async () => {
    const intruder = await createTestOwner();

    await expect(
      propertyService.saveRoomsForFloor(floor.id, intruder.id, groundFloor),
    ).rejects.toThrow(/NOT_FOUND/);

    const rooms = await prisma.rooms.findMany({ where: { floor_id: floor.id } });
    expect(rooms).toHaveLength(0);
  });

  // The builder's Review screen offers an edit pencil on every floor; this is
  // the save that used to answer "Room 101 already exists" and strand the owner.
  it('saves the same floor twice without conflicting', async () => {
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);
    const again = await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);

    expect(again).toHaveLength(4);
    const rooms = await prisma.rooms.findMany({ where: { floor_id: floor.id, is_active: true } });
    expect(rooms).toHaveLength(4);
  });

  it('applies an edit made on a second save', async () => {
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);
    await propertyService.saveRoomsForFloor(floor.id, owner.id, [
      ...groundFloor.slice(0, 3),
      { room_no: '104', capacity: 3, base_rent: 7500 },
    ]);

    const room = await prisma.rooms.findFirst({ where: { hostel_id: hostel.id, room_no: '104' } });
    expect(room?.capacity).toBe(3);
    expect(Number(room?.base_rent)).toBe(7500);
  });

  it('retires a room dropped from a later save, rather than deleting it', async () => {
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor.slice(0, 3));

    const dropped = await prisma.rooms.findFirst({ where: { hostel_id: hostel.id, room_no: '104' } });
    expect(dropped).not.toBeNull();
    expect(dropped?.is_active).toBe(false);
  });

  it('revives a retired room when its number comes back', async () => {
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor.slice(0, 3));
    await propertyService.saveRoomsForFloor(floor.id, owner.id, groundFloor);

    const rooms = await prisma.rooms.findMany({ where: { hostel_id: hostel.id, room_no: '104' } });
    // One row, revived — not a second row fighting the unique index.
    expect(rooms).toHaveLength(1);
    expect(rooms[0].is_active).toBe(true);
  });

  it('leaves rent unset when the owner has not decided one', async () => {
    const created = await propertyService.saveRoomsForFloor(floor.id, owner.id, [
      { room_no: '110', capacity: 3 },
    ]);
    expect(created[0].base_rent).toBeNull();
  });
});
