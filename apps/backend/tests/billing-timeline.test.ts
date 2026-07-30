import { describe, it, expect, beforeEach } from 'vitest';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { prisma } from '@/lib/db';
import { BillingTimelineService } from '@/lib/services/billing-timeline-service';

describe('BillingTimelineService', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;
  const billingTimelineService = new BillingTimelineService();

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it('should compute next rent generation information successfully', async () => {
    // Generate a past rent obligation
    await prisma.rent_obligations.create({
      data: {
        obligation_type: 'RENT',
        amount: 8000,
        total_amount: 8000,
        rent_month: new Date(Date.UTC(2026, 5, 1)), // June 2026
        due_date: new Date(Date.UTC(2026, 5, 5)),
        status: 'PAID',
        billing_period_start: new Date(Date.UTC(2026, 5, 1)),
        billing_period_end: new Date(Date.UTC(2026, 5, 30)),
        hostels: { connect: { id: hostel.id } },
        tenants: { connect: { id: tenant.id } },
      },
    });

    const result = await billingTimelineService.getTenantTimeline(tenant.id, owner.id);

    expect(result).toHaveProperty('next_rent_generation');
    expect(result.next_rent_generation).toHaveProperty('next_rent_month');
    expect(result.next_rent_generation).toHaveProperty('next_rent_generation_date');
    expect(result.next_rent_generation).toHaveProperty('next_installment_due_date');
    expect(result.next_rent_generation).toHaveProperty('next_installment_amount');

    const nextRentMonth = new Date(result.next_rent_generation.next_rent_month);
    expect(nextRentMonth.getUTCMonth()).toBe(6); // July (since latest was June)
    expect(nextRentMonth.getUTCFullYear()).toBe(2026);
  });

  it('should exclude ONE_TIME maintenance and sort events chronologically', async () => {
    // 1. Update tenant to have ONE_TIME maintenance
    await prisma.tenants.update({
      where: { id: tenant.id },
      data: {
        maintenance_charge: 1000,
        maintenance_type: 'ONE_TIME',
        monthly_rent: 8000,
      },
    });

    // 2. Create rent obligation (paid)
    const ob1 = await prisma.rent_obligations.create({
      data: {
        obligation_type: 'RENT',
        amount: 8000,
        total_amount: 8000,
        rent_month: new Date(Date.UTC(2026, 5, 1)),
        due_date: new Date(Date.UTC(2026, 5, 5)),
        status: 'PAID',
        billing_period_start: new Date(Date.UTC(2026, 5, 1)),
        billing_period_end: new Date(Date.UTC(2026, 5, 30)),
        hostels: { connect: { id: hostel.id } },
        tenants: { connect: { id: tenant.id } },
      },
    });

    // Add payment for the obligation
    await prisma.payments.create({
      data: {
        amount_paid: 8000,
        payment_date: new Date(Date.UTC(2026, 5, 3)), // Paid on June 3 (before due date)
        payment_method: 'CASH',
        owner_id: owner.id,
        obligation: { connect: { id: ob1.id } },
        tenants: { connect: { id: tenant.id } },
        hostels: { connect: { id: hostel.id } },
      },
    });

    // 3. Create maintenance obligation (unpaid/due later)
    await prisma.rent_obligations.create({
      data: {
        obligation_type: 'MAINTENANCE',
        amount: 1000,
        total_amount: 1000,
        rent_month: new Date(Date.UTC(2026, 5, 1)),
        due_date: new Date(Date.UTC(2026, 5, 10)),
        status: 'PENDING',
        billing_period_start: new Date(Date.UTC(2026, 5, 1)),
        billing_period_end: new Date(Date.UTC(2026, 5, 30)),
        hostels: { connect: { id: hostel.id } },
        tenants: { connect: { id: tenant.id } },
      },
    });

    const result = await billingTimelineService.getTenantTimeline(tenant.id, owner.id);

    // Assert ONE_TIME maintenance is 0 in the projection
    expect(result.next_rent_generation.next_maintenance_amount).toBe(0);

    // Assert chronological sorting (ascending):
    // Paid rent (payment date June 3) is first (index 0)
    // Unpaid maintenance (due date June 10) is next (index 1)
    expect(result.items.length).toBe(2);
    expect(result.items[0].type).toBe('RENT_PAID');
    expect(result.items[1].type).toBe('MAINTENANCE_GENERATED');
    expect(new Date(result.items[0].event_date).getUTCDate()).toBe(3);
    expect(new Date(result.items[1].event_date).getUTCDate()).toBe(10);
  });
});
