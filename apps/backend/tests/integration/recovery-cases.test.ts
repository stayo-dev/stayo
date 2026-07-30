import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';

describe('correction_cases schema', () => {
  it('can insert and read back a minimal row', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    const kase = await prisma.correction_cases.create({
      data: {
        hostel_id: hostel.id,
        domain: 'PAYMENTS',
        case_type: 'SMOKE_TEST',
        tier: 'FINANCIAL_CORRECTION',
        status: 'DRAFT',
        entity_refs: [{ type: 'payment', id: 'placeholder' }],
        reason: 'schema smoke test',
        actor_id: owner.id,
        actor_role: 'OWNER',
        before_snapshot: {},
        case_detail: {},
        idempotency_key: `SMOKE_TEST:${hostel.id}`,
      },
    });

    expect(kase.status).toBe('DRAFT');

    const event = await prisma.correction_case_events.create({
      data: {
        correction_case_id: kase.id,
        event_type: 'CREATED',
        actor_id: owner.id,
        actor_role: 'OWNER',
      },
    });

    expect(event.correction_case_id).toBe(kase.id);
  });
});

import { correctionRegistry } from '@/src/services/recovery/correction-registry';
import type { CorrectionHandler } from '@/src/services/recovery/types';

describe('correctionRegistry', () => {
  it('registers and resolves a handler by case_type', () => {
    const fakeHandler: CorrectionHandler = {
      caseType: 'TEST_CASE_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: {
        canPreview: async () => true,
        canExecute: async () => ({ allowed: true }),
      },
      createCase: async () => ({ domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [], beforeSnapshot: {}, caseDetail: {}, idempotencyKey: 'x' }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => ({}),
      affectedEntities: () => [],
    };

    correctionRegistry.register(fakeHandler);
    expect(correctionRegistry.resolve('TEST_CASE_TYPE')).toBe(fakeHandler);
  });

  it('throws when registering a duplicate case_type', () => {
    const handler: CorrectionHandler = {
      caseType: 'DUPLICATE_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async () => ({ domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [], beforeSnapshot: {}, caseDetail: {}, idempotencyKey: 'y' }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => ({}),
      affectedEntities: () => [],
    };
    correctionRegistry.register(handler);
    expect(() => correctionRegistry.register(handler)).toThrow(/duplicate case_type/);
  });

  it('throws a clear error when resolving an unknown case_type', () => {
    expect(() => correctionRegistry.resolve('NOT_REGISTERED')).toThrow(/no handler registered/i);
  });
});

import { recoveryService } from '@/src/services/recovery/recovery-service';

describe('recoveryService.createCase + preview', () => {
  it('creates a DRAFT case via the registered handler, then previews it to PREVIEW', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    correctionRegistry.register({
      caseType: 'SERVICE_TEST_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async (ctx) => ({
        domain: 'PAYMENTS',
        tier: 'FINANCIAL_CORRECTION',
        entityRefs: [{ type: 'test', id: 'x' }],
        beforeSnapshot: { note: 'before' },
        caseDetail: { input: ctx.input },
        idempotencyKey: `SERVICE_TEST_TYPE:${hostel.id}:${ctx.input.marker}`,
      }),
      computeImpact: async () => ({
        balanceChanges: [], obligationChanges: [], ledgerEntries: [],
        affectedReports: ['Test Report'], notifications: [], warnings: ['test warning'],
      }),
      execute: async () => ({}),
      affectedEntities: () => [],
    });

    const created = await recoveryService.createCase('SERVICE_TEST_TYPE', {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'testing',
      input: { marker: 'abc' },
    });

    expect(created.status).toBe('DRAFT');
    expect(created.hostelId).toBe(hostel.id);

    const previewed = await recoveryService.preview(created.id);
    expect(previewed.affectedReports).toEqual(['Test Report']);

    const reloaded = await recoveryService.getCase(created.id);
    expect(reloaded.status).toBe('PREVIEW');
    expect(reloaded.previewImpact?.warnings).toEqual(['test warning']);
  });

  it('is idempotent on double-submit — same idempotency key returns the same case', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    const ctx = {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'double submit test',
      input: { marker: 'dup' },
    };

    const first = await recoveryService.createCase('SERVICE_TEST_TYPE', ctx);
    const second = await recoveryService.createCase('SERVICE_TEST_TYPE', ctx);
    expect(second.id).toBe(first.id);
  });

  it('handles concurrent double-submit gracefully (P2002 race handling)', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    const ctx = {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'concurrent submit test',
      input: { marker: 'concurrent' },
    };

    const [first, second] = await Promise.all([
      recoveryService.createCase('SERVICE_TEST_TYPE', ctx),
      recoveryService.createCase('SERVICE_TEST_TYPE', ctx),
    ]);

    expect(first.id).toBe(second.id);
    expect(first.status).toBe('DRAFT');
  });
});

describe('recoveryService.validate', () => {
  it('transitions PREVIEW to VALIDATED when the policy allows it', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    correctionRegistry.register({
      caseType: 'VALIDATE_TEST_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async () => ({
        domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [],
        beforeSnapshot: {}, caseDetail: {}, idempotencyKey: `VALIDATE_TEST_TYPE:${hostel.id}`,
      }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => ({}),
      affectedEntities: () => [],
    });

    const kase = await recoveryService.createCase('VALIDATE_TEST_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x', input: {},
    });
    await recoveryService.preview(kase.id);

    const result = await recoveryService.validate(kase.id);
    expect(result.allowed).toBe(true);

    const reloaded = await recoveryService.getCase(kase.id);
    expect(reloaded.status).toBe('VALIDATED');
  });

  it('refuses validation and reports the reason when the policy denies it', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    correctionRegistry.register({
      caseType: 'VALIDATE_DENY_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: false, reason: 'business rule says no' }) },
      createCase: async () => ({
        domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [],
        beforeSnapshot: {}, caseDetail: {}, idempotencyKey: `VALIDATE_DENY_TYPE:${hostel.id}`,
      }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => ({}),
      affectedEntities: () => [],
    });

    const kase = await recoveryService.createCase('VALIDATE_DENY_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x', input: {},
    });
    await recoveryService.preview(kase.id);

    const result = await recoveryService.validate(kase.id);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('business rule says no');

    const reloaded = await recoveryService.getCase(kase.id);
    expect(reloaded.status).toBe('PREVIEW'); // unchanged
  });

  it('blocks validation while an unmet dependency exists', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    correctionRegistry.register({
      caseType: 'DEP_TEST_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async (ctx) => ({
        domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [],
        beforeSnapshot: {}, caseDetail: {},
        idempotencyKey: `DEP_TEST_TYPE:${hostel.id}:${ctx.input.marker}`,
        dependsOn: (ctx.input.dependsOn as string[]) ?? [],
      }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => ({}),
      affectedEntities: () => [],
    });

    const dependency = await recoveryService.createCase('DEP_TEST_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x', input: { marker: 'dep' },
    });
    await recoveryService.preview(dependency.id);
    // dependency is left in PREVIEW — not yet COMPLETED

    const dependent = await recoveryService.createCase('DEP_TEST_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x',
      input: { marker: 'main', dependsOn: [dependency.id] },
    });
    await recoveryService.preview(dependent.id);

    const result = await recoveryService.validate(dependent.id);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/dependency/i);
  });
});

describe('recoveryService.execute', () => {
  it('runs execute() inside a transaction and marks the case COMPLETED', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    let executeCalls = 0;

    correctionRegistry.register({
      caseType: 'EXECUTE_TEST_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async () => ({
        domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [],
        beforeSnapshot: {}, caseDetail: {}, idempotencyKey: `EXECUTE_TEST_TYPE:${hostel.id}`,
      }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => {
        executeCalls += 1;
        return { wrote: 'something' };
      },
      affectedEntities: () => [],
    });

    const kase = await recoveryService.createCase('EXECUTE_TEST_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x', input: {},
    });
    await recoveryService.preview(kase.id);
    await recoveryService.validate(kase.id);

    const result = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(result.status).toBe('COMPLETED');
    expect(result.executionResult).toEqual({ wrote: 'something' });
    expect(executeCalls).toBe(1);
  });

  it('marks the case FAILED when the handler throws, and allows a retry', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    let attempt = 0;

    correctionRegistry.register({
      caseType: 'EXECUTE_FAIL_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async () => ({
        domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [],
        beforeSnapshot: {}, caseDetail: {}, idempotencyKey: `EXECUTE_FAIL_TYPE:${hostel.id}`,
      }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('simulated infra failure');
        return { wrote: 'on retry' };
      },
      affectedEntities: () => [],
    });

    const kase = await recoveryService.createCase('EXECUTE_FAIL_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x', input: {},
    });
    await recoveryService.preview(kase.id);
    await recoveryService.validate(kase.id);

    const failed = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(failed.status).toBe('FAILED');

    const retried = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(retried.status).toBe('COMPLETED');
    expect(retried.executionResult).toEqual({ wrote: 'on retry' });
  });

  it('permanently fails after 3 attempts', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    correctionRegistry.register({
      caseType: 'EXECUTE_ALWAYS_FAIL_TYPE',
      domain: 'PAYMENTS',
      tier: 'FINANCIAL_CORRECTION',
      policy: { canPreview: async () => true, canExecute: async () => ({ allowed: true }) },
      createCase: async () => ({
        domain: 'PAYMENTS', tier: 'FINANCIAL_CORRECTION', entityRefs: [],
        beforeSnapshot: {}, caseDetail: {}, idempotencyKey: `EXECUTE_ALWAYS_FAIL_TYPE:${hostel.id}`,
      }),
      computeImpact: async () => ({ balanceChanges: [], obligationChanges: [], ledgerEntries: [], affectedReports: [], notifications: [], warnings: [] }),
      execute: async () => { throw new Error('always fails'); },
      affectedEntities: () => [],
    });

    const kase = await recoveryService.createCase('EXECUTE_ALWAYS_FAIL_TYPE', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x', input: {},
    });
    await recoveryService.preview(kase.id);
    await recoveryService.validate(kase.id);

    await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    await expect(
      recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' })
    ).rejects.toThrow(/exceeded maximum retry attempts/i);
  });
});
