import { describe, expect, it } from 'vitest';
import type { RoomOccupant, RoomWithOccupants } from '../types';
import {
  countRooms,
  countSlots,
  floorLevel,
  floorPlate,
  roomAriaLabel,
  roomBedSlots,
  roomMatches,
  slotEmphasis,
  stackFloors,
  tileColumns,
  tileMinWidthPx,
  UNASSIGNED_FLOOR_ID,
} from './buildingModel';

function room(p: {
  number?: string;
  occupied?: number;
  reserved?: number;
  capacity?: number;
  occupants?: RoomOccupant[];
}): RoomWithOccupants {
  const { occupied = 0, reserved = 0, capacity = 4 } = p;
  const beds: RoomWithOccupants['beds'] = [];
  for (let i = 0; i < occupied; i++) beds.push({ id: `o${i}`, status: 'occupied' });
  for (let i = 0; i < reserved; i++) beds.push({ id: `r${i}`, status: 'reserved' });
  while (beds.length < capacity) beds.push({ id: `v${beds.length}`, status: 'vacant' });
  return {
    id: `room-${p.number ?? '101'}`,
    number: p.number ?? '101',
    floorId: 'f1',
    hostelId: 'h1',
    rent: 8000,
    beds,
    occupants: p.occupants ?? [],
  };
}

const tenant = (name: string, extra: Partial<RoomOccupant> = {}): RoomOccupant => ({
  tenant_id: `t-${name}`,
  name,
  rent: 8000,
  pending_dues: 0,
  status: 'ACTIVE',
  photo_url: null,
  payment_status: 'PAID',
  ...extra,
});
const invitee = (name: string): RoomOccupant => ({
  ...tenant(name),
  status: 'INVITED',
  occupant_type: 'INVITED',
  payment_status: 'INVITED',
});

describe('floorLevel / floorPlate', () => {
  it.each([
    ['Ground floor', 0, 'G'],
    ['ground', 0, 'G'],
    ['G', 0, 'G'],
    ['First floor', 1, '1'],
    ['Second Floor', 2, '2'],
    ['twelfth floor', 12, '12'],
    ['2nd floor', 2, '2'],
    ['Floor 3', 3, '3'],
    ['Level 4', 4, '4'],
    ['3', 3, '3'],
  ])('%s is level %s, plate %s', (name, level, plate) => {
    expect(floorLevel(name)).toBe(level);
    expect(floorPlate(name)).toBe(plate);
  });

  it('names the floors that are not levels', () => {
    expect(floorPlate('Basement')).toBe('B');
    expect(floorPlate('Terrace')).toBe('T');
    expect(floorPlate('Roof top')).toBe('T');
    expect(floorPlate('Annexe')).toBe('A');
    expect(floorPlate('Block B')).toBe('BB');
    expect(floorLevel('Annexe')).toBeNull();
  });
});

describe('stackFloors', () => {
  it('puts the highest floor on top, as a building stands', () => {
    const floors = [
      { id: 'g', order: 0 },
      { id: 'two', order: 2 },
      { id: 'one', order: 1 },
    ];
    expect(stackFloors(floors).stacked.map((f) => f.id)).toEqual(['two', 'one', 'g']);
  });

  it('keeps rooms without a floor out of the stack', () => {
    const floors = [
      { id: 'g', order: 0 },
      { id: UNASSIGNED_FLOOR_ID, order: 999 },
    ];
    const { stacked, unassigned } = stackFloors(floors);
    expect(stacked.map((f) => f.id)).toEqual(['g']);
    expect(unassigned?.id).toBe(UNASSIGNED_FLOOR_ID);
  });
});

describe('roomBedSlots', () => {
  it('shows every tenant, then every invite, then the free beds', () => {
    const slots = roomBedSlots(room({ occupied: 1, reserved: 1, capacity: 4, occupants: [tenant('Arjun'), invitee('Ravi')] }));
    expect(slots.map((s) => s.kind)).toEqual(['tenant', 'invited', 'free', 'free']);
    expect(slots[1]).toMatchObject({ kind: 'invited', name: 'Ravi' });
  });

  it('marks a tenant overdue only on the backend’s OVERDUE verdict', () => {
    const slots = roomBedSlots(
      room({
        occupied: 2,
        occupants: [tenant('A', { payment_status: 'OVERDUE' }), tenant('B', { pending_dues: 900, payment_status: 'PENDING' })],
      }),
    );
    expect(slots[0]).toMatchObject({ kind: 'tenant', overdue: true });
    expect(slots[1]).toMatchObject({ kind: 'tenant', overdue: false });
  });

  it('keeps a held bed amber even when the invite has no name to show', () => {
    const slots = roomBedSlots(room({ reserved: 1, occupants: [] }));
    expect(slots[0]).toMatchObject({ kind: 'invited', name: null });
  });

  it('never hides a person when the counts disagree with the list', () => {
    const slots = roomBedSlots(room({ occupied: 1, capacity: 1, occupants: [tenant('A'), tenant('B')] }));
    expect(slots.filter((s) => s.kind === 'tenant')).toHaveLength(2);
  });

  it('gives every slot a stable, unique key', () => {
    const keys = roomBedSlots(room({ occupied: 1, reserved: 1, occupants: [tenant('A'), invitee('B')] })).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('counts', () => {
  it('counts beds by what is in them', () => {
    const slots = roomBedSlots(
      room({ occupied: 2, reserved: 1, capacity: 4, occupants: [tenant('A', { payment_status: 'OVERDUE' }), tenant('B'), invitee('C')] }),
    );
    expect(countSlots(slots)).toEqual({ beds: 4, tenants: 2, free: 1, invited: 1, overdue: 1 });
  });

  it('adds rooms up', () => {
    const a = room({ number: '101', occupied: 1, occupants: [tenant('A')] });
    const b = room({ number: '102', capacity: 2 });
    expect(countRooms([a, b])).toEqual({ beds: 6, tenants: 1, free: 5, invited: 0, overdue: 0 });
  });
});

describe('tile sizing', () => {
  it('fits up to four beds two across, then three, then four', () => {
    expect([1, 4, 5, 9, 10, 20].map(tileColumns)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it('sizes a tile to its widest room', () => {
    expect(tileMinWidthPx(4)).toBe(2 * 23 + 4 + 10);
    expect(tileMinWidthPx(6)).toBe(3 * 23 + 2 * 4 + 10);
  });
});

describe('roomMatches', () => {
  const r = room({ number: 'G04', occupied: 1, occupants: [tenant('Ravi Kumar')] });
  it('matches everything when nothing is typed', () => expect(roomMatches(r, '  ')).toBe(true));
  it('finds a room by its number', () => expect(roomMatches(r, 'g0')).toBe(true));
  it('finds a room by who lives there', () => expect(roomMatches(r, 'kumar')).toBe(true));
  it('does not match strangers', () => expect(roomMatches(r, 'suresh')).toBe(false));
});

describe('slotEmphasis', () => {
  const [t, i, f] = roomBedSlots(
    room({ occupied: 1, reserved: 1, capacity: 3, occupants: [tenant('A', { payment_status: 'OVERDUE' }), invitee('B')] }),
  );
  it('leaves everything alone with no lens', () =>
    expect([t, i, f].map((s) => slotEmphasis(s, null))).toEqual(['normal', 'normal', 'normal']));
  it('lights the free beds', () => expect([t, i, f].map((s) => slotEmphasis(s, 'free'))).toEqual(['dim', 'dim', 'glow']));
  it('lights who is overdue', () => expect([t, i, f].map((s) => slotEmphasis(s, 'overdue'))).toEqual(['glow', 'dim', 'dim']));
  it('lights the invites', () => expect([t, i, f].map((s) => slotEmphasis(s, 'invited'))).toEqual(['dim', 'glow', 'dim']));
});

describe('roomAriaLabel', () => {
  it('reads the room out the way an owner would say it', () => {
    const slots = roomBedSlots(
      room({
        number: '302',
        occupied: 1,
        reserved: 1,
        capacity: 4,
        occupants: [tenant('Arjun Reddy', { payment_status: 'OVERDUE' }), invitee('Ravi Kumar')],
      }),
    );
    expect(roomAriaLabel('302', slots)).toBe('Room 302: Arjun Reddy, overdue; Ravi Kumar, invited; 2 free beds');
  });

  it('handles an empty room and a single free bed', () => {
    expect(roomAriaLabel('403', roomBedSlots(room({ capacity: 4 })))).toBe('Room 403: 4 free beds');
    expect(roomAriaLabel('404', roomBedSlots(room({ occupied: 1, capacity: 2, occupants: [tenant('A')] })))).toBe(
      'Room 404: A; 1 free bed',
    );
  });

  it('names a held bed without an invite name', () => {
    expect(roomAriaLabel('9', roomBedSlots(room({ reserved: 1, capacity: 1 })))).toBe('Room 9: 1 bed held for an invite');
  });
});
