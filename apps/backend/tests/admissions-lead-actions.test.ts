import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Fully mocks @/lib/db and every I/O-bearing dependency admissions-service.ts
 * touches for these two methods, so this runs under vitest.pure.config.ts
 * (no DATABASE_URL_TEST required) — see tests/admissions.test.ts for why that
 * file, despite the same db-mocking pattern, is not in the pure list.
 */
const { mockPrisma, mockWhatsAppSend, mockInviteTenant } = vi.hoisted(() => {
  return {
    mockPrisma: {
      visitorLead: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      leadActivity: {
        create: vi.fn(),
      },
      leadNote: {
        create: vi.fn(),
      },
      roomReservation: {
        updateMany: vi.fn(),
      },
    },
    mockWhatsAppSend: vi.fn().mockResolvedValue({ sent: true, skipped: false, idempotencyKey: 'k' }),
    mockInviteTenant: vi.fn().mockResolvedValue({ tenant_id: 'tenant-1' }),
  };
});

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
  supabase: {},
}));

vi.mock('@/lib/redis/cache', () => ({
  getOrSetJson: vi.fn((key: string, ttl: number, cb: () => unknown) => cb()),
  invalidateTag: vi.fn(),
}));

vi.mock('@/lib/redis/rate-limit', () => ({
  checkFixedWindowLimit: vi.fn(),
}));

vi.mock('@/lib/services/notifications/whatsapp-template-delivery', () => ({
  whatsAppTemplateDeliveryService: { send: mockWhatsAppSend },
}));

vi.mock('@/src/services/tenants/invitation-service', () => ({
  invitationService: { inviteTenant: mockInviteTenant },
}));

import { AdmissionsService } from '@/src/services/admissions/admissions-service';

function leadFixture(overrides: any = {}) {
  return {
    id: 'lead-1',
    owner_id: 'owner-1',
    hostel_id: 'hostel-1',
    status: 'NEW',
    student_name: 'Harsha',
    student_phone: '9876543210',
    student_email: null,
    converted_tenant_id: null,
    updated_at: new Date('2026-08-20T10:00:00Z'),
    ...overrides,
  };
}

describe('AdmissionsService.updateStatus — Accept / Hold / Reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhatsAppSend.mockResolvedValue({ sent: true, skipped: false, idempotencyKey: 'k' });
  });

  it('accepts a new lead and does not require a note or send a notification', async () => {
    const lead = leadFixture();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'ACCEPTED', hostel: { name: 'Hostel A' } });

    const service = new AdmissionsService();
    const result = await service.updateStatus('lead-1', 'owner-1', { status: 'ACCEPTED' });

    expect(result.status).toBe('ACCEPTED');
    expect(mockPrisma.leadNote.create).not.toHaveBeenCalled();
    expect(mockWhatsAppSend).not.toHaveBeenCalled();
  });

  it('rejects putting a lead on hold with no message, without writing anything', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValue(leadFixture());
    const service = new AdmissionsService();
    await expect(service.updateStatus('lead-1', 'owner-1', { status: 'ON_HOLD' })).rejects.toThrow();
    expect(mockPrisma.visitorLead.update).not.toHaveBeenCalled();
  });

  it('puts a lead on hold and stores the note', async () => {
    const lead = leadFixture();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'ON_HOLD', hostel: { name: 'Hostel A' } });

    const service = new AdmissionsService();
    const result = await service.updateStatus('lead-1', 'owner-1', {
      status: 'ON_HOLD',
      note: 'Checking with hostel manager',
    });

    expect(result.status).toBe('ON_HOLD');
    expect(mockPrisma.leadNote.create).toHaveBeenCalledWith({
      data: { lead_id: 'lead-1', owner_id: 'owner-1', note: 'Checking with hostel manager' },
    });
  });

  it('does not notify the tenant when a lead is put on hold — Hold only saves the note and changes status', async () => {
    const lead = leadFixture();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'ON_HOLD', hostel: { name: 'Hostel A' } });

    const service = new AdmissionsService();
    await service.updateStatus('lead-1', 'owner-1', { status: 'ON_HOLD', note: 'Checking with hostel manager' });

    expect(mockWhatsAppSend).not.toHaveBeenCalled();
  });

  it('rejects a lead and notifies the tenant', async () => {
    const lead = leadFixture();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'REJECTED', hostel: { name: 'Hostel A' } });

    const service = new AdmissionsService();
    const result = await service.updateStatus('lead-1', 'owner-1', { status: 'REJECTED' });

    expect(result.status).toBe('REJECTED');
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
  });

  it('refuses to re-reject an already-rejected lead (no double-notify)', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValue(leadFixture({ status: 'REJECTED' }));

    const service = new AdmissionsService();
    await expect(service.updateStatus('lead-1', 'owner-1', { status: 'REJECTED' })).rejects.toThrow(/already been rejected/i);
    expect(mockPrisma.visitorLead.update).not.toHaveBeenCalled();
    expect(mockWhatsAppSend).not.toHaveBeenCalled();
  });

  it('refuses to accept a lead that was already rejected', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValue(leadFixture({ status: 'REJECTED' }));
    const service = new AdmissionsService();
    await expect(service.updateStatus('lead-1', 'owner-1', { status: 'ACCEPTED' })).rejects.toThrow(/already been rejected/i);
  });

  it('refuses to accept a lead that was already converted to a tenant', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValue(leadFixture({ status: 'INVITED', converted_tenant_id: 'tenant-1' }));
    const service = new AdmissionsService();
    await expect(service.updateStatus('lead-1', 'owner-1', { status: 'ACCEPTED' })).rejects.toThrow(/already been converted/i);
  });

  it('a WhatsApp failure does not block the reject action from succeeding', async () => {
    const lead = leadFixture();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'REJECTED', hostel: { name: 'Hostel A' } });
    mockWhatsAppSend.mockRejectedValue(new Error('template not approved'));

    const service = new AdmissionsService();
    const result = await service.updateStatus('lead-1', 'owner-1', { status: 'REJECTED' });
    expect(result.status).toBe('REJECTED');
  });
});

describe('AdmissionsService.convertToInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInviteTenant.mockResolvedValue({ tenant_id: 'tenant-1' });
  });

  function acceptedLead(overrides: any = {}) {
    return {
      id: 'lead-1',
      owner_id: 'owner-1',
      hostel_id: 'hostel-1',
      status: 'ACCEPTED',
      student_name: 'Harsha',
      student_phone: '9876543210',
      student_email: 'harsha@gmail.com',
      converted_tenant_id: null,
      ...overrides,
    };
  }

  it('refuses to convert a lead that has not been accepted', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValue(acceptedLead({ status: 'NEW' }));
    const service = new AdmissionsService();
    await expect(
      service.convertToInvitation('lead-1', 'owner-1', { room_id: 'room-1' })
    ).rejects.toThrow(/accept the enquiry/i);
    expect(mockInviteTenant).not.toHaveBeenCalled();
  });

  it('refuses to convert a lead already linked to a tenant (duplicate-tenant protection)', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValue(acceptedLead({ converted_tenant_id: 'tenant-1' }));
    const service = new AdmissionsService();
    await expect(
      service.convertToInvitation('lead-1', 'owner-1', { room_id: 'room-1' })
    ).rejects.toThrow(/already connected/i);
    expect(mockInviteTenant).not.toHaveBeenCalled();
  });

  it('converts an accepted lead, defaulting name/phone/email from the enquiry and forwarding agreement terms', async () => {
    const lead = acceptedLead();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'INVITED', converted_tenant_id: 'tenant-1' });
    mockPrisma.roomReservation.updateMany.mockResolvedValue({ count: 0 });

    const service = new AdmissionsService();
    await service.convertToInvitation('lead-1', 'owner-1', {
      room_id: 'room-1',
      monthly_rent: 8000,
      agreement_duration_months: 11,
      payment_frequency: 'QUARTERLY',
    });

    expect(mockInviteTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Harsha',
        phone: '9876543210',
        email: 'harsha@gmail.com',
        room_id: 'room-1',
        agreement_duration_months: 11,
        payment_frequency: 'QUARTERLY',
      }),
      'owner-1'
    );
  });

  it('lets the owner override name/phone from the Add Tenant form without silently dropping the edit', async () => {
    const lead = acceptedLead();
    mockPrisma.visitorLead.findFirst.mockResolvedValue(lead);
    mockPrisma.visitorLead.update.mockResolvedValue({ ...lead, status: 'INVITED', converted_tenant_id: 'tenant-1' });
    mockPrisma.roomReservation.updateMany.mockResolvedValue({ count: 0 });

    const service = new AdmissionsService();
    await service.convertToInvitation('lead-1', 'owner-1', {
      room_id: 'room-1',
      name: 'Harsha Corrected',
      phone: '9123456789',
    });

    expect(mockInviteTenant).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Harsha Corrected', phone: '+919123456789' }),
      'owner-1'
    );
  });
});
