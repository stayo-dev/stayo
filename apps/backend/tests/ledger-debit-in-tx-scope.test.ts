import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { tenantFinancialLedgerService } from '@/src/services/payments/tenant-financial-ledger-service';
import { createTestOwner, createTestHostel } from './factories/owner-factory';

/**
 * `debitInTx` must do all of its work on the caller's transaction client.
 *
 * It used to call `_assertOwnership`, which reads through the *global* Prisma
 * client — a second connection, opened while the caller's interactive
 * transaction was still holding one. Under a saturated pool that read waits
 * for a free connection, the interactive transaction blows past its 5s
 * default timeout, and the next `tx.*` call fails with "Transaction API
 * error: Transaction not found. Transaction ID is invalid, refers to an old
 * closed transaction". Reported live as a 500 from
 * `tenant_financial_ledger.create()` when cancelling an invitation (the
 * cancel path waives pending obligations, which debits the ledger).
 *
 * The pool stall itself is timing-dependent and not reproducible here, so
 * these tests pin the *structural* property that caused it: work done inside
 * a transaction must see that transaction's own uncommitted state. A global-
 * client read cannot — which is what makes this a deterministic guard.
 */
describe('TenantFinancialLedgerService.debitInTx — stays on the caller transaction', () => {
  let owner: any;
  let hostel: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
  });

  async function createTenantOn(client: any, ownerId: string) {
    const profile = await client.profile.create({
      data: {
        id: randomUUID(),
        name: 'Ledger Scope Tenant',
        email: `ledger-${randomUUID()}@test.com`,
        phone: Math.floor(6000000000 + Math.random() * 3999999999).toString(),
        role: 'TENANT',
      },
    });
    return client.tenants.create({
      data: {
        profile_id: profile.id,
        owner_id: ownerId,
        hostel_id: hostel.id,
        status: 'INVITED',
        personal_email: profile.email,
      },
    });
  }

  it('debits a tenant created inside the same transaction — proving no read escapes to the global client', async () => {
    const result = await prisma.$transaction(async (tx: any) => {
      // Uncommitted: visible to `tx`, invisible to the global client. With the
      // old global-client ownership check this threw "NOT_FOUND: Tenant not
      // found" instead of debiting.
      const tenant = await createTenantOn(tx, owner.id);

      return tenantFinancialLedgerService.debitInTx(tx, {
        tenantId: tenant.id,
        ownerId: owner.id,
        createdBy: owner.id,
        reason: 'OBLIGATION_WAIVER',
        amount: 500,
        notes: 'scope regression',
      });
    });

    expect(result.entry).toBeTruthy();

    // Looked up by id, not by notes — this suite runs against a shared real
    // database with no per-test cleanup, so a `notes` lookup would match rows
    // left behind by earlier runs.
    const persisted = await prisma.tenant_financial_ledger.findUnique({
      where: { id: result.entry.id },
    });
    expect(persisted).not.toBeNull();
    expect(Number(persisted!.amount)).toBe(500);
    expect(persisted!.type).toBe('DEBIT');
    expect(persisted!.hostel_id).toBe(hostel.id);
  });

  it('still refuses to debit a tenant belonging to a different owner', async () => {
    const otherOwner = await createTestOwner();
    const tenant = await createTenantOn(prisma, otherOwner.id);

    await expect(
      prisma.$transaction(async (tx: any) =>
        tenantFinancialLedgerService.debitInTx(tx, {
          tenantId: tenant.id,
          ownerId: owner.id,
          createdBy: owner.id,
          reason: 'OBLIGATION_WAIVER',
          amount: 100,
        }),
      ),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('still reports a missing tenant as NOT_FOUND rather than a Prisma error', async () => {
    await expect(
      prisma.$transaction(async (tx: any) =>
        tenantFinancialLedgerService.debitInTx(tx, {
          tenantId: randomUUID(),
          ownerId: owner.id,
          createdBy: owner.id,
          reason: 'OBLIGATION_WAIVER',
          amount: 100,
        }),
      ),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});
