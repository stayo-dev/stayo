import { describe, expect, it, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant } from './factories/tenant-factory';
import { paymentService } from '@/src/services/payments/payment-service';

describe('Advance and Deposit Payment Intent Flows', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;

  beforeAll(async () => {
    owner = await createTestOwner();
    // Create hostel with preferences_config explicitly disabling advance payments
    hostel = await createTestHostel(owner.id, {
      preferences_config: {
        billing: {
          deposit: {
            enabled: false,
            default_amount: 5000,
            refundable: true,
          }
        }
      }
    });
    tenant = await createTestTenant(owner.id, hostel.id);
  });

  it('should fail to create advance payment intent when advance_enabled is false', async () => {
    await expect(
      paymentService.createAdvancePaymentIntent({
        tenantId: tenant.id,
        ownerId: owner.id,
        amount: 1000,
        profileId: owner.id,
      })
    ).rejects.toThrow('BAD_REQUEST: Advance/deposit payments are not enabled for this hostel');
  });

  it('should succeed to create advance payment intent when advance_enabled is true', async () => {
    // Enable advance payments
    await prisma.hostels.update({
      where: { id: hostel.id },
      data: {
        preferences_config: {
          billing: {
            deposit: {
              enabled: true,
              default_amount: 5000,
              refundable: true,
            }
          }
        }
      }
    });

    const attempt = await paymentService.createAdvancePaymentIntent({
      tenantId: tenant.id,
      ownerId: owner.id,
      amount: 1000,
      profileId: owner.id,
    });

    expect(attempt).toBeDefined();
    expect(attempt.status).toBe('PENDING');
    expect(Number(attempt.amount)).toBe(1000);
    expect(attempt.flow_type).toBe('FUTURE_RENT_CREDIT');
  });
});
