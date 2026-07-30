import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export async function createTestObligation(
  tenantId: string, 
  ownerId: string, 
  hostelId: string, 
  overrides: any = {}
) {
  const obligation = await prisma.rent_obligations.create({
    data: {
      tenant_id: tenantId,
      owner_id: ownerId,
      hostel_id: hostelId,
      obligation_type: 'RENT',
      amount: 10000,
      total_amount: 10000,
      rent_month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      due_date: new Date(new Date().getFullYear(), new Date().getMonth(), 5),
      status: 'PENDING',
      ...overrides,
    },
  });

  return obligation;
}

export async function createTestPayment(obligationId: string, amountPaid: number, overrides: any = {}) {
  const obligation = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligationId } });

  const payment = await prisma.payments.create({
    data: {
      obligation_id: obligationId,
      tenant_id: obligation.tenant_id,
      owner_id: obligation.owner_id,
      hostel_id: obligation.hostel_id,
      amount_paid: amountPaid,
      payment_method: 'UPI',
      payment_date: new Date(),
      ...overrides,
    },
  });

  return payment;
}
