import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';

export async function createTestOwner(overrides = {}) {
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const id = uuidv4();
  
  console.log("FACTORY PRISMA:", !!prisma, !!prisma?.profile);
  const owner = await prisma.profile.create({
    data: {
      id,
      email: `owner-${id}@test.com`,
      password_hash: passwordHash,
      name: 'Test Owner',
      role: 'OWNER',
      ...overrides,
    },
  });

  return owner;
}

export async function createTestHostel(ownerId: string, overrides = {}) {
  const hostel = await prisma.hostels.create({
    data: {
      owner_id: ownerId,
      name: `Test Hostel ${uuidv4().substring(0, 5)}`,
      phone: '9876543210',
      address: '123 Test St',
      auto_rent_day: 5,
      ...overrides,
    },
  });

  return hostel;
}
