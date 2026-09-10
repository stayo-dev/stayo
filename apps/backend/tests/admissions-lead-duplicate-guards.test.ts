import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Covers two of the lead-creation bugs from the owner/tenant/lead audit:
 *  - Fix 1: a phone that already has a live tenancy at this exact hostel
 *    must not become a fresh visitor_leads row (mobile is the primary
 *    identity — a different email must not bypass this).
 *  - Fix 4: two concurrent lead submissions for the same hostel+phone must
 *    not both succeed as separate rows once the DB partial unique index
 *    (migration 079) is in place — a lost race falls back to the winning
 *    row instead of surfacing a raw 500.
 *
 * Fully mocks @/lib/db and tenancyEligibilityService, same pattern as
 * tests/admissions-lead-actions.test.ts.
 */
const { mockPrisma, mockHasLiveTenancyAtHostel } = vi.hoisted(() => {
  return {
    mockPrisma: {
      hostels: { findFirst: vi.fn() },
      visitorLead: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
    mockHasLiveTenancyAtHostel: vi.fn().mockResolvedValue(false),
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
  checkFixedWindowLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/src/services/tenants/tenancy-eligibility-service', () => ({
  tenancyEligibilityService: { hasLiveTenancyAtHostel: mockHasLiveTenancyAtHostel },
}));

// admissions-service.ts imports invitationService (used by convertToInvitation,
// not by the two methods under test here) which transitively pulls in
// email-service.ts's `new Resend(...)` at module load — mocked out the same
// way tests/admissions-lead-actions.test.ts does, so this file needs no
// RESEND_API_KEY to run.
vi.mock('@/src/services/tenants/invitation-service', () => ({
  invitationService: { inviteTenant: vi.fn() },
}));

vi.mock('@/lib/services/notifications/whatsapp-template-delivery', () => ({
  whatsAppTemplateDeliveryService: { send: vi.fn().mockResolvedValue({ sent: true, skipped: false, idempotencyKey: 'k' }) },
}));

import { AdmissionsService } from '@/src/services/admissions/admissions-service';

function hostelFixture(overrides: any = {}) {
  return {
    id: 'hostel-1',
    owner_id: 'owner-1',
    status: 'ACTIVE',
    admissions_enabled: true,
    public_slug: 'demo-hostel',
    ...overrides,
  };
}

describe('AdmissionsService lead creation — existing-tenant guard and race safety', () => {
  let service: AdmissionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdmissionsService();
    vi.spyOn(AdmissionsService.prototype, 'recordActivity').mockResolvedValue(undefined as any);
    vi.spyOn(AdmissionsService.prototype, 'getLeadForOwner').mockResolvedValue({ id: 'lead-1' } as any);
    mockHasLiveTenancyAtHostel.mockResolvedValue(false);
    mockPrisma.hostels.findFirst.mockResolvedValue(hostelFixture());
  });

  describe('createDirectLead (owner-authenticated)', () => {
    it('refuses to create a lead for a phone that already has a live tenancy at this hostel', async () => {
      mockHasLiveTenancyAtHostel.mockResolvedValue(true);

      await expect(
        service.createDirectLead('owner-1', {
          student_name: 'Rahul',
          student_phone: '9876543210',
          hostel_id: 'hostel-1',
        }),
      ).rejects.toThrow(/already a tenant at this hostel/i);

      expect(mockHasLiveTenancyAtHostel).toHaveBeenCalledWith('+919876543210', 'hostel-1');
      expect(mockPrisma.visitorLead.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.visitorLead.create).not.toHaveBeenCalled();
    });

    it('still refuses when a different email is submitted for the same mobile number', async () => {
      mockHasLiveTenancyAtHostel.mockResolvedValue(true);

      await expect(
        service.createDirectLead('owner-1', {
          student_name: 'Rahul',
          student_phone: '9876543210',
          student_email: 'a-brand-new-address@gmail.com',
          hostel_id: 'hostel-1',
        }),
      ).rejects.toThrow(/already a tenant/i);
    });

    it('allows lead creation when the phone has no live tenancy at this hostel', async () => {
      mockPrisma.visitorLead.findFirst.mockResolvedValue(null);
      mockPrisma.visitorLead.create.mockResolvedValue({ id: 'lead-1' });

      await service.createDirectLead('owner-1', {
        student_name: 'Rahul',
        student_phone: '9876543210',
        hostel_id: 'hostel-1',
      });

      expect(mockPrisma.visitorLead.create).toHaveBeenCalled();
    });

    it('falls back to the concurrent winner instead of a raw 500 when the DB unique index rejects a race', async () => {
      mockPrisma.visitorLead.findFirst
        .mockResolvedValueOnce(null) // pre-create dedup check finds nothing
        .mockResolvedValueOnce({
          id: 'lead-won-by-race',
          student_email: null,
          parent_name: null,
          parent_phone: null,
          notes: null,
          status: 'NEW',
          source: 'WALK_IN',
        }); // recovery lookup after P2002
      const p2002: any = new Error('Unique constraint failed on the fields: (`hostel_id`,`student_phone`)');
      p2002.code = 'P2002';
      mockPrisma.visitorLead.create.mockRejectedValue(p2002);
      mockPrisma.visitorLead.update.mockResolvedValue({ id: 'lead-won-by-race' });

      await service.createDirectLead('owner-1', {
        student_name: 'Rahul',
        student_phone: '9876543210',
        hostel_id: 'hostel-1',
      });

      expect(mockPrisma.visitorLead.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lead-won-by-race' } }),
      );
    });

    it('does not swallow an unrelated database error as if it were the race fallback', async () => {
      mockPrisma.visitorLead.findFirst.mockResolvedValue(null);
      const unrelated = new Error('connection reset');
      mockPrisma.visitorLead.create.mockRejectedValue(unrelated);

      await expect(
        service.createDirectLead('owner-1', {
          student_name: 'Rahul',
          student_phone: '9876543210',
          hostel_id: 'hostel-1',
        }),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('createLead (public QR/admissions-link capture)', () => {
    it('refuses to create a lead for a phone that already has a live tenancy at this hostel', async () => {
      mockHasLiveTenancyAtHostel.mockResolvedValue(true);

      await expect(
        service.createLead('demo-hostel', { student_name: 'Rahul', student_phone: '9876543210' }, '127.0.0.1'),
      ).rejects.toThrow(/already a tenant at this hostel/i);
      expect(mockPrisma.visitorLead.create).not.toHaveBeenCalled();
    });

    it('allows the public form to create a lead when there is no existing tenancy', async () => {
      mockPrisma.visitorLead.findFirst.mockResolvedValue(null);
      mockPrisma.visitorLead.create.mockResolvedValue({ id: 'lead-1' });

      await service.createLead('demo-hostel', { student_name: 'Rahul', student_phone: '9876543210' }, '127.0.0.1');

      expect(mockPrisma.visitorLead.create).toHaveBeenCalled();
    });
  });
});
