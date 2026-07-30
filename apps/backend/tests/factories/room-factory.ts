import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export async function createTestRoom(hostelId: string, overrides = {}) {
  const room = await prisma.rooms.create({
    data: {
      hostel_id: hostelId,
      room_no: `R-${uuidv4().substring(0, 4)}`,
      capacity: 2,
      base_rent: 10000,
      ...overrides,
    },
  });
  return room;
}
