# Owner Action Registry — Phase 1 Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a read-only `OwnerAction`/`OwnerActionRegistry` catalog layer (self-registering, mirroring the existing `correction-registry.ts` pattern) that lists which owner-facing actions are available for a tenant, and wire the Tenant Details page's "Request Change"/"Edit Details" button and the "Receive Payment" button to read their label from this catalog — with zero change to how any existing action actually executes.

**Architecture:** A new bounded context `backend-next/src/services/owner-actions/` holds a typed, in-memory registry (`OwnerAction[]` per `entity`), populated by self-registering definition files (one per domain), exposed read-only via `GET /api/owner-actions`. The frontend adds one hook (`useOwnerActions`) that fetches this list and passes derived `label`/`isAvailable` values as props into existing components — no existing mutation, endpoint, or component behavior changes. This is catalog-only per explicit product decision: `CORRECTION`-category actions (Payment Reverse/Transfer, Expense Void) will become real execution entry points through this same registry in a later plan, once those handlers exist; `EDIT`/`WORKFLOW` actions registered here stay pass-through metadata only.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres (`backend-next/`); Vite + React 19 + TanStack Query (`frontend-v2/`); Vitest against real Postgres (`fileParallelism: false`).

## Global Constraints

- This is a **catalog-only** layer per explicit product decision: no existing action's execution path (PUT `/api/tenants/[id]`, room allocation shift, payment recording) is modified in this plan. Only labels/visibility flags are sourced from the new registry.
- Every new backend route resolves the caller via `getSession(req)` + reuses `tenantService.getTenantById` for tenant lookup/ownership scoping — no new raw Prisma tenant query, no new authorization logic (`CLAUDE.md`: never re-derive `hostelId`/ownership scoping ad hoc).
- All new frontend code imports `api` from `@lib/api-client` — never raw `fetch()`/`axios` (enforced by `frontend-v2/scripts/check-architecture.mjs`, runs on `npm run build`).
- Test files go in `backend-next/tests/integration/*.test.ts`, run via `npx vitest run tests/integration/<file>.test.ts` from `backend-next/`, using existing factories (`tests/factories/*.ts`).
- `OwnerAction`'s `allowedRoles` field must exist on every action from day one (permission seam for future non-owner roles) even though Phase 1 only ever contains `["OWNER"]` and no enforcement beyond today's `resolveOwnerScope`/session role check is added.

---

## File Structure

```
backend-next/
  src/services/owner-actions/
    types.ts                        [create]
    owner-action-registry.ts        [create]
    definitions/
      tenant-actions.ts             [create]
      room-actions.ts               [create]
      payment-actions.ts            [create]
    bootstrap.ts                    [create]
  app/api/owner-actions/route.ts    [create]
  tests/integration/owner-actions.test.ts  [create]

frontend-v2/
  src/lib/queryKeys.ts                                        [modify]
  src/features/owner-actions/api/index.ts                     [create]
  src/features/owner-actions/hooks/useOwnerActions.ts         [create]
  src/features/tenants/components/profile/TenantProfilePage.tsx      [modify]
  src/features/tenants/components/financial/PrimaryActionsBar.tsx    [modify]
```

---

### Task 1: Core `OwnerAction` types

**Files:**
- Create: `backend-next/src/services/owner-actions/types.ts`

**Interfaces:**
- Produces: `OwnerActionCategory`, `OwnerActionContext`, `OwnerAction`, `OwnerActionSummary` — every later task imports from this file.

- [ ] **Step 1: Write the file (no test — pure type definitions, verified by Task 2's tests importing them)**

```ts
// backend-next/src/services/owner-actions/types.ts

export type OwnerActionCategory = "EDIT" | "WORKFLOW" | "CORRECTION" | "VIEW";

export interface OwnerActionContext {
  tenantStatus: string; // matches prisma TenantStatus enum values: INVITED | ACTIVE | FORMER_TENANT | EXPIRED | CANCELLED
  actorRole: string;    // session.role, e.g. "OWNER"
}

export interface OwnerAction {
  actionId: string;             // unique, e.g. "TENANT_EDIT_PERSONAL_INFO"
  entity: string;                // "tenant" | "room" | "payment" | ... (open-ended, no enum — new domains add new strings)
  category: OwnerActionCategory;
  label: string;                 // owner-facing button text
  allowedRoles: string[];        // permission seam; Phase 1 always ["OWNER"], not enforced beyond session.role check
  isAvailable(ctx: OwnerActionContext): boolean; // cheap, synchronous, pure predicate
}

// What the API route returns to the frontend — isAvailable is already evaluated server-side
export interface OwnerActionSummary {
  actionId: string;
  entity: string;
  category: OwnerActionCategory;
  label: string;
  available: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend-next/src/services/owner-actions/types.ts
git commit -m "feat(owner-actions): add core OwnerAction/OwnerActionContext types"
```

---

### Task 2: `OwnerActionRegistry`

**Files:**
- Create: `backend-next/src/services/owner-actions/owner-action-registry.ts`
- Test: `backend-next/tests/integration/owner-actions.test.ts`

**Interfaces:**
- Consumes: `OwnerAction`, `OwnerActionContext` from `./types`.
- Produces: `ownerActionRegistry.register(action: OwnerAction): void`, `ownerActionRegistry.listForEntity(entity: string, ctx: OwnerActionContext): OwnerActionSummary[]`, `ownerActionRegistry.has(actionId: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// backend-next/tests/integration/owner-actions.test.ts
import { describe, it, expect } from 'vitest';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: FAIL with "Cannot find module '@/src/services/owner-actions/owner-action-registry'".

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/owner-actions/owner-action-registry.ts
import type { OwnerAction, OwnerActionContext, OwnerActionSummary } from "./types";

class OwnerActionRegistry {
  private actions = new Map<string, OwnerAction>();

  register(action: OwnerAction): void {
    if (this.actions.has(action.actionId)) {
      throw new Error(`duplicate actionId registration: ${action.actionId}`);
    }
    this.actions.set(action.actionId, action);
  }

  has(actionId: string): boolean {
    return this.actions.has(actionId);
  }

  listForEntity(entity: string, ctx: OwnerActionContext): OwnerActionSummary[] {
    const result: OwnerActionSummary[] = [];
    for (const action of this.actions.values()) {
      if (action.entity !== entity) continue;
      if (!action.allowedRoles.includes(ctx.actorRole)) continue;
      result.push({
        actionId: action.actionId,
        entity: action.entity,
        category: action.category,
        label: action.label,
        available: action.isAvailable(ctx),
      });
    }
    return result;
  }
}

export const ownerActionRegistry = new OwnerActionRegistry();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/owner-actions/owner-action-registry.ts backend-next/tests/integration/owner-actions.test.ts
git commit -m "feat(owner-actions): add self-registering OwnerActionRegistry"
```

---

### Task 3: Tenant personal-info action definition

**Files:**
- Create: `backend-next/src/services/owner-actions/definitions/tenant-actions.ts`
- Test: `backend-next/tests/integration/owner-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `ownerActionRegistry` (Task 2).
- Produces: registers `actionId: "TENANT_EDIT_PERSONAL_INFO"`, `entity: "tenant"` — available whenever `tenantStatus === "ACTIVE"` (matches the existing `status.toUpperCase() === 'ACTIVE'` conditional in `TenantProfilePage.tsx` that currently shows "Request Change" vs. "Edit Details").

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/owner-actions.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/owner-actions/definitions/tenant-actions.ts
import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "TENANT_EDIT_PERSONAL_INFO",
  entity: "tenant",
  category: "EDIT",
  label: "Request Change",
  allowedRoles: ["OWNER"],
  isAvailable: (ctx) => ctx.tenantStatus === "ACTIVE",
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: PASS, 6 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/owner-actions/definitions/tenant-actions.ts backend-next/tests/integration/owner-actions.test.ts
git commit -m "feat(owner-actions): register TENANT_EDIT_PERSONAL_INFO action"
```

---

### Task 4: Room-move and payment-receive action definitions

**Files:**
- Create: `backend-next/src/services/owner-actions/definitions/room-actions.ts`
- Create: `backend-next/src/services/owner-actions/definitions/payment-actions.ts`
- Test: `backend-next/tests/integration/owner-actions.test.ts` (extend)

**Interfaces:**
- Produces: `actionId: "ROOM_MOVE"` (`entity: "room"`, available whenever `tenantStatus === "ACTIVE"`), `actionId: "PAYMENT_RECEIVE"` (`entity: "payment"`, always available — payments can be recorded regardless of tenant status).

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/owner-actions.test.ts`:
```ts
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
    const list = ownerActionRegistry.listForEntity('payment', { tenantStatus: 'INVITED', actorRole: 'OWNER' });
    expect(list.find((a) => a.actionId === 'PAYMENT_RECEIVE')?.available).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/owner-actions/definitions/room-actions.ts
import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "ROOM_MOVE",
  entity: "room",
  category: "WORKFLOW",
  label: "Move Room",
  allowedRoles: ["OWNER"],
  isAvailable: (ctx) => ctx.tenantStatus === "ACTIVE",
});
```

```ts
// backend-next/src/services/owner-actions/definitions/payment-actions.ts
import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "PAYMENT_RECEIVE",
  entity: "payment",
  category: "WORKFLOW",
  label: "Receive Payment",
  allowedRoles: ["OWNER"],
  isAvailable: () => true,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: PASS, 8 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/owner-actions/definitions/room-actions.ts backend-next/src/services/owner-actions/definitions/payment-actions.ts backend-next/tests/integration/owner-actions.test.ts
git commit -m "feat(owner-actions): register ROOM_MOVE and PAYMENT_RECEIVE actions"
```

---

### Task 5: Bootstrap wiring

**Files:**
- Create: `backend-next/src/services/owner-actions/bootstrap.ts`
- Test: `backend-next/tests/integration/owner-actions.test.ts` (extend)

**Interfaces:**
- Produces: importing `./bootstrap` (for side effects only) registers all three actions without the importer needing to know their file paths — mirrors `src/services/recovery/bootstrap.ts`'s existing convention.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/owner-actions.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: FAIL — `bootstrap` module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/owner-actions/bootstrap.ts
import "./definitions/tenant-actions";
import "./definitions/room-actions";
import "./definitions/payment-actions";
// Future domains (Payment Correct, Expense Void, Room Swap, Document Replace, KYC Reverify)
// add one import line here as their action definitions are written — no other file changes.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: PASS, 9 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/owner-actions/bootstrap.ts backend-next/tests/integration/owner-actions.test.ts
git commit -m "feat(owner-actions): add bootstrap side-effect import for all action definitions"
```

---

### Task 6: `GET /api/owner-actions` route

**Files:**
- Create: `backend-next/app/api/owner-actions/route.ts`
- Test: `backend-next/tests/integration/owner-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `getSession` (`@/lib/auth`), `tenantService.getTenantById` (`@/src/services/tenants/tenant-service`, already used identically in `app/api/tenants/[id]/route.ts`'s `GET` handler), `ownerActionRegistry` + bootstrap (Task 5).
- Produces: `GET /api/owner-actions?entity=tenant&tenantId=<id>` → `{ success: true, data: OwnerActionSummary[] }` (via `ApiResponse.success`), 401 if unauthenticated, 400 if `entity`/`tenantId` missing, 404/403 propagated from `tenantService.getTenantById`.

- [ ] **Step 1: Write the failing test**

`getSession` (`@/lib/auth`, re-exported from `lib/auth-edge.ts`) has no existing integration-test mocking precedent in this repo — the closest precedent is `tests/integration/payments.test.ts:3-11`, which `vi.mock`s the *different* `authService.getCurrentUser` auth path used by other routes. This route uses `getSession`, so mock that module directly, following the same `vi.mock` shape:

```ts
// backend-next/tests/integration/owner-actions.test.ts (extend)
import { vi } from 'vitest';

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
```

**Note for the implementer:** confirm `createTestOwner()`'s return shape includes `email` (`grep -n "email" tests/factories/owner-factory.ts`) before writing the mocked `AuthPayload` objects above — adjust the field source if it's named differently.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/app/api/owner-actions/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { ownerActionRegistry } from "@/src/services/owner-actions/owner-action-registry";
import "@/src/services/owner-actions/bootstrap";

/**
 * GET /api/owner-actions?entity=tenant&tenantId=<id>
 * Read-only catalog of owner-facing actions available for the given entity.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity");
  const tenantId = searchParams.get("tenantId");

  if (!entity || !tenantId) {
    return ApiResponse.error(ApiError.badRequest("entity and tenantId are required"));
  }

  try {
    const tenant = await tenantService.getTenantById(tenantId, { sub: session.sub, role: session.role });
    const list = ownerActionRegistry.listForEntity(entity, {
      tenantStatus: tenant.status,
      actorRole: session.role,
    });
    return ApiResponse.success(list);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.internal("Internal Server Error"));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/owner-actions.test.ts -v`
Expected: PASS, 12 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/app/api/owner-actions/route.ts backend-next/tests/integration/owner-actions.test.ts
git commit -m "feat(owner-actions): add GET /api/owner-actions catalog route"
```

---

### Task 7: Frontend `ownerActionsService` + query key

**Files:**
- Create: `frontend-v2/src/features/owner-actions/api/index.ts`
- Modify: `frontend-v2/src/lib/queryKeys.ts`

**Interfaces:**
- Produces: `ownerActionsService.listForTenant(tenantId: string): Promise<OwnerActionSummary[]>`; `queryKeys.ownerActions.tenant(hostelId, tenantId)`.

- [ ] **Step 1: Add the query key**

In `frontend-v2/src/lib/queryKeys.ts`, inside the `tenants: { ... }` object (after the existing `financialTimeline` entry), add:
```ts
    ownerActions: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'owner-actions'),
```

- [ ] **Step 2: Write the API wrapper**

```ts
// frontend-v2/src/features/owner-actions/api/index.ts
import api from '@lib/api-client';

export interface OwnerActionSummary {
  actionId: string;
  entity: string;
  category: 'EDIT' | 'WORKFLOW' | 'CORRECTION' | 'VIEW';
  label: string;
  available: boolean;
}

const unwrap = (response: any) => {
  if (response.data?.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
};

export const ownerActionsService = {
  listForTenant: async (tenantId: string): Promise<OwnerActionSummary[]> => {
    const response = await api.get('/owner-actions', { params: { entity: 'tenant', tenantId } });
    return unwrap(response);
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend-v2/src/lib/queryKeys.ts frontend-v2/src/features/owner-actions/api/index.ts
git commit -m "feat(owner-actions): add ownerActionsService API wrapper and query key"
```

---

### Task 8: `useOwnerActions` hook

**Files:**
- Create: `frontend-v2/src/features/owner-actions/hooks/useOwnerActions.ts`

**Interfaces:**
- Consumes: `ownerActionsService.listForTenant` (Task 7), `queryKeys.tenants.ownerActions` (Task 7).
- Produces: `useOwnerActions(hostelId: string | undefined, tenantId: string | undefined): { actions: OwnerActionSummary[]; findAction: (actionId: string) => OwnerActionSummary | undefined }`.

- [ ] **Step 1: Implement**

```ts
// frontend-v2/src/features/owner-actions/hooks/useOwnerActions.ts
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { ownerActionsService, type OwnerActionSummary } from '@features/owner-actions/api';

export function useOwnerActions(hostelId: string | undefined, tenantId: string | undefined) {
  const { data } = useQuery({
    queryKey: hostelId && tenantId ? queryKeys.tenants.ownerActions(hostelId, tenantId) : ['__noop__'],
    queryFn: () => ownerActionsService.listForTenant(tenantId as string),
    enabled: Boolean(hostelId && tenantId),
  });

  const actions: OwnerActionSummary[] = data ?? [];

  const findAction = (actionId: string) => actions.find((a) => a.actionId === actionId);

  return { actions, findAction };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend-v2/src/features/owner-actions/hooks/useOwnerActions.ts
git commit -m "feat(owner-actions): add useOwnerActions hook"
```

---

### Task 9: Wire `TENANT_EDIT_PERSONAL_INFO` into the Core Action Dashboard button

**Files:**
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Consumes: `useOwnerActions` (Task 8).

- [ ] **Step 1: Add the hook call and derive the button label**

In `TenantProfilePage.tsx`, add the import near the other `@features/tenants` imports:
```ts
import { useOwnerActions } from '@features/owner-actions/hooks/useOwnerActions';
```

Inside the component body (near where `status`, `hostelId`, and `tenantId`/`id` are already available from existing hooks/params), add:
```ts
const { findAction } = useOwnerActions(hostelId, id);
const personalInfoAction = findAction('TENANT_EDIT_PERSONAL_INFO');
```

- [ ] **Step 2: Replace the hardcoded label with the registry-sourced one**

Find the existing block (currently rendering the static text `"Request Change"`):
```tsx
              {status.toUpperCase() === 'ACTIVE' ? (
                <button
                  type="button"
                  onClick={() => setShowChangeDrawer(true)}
                  className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4.5 py-3 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 active:scale-95 transition-all border border-border"
                >
                  <FileCheck2 className="w-4 h-4 text-accent" />
                  <span>Request Change</span>
                </button>
              ) : (
```

Replace only the `<span>` text with the derived label (fallback preserves current behavior if the catalog hasn't loaded yet):
```tsx
                  <span>{personalInfoAction?.label ?? 'Request Change'}</span>
```

The `status.toUpperCase() === 'ACTIVE'` visibility condition and the `onClick={() => setShowChangeDrawer(true)}` behavior are unchanged — only the label text now comes from the catalog, proving the wiring without touching behavior.

- [ ] **Step 3: Manually verify in the dev server**

Run `npm run dev` from `frontend-v2/`, open an ACTIVE tenant's profile page, confirm the "Request Change" button still opens `ChangeRequestDrawer` exactly as before, and confirm in the Network tab that `GET /api/owner-actions?entity=tenant&tenantId=...` is called and returns `TENANT_EDIT_PERSONAL_INFO` with `available: true`.

- [ ] **Step 4: Commit**

```bash
git add frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(owner-actions): wire Core Action Dashboard button label to OwnerActionRegistry"
```

---

### Task 10: Wire `PAYMENT_RECEIVE` label into `PrimaryActionsBar`

**Files:**
- Modify: `frontend-v2/src/features/tenants/components/financial/PrimaryActionsBar.tsx`
- Modify: `frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx`

**Interfaces:**
- Consumes: `personalInfoAction`/`findAction` already available in `TenantProfilePage.tsx` from Task 9.

- [ ] **Step 1: Add an optional `receiveLabel` prop to `PrimaryActionsBar`**

In `PrimaryActionsBar.tsx`, update the props interface and the `actions` array:
```tsx
interface PrimaryActionsBarProps {
  tenantId: string;
  onReceivePayment: () => void;
  onCreateCharge: () => void;
  onCreateRent: () => void;
  onViewReceipts: () => void;
  receiveLabel?: string;
}

export function PrimaryActionsBar({
  tenantId,
  onReceivePayment,
  onCreateCharge,
  onCreateRent,
  onViewReceipts,
  receiveLabel = 'Receive Payment',
}: PrimaryActionsBarProps) {
```

Update the `actions` array's first entry:
```tsx
  const actions: PrimaryAction[] = [
    { key: 'receive', label: receiveLabel, icon: IndianRupee, onClick: onReceivePayment, emphasis: true },
```

- [ ] **Step 2: Pass the catalog-derived label from `TenantProfilePage.tsx`**

Where `<PrimaryActionsBar ... />` is rendered in `TenantProfilePage.tsx`, add:
```tsx
              receiveLabel={findAction('PAYMENT_RECEIVE')?.label}
```

(Passing `undefined` when the catalog hasn't loaded yet falls back to `PrimaryActionsBar`'s own default `'Receive Payment'`, so behavior is unchanged either way.)

- [ ] **Step 3: Manually verify in the dev server**

Confirm the "Receive Payment" button still opens the existing payment flow unchanged, and its label still reads "Receive Payment" (sourced from the catalog now, not hardcoded).

- [ ] **Step 4: Commit**

```bash
git add frontend-v2/src/features/tenants/components/financial/PrimaryActionsBar.tsx frontend-v2/src/features/tenants/components/profile/TenantProfilePage.tsx
git commit -m "feat(owner-actions): wire PrimaryActionsBar Receive Payment label to OwnerActionRegistry"
```

---

## Explicitly out of scope for this plan

- `ROOM_MOVE`'s three render points inside `AllocationHistoryTimeline.tsx` are **not** wired to the catalog in this plan — that component's visibility branching already encodes real allocation-state rules (distinct from the simple ACTIVE/INVITED check used here) and touching it belongs in a follow-up once this label-only wiring pattern has been validated in production, not bundled into the same slice as introducing the registry itself.
- No `CORRECTION`-category action is registered yet (Payment Reverse/Transfer/Edit Reference, Expense Void) — those resume `docs/superpowers/plans/2026-07-20-business-recovery-platform-phase1.md` from Task 8, and get their own registry entries (with real `resolve()`-style dispatch, since correction actions *do* execute through the platform) in a follow-up plan once those handlers exist.
- No enforcement beyond `allowedRoles.includes(session.role)` (today only ever `"OWNER"`) — no `PermissionService`, no non-owner roles exist yet.

## Self-Review

1. **Spec coverage**: types (Task 1), registry (Task 2), three action definitions matching the approved Owner Action Matrix's already-existing rows (Tasks 3-4), bootstrap (Task 5), API route (Task 6), frontend service/hook (Tasks 7-8), two real wiring demonstrations (Tasks 9-10) — covers everything committed to for this slice; Room Move UI wiring and Correction-category actions are explicitly deferred above, not silently dropped.
2. **Placeholder scan**: no remaining placeholders — Task 6's auth mocking was initially flagged as unconfirmed, then resolved against the real `getSession`/`AuthPayload` shape in `lib/auth-edge.ts` and the existing `vi.mock` precedent in `tests/integration/payments.test.ts`; `ApiError.badRequest` was confirmed to already exist in `src/lib/api-error.ts` rather than assumed.
3. **Type consistency**: `OwnerActionSummary` (Task 1) is used identically in the registry (Task 2), the route response (Task 6), and the frontend type (Task 7) — same four fields plus `available`, no drift.
