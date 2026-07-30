import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export async function createTestTenant(ownerId: string, hostelId: string, overrides: any = {}) {
  const profileId = uuidv4();
  
  const { name, email, phone, role, ...tenantOverrides } = overrides;

  // Create profile for tenant
  const profile = await prisma.profile.create({
    data: {
      id: profileId,
      name: name || `Tenant ${profileId.substring(0, 5)}`,
      email: email || `tenant-${profileId}@test.com`,
      phone: phone || Math.floor(1000000000 + Math.random() * 9000000000).toString(),
      role: role || 'TENANT',
    },
  });

  const tenant = await prisma.tenants.create({
    data: {
      profile_id: profile.id,
      owner_id: ownerId,
      hostel_id: hostelId,
      status: 'ACTIVE',
      personal_email: profile.email,
      ...tenantOverrides,
    },
  });

  return tenant;
}

export async function allocateTestRoom(tenantId: string, roomId: string, overrides: any = {}) {
  return await prisma.roomAllocation.create({
    data: {
      id: uuidv4(),
      tenant_id: tenantId,
      room_id: roomId,
      hostel_id: overrides.hostel_id,
      start_date: new Date(),
      is_active: true,
      ...overrides,
    },
  });
}

export async function createTestAgreement(tenantId: string, hostelId: string, overrides: any = {}) {
  // Agreement.template_id is a required FK (no default) — find or create a
  // template for this hostel rather than hardcoding a fixture id.
  let template = await prisma.agreementTemplate.findFirst({ where: { hostel_id: hostelId } });
  if (!template) {
    template = await prisma.agreementTemplate.create({
      data: {
        hostel_id: hostelId,
        version: `test-${uuidv4().substring(0, 8)}`,
        owner_name: 'Test Owner',
      },
    });
  }

  return await prisma.agreement.create({
    data: {
      tenant_id: tenantId,
      hostel_id: hostelId,
      template_id: template.id,
      status: 'SIGNED',
      // content_snapshot is a required Json column with no default.
      content_snapshot: {},
      contract_rent: 8000,
      agreement_duration_months: 12,
      agreement_start_date: new Date(Date.UTC(2026, 0, 1)),
      ...overrides,
    },
  });
}
