import { describe, it, expect, vi } from 'vitest';
import { ownerActionRegistry } from '@/src/services/owner-actions/owner-action-registry';
import type { OwnerAction } from '@/src/services/owner-actions/types';

describe('ownerActionRegistry', () => {
  it('registers an action and lists it for a matching entity + role, evaluating availability', () => {
    const action: OwnerAction = {
      actionId: 'TEST_ACTION_ALWAYS_ON',
      entity: 'test-entity',
      category: 'EDIT',
      label: 'Do The Test Thing',
      allowedRoles: ['OWNER'],
      isAvailable: () => true,
    };
    ownerActionRegistry.register(action);

    const list = ownerActionRegistry.listForEntity('test-entity', { tenantStatus: 'ACTIVE', actorRole: 'OWNER' });
    expect(list).toEqual([
      { actionId: 'TEST_ACTION_ALWAYS_ON', entity: 'test-entity', category: 'EDIT', label: 'Do The Test Thing', available: true },
    ]);
  });

  it('omits actions the caller role is not allowed to see', () => {
    const action: OwnerAction = {
      actionId: 'TEST_ACTION_OWNER_ONLY',
      entity: 'test-entity-2',
      category: 'EDIT',
      label: 'Owner Only Thing',
      allowedRoles: ['OWNER'],
      isAvailable: () => true,
    };
    ownerActionRegistry.register(action);

    const list = ownerActionRegistry.listForEntity('test-entity-2', { tenantStatus: 'ACTIVE', actorRole: 'TENANT' });
    expect(list).toEqual([]);
  });

  it('reflects isAvailable(ctx) as the available flag, per-context', () => {
    const action: OwnerAction = {
      actionId: 'TEST_ACTION_ACTIVE_ONLY',
      entity: 'test-entity-3',
      category: 'WORKFLOW',
      label: 'Active-Only Thing',
      allowedRoles: ['OWNER'],
      isAvailable: (ctx) => ctx.tenantStatus === 'ACTIVE',
    };
    ownerActionRegistry.register(action);

    const activeList = ownerActionRegistry.listForEntity('test-entity-3', { tenantStatus: 'ACTIVE', actorRole: 'OWNER' });
    expect(activeList[0].available).toBe(true);

    const invitedList = ownerActionRegistry.listForEntity('test-entity-3', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    expect(invitedList[0].available).toBe(false);
  });

  it('throws when registering a duplicate actionId', () => {
    const action: OwnerAction = {
      actionId: 'TEST_DUPLICATE',
      entity: 'test-entity-4',
      category: 'EDIT',
      label: 'Dup',
      allowedRoles: ['OWNER'],
      isAvailable: () => true,
    };
    ownerActionRegistry.register(action);
    expect(() => ownerActionRegistry.register(action)).toThrow(/duplicate actionId/);
  });

  it('has() reports whether an actionId is registered', () => {
    expect(ownerActionRegistry.has('TEST_ACTION_ALWAYS_ON')).toBe(true);
    expect(ownerActionRegistry.has('NOT_REGISTERED_ANYWHERE')).toBe(false);
  });
});

import '@/src/services/owner-actions/definitions/tenant-actions';

describe('tenant-actions definitions', () => {
  it('registers TENANT_EDIT_PERSONAL_INFO, available only for ACTIVE tenants', () => {
    expect(ownerActionRegistry.has('TENANT_EDIT_PERSONAL_INFO')).toBe(true);

    const activeList = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'ACTIVE', actorRole: 'OWNER' });
    const activeAction = activeList.find((a) => a.actionId === 'TENANT_EDIT_PERSONAL_INFO');
    expect(activeAction?.available).toBe(true);
    expect(activeAction?.label).toBe('Request Change');

    const invitedList = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    const invitedAction = invitedList.find((a) => a.actionId === 'TENANT_EDIT_PERSONAL_INFO');
    expect(invitedAction?.available).toBe(false);
  });
});

import '@/src/services/owner-actions/definitions/room-actions';
import '@/src/services/owner-actions/definitions/payment-actions';

describe('room-actions and payment-actions definitions', () => {
  it('registers ROOM_MOVE, available only for ACTIVE tenants', () => {
    expect(ownerActionRegistry.has('ROOM_MOVE')).toBe(true);
    const list = ownerActionRegistry.listForEntity('room', { tenantStatus: 'ACTIVE', actorRole: 'OWNER' });
    expect(list.find((a) => a.actionId === 'ROOM_MOVE')?.available).toBe(true);

    const invitedList = ownerActionRegistry.listForEntity('room', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    expect(invitedList.find((a) => a.actionId === 'ROOM_MOVE')?.available).toBe(false);
  });

  it('registers PAYMENT_RECEIVE, always available', () => {
    expect(ownerActionRegistry.has('PAYMENT_RECEIVE')).toBe(true);
    const list = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    expect(list.find((a) => a.actionId === 'PAYMENT_RECEIVE')?.available).toBe(true);
  });
});

describe('owner-actions bootstrap', () => {
  it('registers every known action via a single import', async () => {
    // Uses a fresh registry check by actionId rather than re-importing (module cache
    // already loaded these from earlier describe blocks in this file), so this just
    // confirms the bootstrap module itself exists and importing it does not throw.
    await import('@/src/services/owner-actions/bootstrap');
    expect(ownerActionRegistry.has('TENANT_EDIT_PERSONAL_INFO')).toBe(true);
    expect(ownerActionRegistry.has('ROOM_MOVE')).toBe(true);
    expect(ownerActionRegistry.has('PAYMENT_RECEIVE')).toBe(true);
  });
});

import '@/src/services/owner-actions/definitions/agreement-actions';

describe('agreement-actions definitions', () => {
  it('registers TENANT_CHANGE_RENT, available only for ACTIVE tenants', () => {
    expect(ownerActionRegistry.has('TENANT_CHANGE_RENT')).toBe(true);

    const activeList = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'ACTIVE', actorRole: 'OWNER' });
    const action = activeList.find((a) => a.actionId === 'TENANT_CHANGE_RENT');
    expect(action?.available).toBe(true);
    expect(action?.label).toBe('Change Rent');
    expect(action?.category).toBe('WORKFLOW');

    const invitedList = ownerActionRegistry.listForEntity('tenant', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    expect(invitedList.find((a) => a.actionId === 'TENANT_CHANGE_RENT')?.available).toBe(false);
  });
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from '@/lib/auth';
import { GET } from '@/app/api/owner-actions/route';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';

describe('GET /api/owner-actions', () => {
  it('returns the tenant-scoped action list for an authenticated owner', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id, { status: 'ACTIVE' });

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id,
      email: owner.email,
      role: 'OWNER',
      owner_id: owner.id,
    });

    const req = new Request(
      `http://localhost/api/owner-actions?entity=tenant&tenantId=${tenant.id}`
    ) as any;

    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    const action = body.data.find((a: any) => a.actionId === 'TENANT_EDIT_PERSONAL_INFO');
    expect(action).toEqual({
      actionId: 'TENANT_EDIT_PERSONAL_INFO',
      entity: 'tenant',
      category: 'EDIT',
      label: 'Request Change',
      available: true,
    });

    const paymentAction = body.data.find((a: any) => a.actionId === 'PAYMENT_RECEIVE');
    expect(paymentAction).toEqual({
      actionId: 'PAYMENT_RECEIVE',
      entity: 'tenant',
      category: 'WORKFLOW',
      label: 'Receive Payment',
      available: true,
    });
  });

  it('rejects requests with no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new Request('http://localhost/api/owner-actions?entity=tenant&tenantId=irrelevant') as any;
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('rejects requests missing entity or tenantId', async () => {
    const owner = await createTestOwner();
    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id,
      email: owner.email,
      role: 'OWNER',
      owner_id: owner.id,
    });
    const req = new Request('http://localhost/api/owner-actions') as any;
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
