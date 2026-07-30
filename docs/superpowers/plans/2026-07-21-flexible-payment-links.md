# Flexible Payment Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Share Payment Link" work for any tenant (not just ones with outstanding dues) and let the payer enter any amount, by extending the existing offline FIFO settlement engine (`buildSettlementPlan`) to the online/Razorpay payment-link path instead of requiring a pre-picked obligation.

**Architecture:** `payment_link_tokens.obligation_id` becomes an optional hint instead of a hard lock. A new amount-first intent-creation function (`createAmountPaymentIntent`) mirrors the existing `createMultiObligationPaymentIntent` but computes its obligation allocation via `buildSettlementPlan` from a payer-entered amount instead of a pre-picked obligation list — reusing the exact same finalization code path (`financialPaymentFacade.receivePayment` → `executePlanInTx`) with zero changes there. The payer-facing page gains an editable amount field with a live server-computed breakdown.

**Tech Stack:** Next.js 14 App Router (backend-next), Prisma/Postgres, Razorpay, React 19 + Vite (frontend-v2), Vitest.

## Global Constraints

- Money is paise-precise; obligations remain the audit-first source of truth for money owed — never synthesize a `rent_obligations` row to represent an arbitrary paid amount.
- `npm run check:financial-safety`'s `NO_OBLIGATION_OVERPAYMENT` check must keep passing — it is the regression gate for any allocation bug in this feature.
- Backend tests run against a real Postgres (`backend-next/.env.test`, `fileParallelism: false`) — use the factories in `backend-next/tests/factories/` for setup, matching the style of `backend-next/tests/integration/payment-link-service.test.ts` and `backend-next/tests/settlement-preview-entry-points.test.ts`.
- Prisma schema changes go through `npx prisma migrate dev --name <description>` under `backend-next/prisma/migrations/` — the root `migrations/` and `backend-next/prisma/migrations_manual/` directories are both archived/dead, do not add files there.
- Per `CLAUDE.md`'s Documentation Rules, this is a business-rule change requiring updates to `docs/obsidian/Business-Rules.md`, `APIs.md`, `Database.md`, `Features.md`, `Changelog.md`, and a new ADR in `Decisions.md` (Task 10) — done in the same body of work, not as a follow-up.
- Full spec: `docs/superpowers/specs/2026-07-21-flexible-payment-links-design.md`.

---

## File Structure

```
backend-next/
  prisma/schema.prisma                                    [modify — Task 1]
  prisma/migrations/<timestamp>_make_payment_link_obligation_optional/migration.sql  [create — Task 1]
  src/services/payments/payment-link-service.ts            [modify — Task 2]
  app/api/payments/pay-link/route.ts                       [modify — Task 3]
  app/api/payments/pay/[token]/route.ts                    [modify — Tasks 4, 6, 7]
  src/services/payments/payment-service.ts                 [modify — Task 5]
  tests/integration/payment-link-service.test.ts            [modify — Task 2]
  tests/pay-link-tenant-auth.test.ts                        [create — Task 3]
  tests/payment-link-flow.test.ts                            [modify — Tasks 4, 6]
  tests/integration/amount-payment-intent.test.ts            [create — Task 5]

frontend-v2/
  src/features/tenants/components/list/TenantCardMoreSheet.tsx   [modify — Task 8]
  src/features/tenants/components/financial/DocumentsHub.tsx     [modify — Task 8]
  src/portal/pages/TenantFinancialsPage.tsx                       [modify — Task 9]

docs/obsidian/
  Business-Rules.md, APIs.md, Database.md, Features.md, Changelog.md, Decisions.md   [modify — Task 10]
```

---

### Task 1: Migration — `payment_link_tokens.obligation_id` becomes optional

**Files:**
- Modify: `backend-next/prisma/schema.prisma:2149-2165`
- Create: `backend-next/prisma/migrations/<timestamp>_make_payment_link_obligation_optional/migration.sql`
- Test: `backend-next/tests/integration/payment-link-tokens-schema.test.ts`

**Interfaces:**
- Produces: `payment_link_tokens.obligation_id: string | null`, `payment_link_tokens.rent_obligations: RentObligation | null` on the generated Prisma client — every later task that reads `linkToken.rent_obligations`/`linkToken.obligation_id` must null-check.

- [ ] **Step 1: Write the failing test**

Create `backend-next/tests/integration/payment-link-tokens-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';

describe('payment_link_tokens schema — obligation_id optional', () => {
  it('creates a token with no obligation_id', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const created = await prisma.payment_link_tokens.create({
      data: {
        tenant_id: tenant.id,
        hostel_id: hostel.id,
        owner_id: owner.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    expect(created.obligation_id).toBeNull();

    const found = await prisma.payment_link_tokens.findUnique({
      where: { token: created.token },
      include: { rent_obligations: true },
    });
    expect(found?.rent_obligations).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/integration/payment-link-tokens-schema.test.ts -t "creates a token with no obligation_id"`
Expected: FAIL — Prisma error, `obligation_id` violates not-null constraint (or a TypeScript error if the client is regenerated first; if so, run with `--no-check` or expect a Prisma runtime error either way).

- [ ] **Step 3: Edit `schema.prisma`**

In `backend-next/prisma/schema.prisma`, replace lines 2149-2165:

```prisma
model payment_link_tokens {
  token            String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  obligation_id    String             @db.Uuid
  tenant_id        String             @db.Uuid
  hostel_id        String             @db.Uuid
  owner_id         String             @db.Uuid
  expires_at       DateTime           @db.Timestamptz(6)
  created_at       DateTime           @default(now()) @db.Timestamptz(6)

  rent_obligations rent_obligations   @relation(fields: [obligation_id], references: [id])
  tenants          tenants            @relation(fields: [tenant_id], references: [id])
  hostels          hostels            @relation(fields: [hostel_id], references: [id])

  @@index([obligation_id])
  @@index([tenant_id])
  @@index([expires_at])
}
```

with:

```prisma
model payment_link_tokens {
  token            String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  obligation_id    String?            @db.Uuid
  tenant_id        String             @db.Uuid
  hostel_id        String             @db.Uuid
  owner_id         String             @db.Uuid
  expires_at       DateTime           @db.Timestamptz(6)
  created_at       DateTime           @default(now()) @db.Timestamptz(6)

  rent_obligations rent_obligations?  @relation(fields: [obligation_id], references: [id])
  tenants          tenants            @relation(fields: [tenant_id], references: [id])
  hostels          hostels            @relation(fields: [hostel_id], references: [id])

  @@index([obligation_id])
  @@index([tenant_id])
  @@index([expires_at])
}
```

- [ ] **Step 4: Generate the migration**

Run: `cd backend-next && npx prisma migrate dev --name make_payment_link_obligation_optional`
Expected: Prisma detects the nullability change and generates a new folder under `backend-next/prisma/migrations/` containing `migration.sql` with `ALTER TABLE "payment_link_tokens" ALTER COLUMN "obligation_id" DROP NOT NULL;` (matching the convention in `20260604000000_make_expense_hostel_id_optional/migration.sql`). It applies automatically to your local dev DB and regenerates the Prisma client.

- [ ] **Step 5: Apply the same migration to the test database**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx prisma migrate deploy`
Expected: the new migration applies to the `test` schema used by `.env.test`'s `DATABASE_URL_TEST`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/integration/payment-link-tokens-schema.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd backend-next
git add prisma/schema.prisma prisma/migrations tests/integration/payment-link-tokens-schema.test.ts
git commit -m "feat(payments): make payment_link_tokens.obligation_id optional

Obligation is now an optional default-amount hint rather than a hard
lock, enabling tenant-scoped (not obligation-scoped) payment links."
```

---

### Task 2: `PaymentLinkService.getOrCreateToken` — drop the outstanding-obligation requirement

**Files:**
- Modify: `backend-next/src/services/payments/payment-link-service.ts` (full file, 105 lines)
- Test: `backend-next/tests/integration/payment-link-service.test.ts`

**Interfaces:**
- Consumes: `prisma.payment_link_tokens`, `prisma.rent_obligations` (Prisma client, post-Task-1 nullable `obligation_id`).
- Produces: `PaymentLinkService.getOrCreateToken(params: { obligationId?: string; tenantId?: string }): Promise<{ token: string; expiresAt: Date }>` — same signature as before, but `tenantId` alone with zero outstanding obligations now succeeds instead of throwing.

- [ ] **Step 1: Write the failing test**

Add to `backend-next/tests/integration/payment-link-service.test.ts` (the file already exists with a `describe` block and the imports shown below — add this `it` inside the existing `describe`):

```ts
it('creates a tenant-scoped token even when the tenant has no outstanding obligations', async () => {
  const owner = await createTestOwner();
  const hostel = await createTestHostel(owner.id);
  const tenant = await createTestTenant(owner.id, hostel.id);
  // Deliberately no createTestObligation call — tenant has zero obligations.

  const result = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });

  const row = await prisma.payment_link_tokens.findUniqueOrThrow({ where: { token: result.token } });
  expect(row.tenant_id).toBe(tenant.id);
  expect(row.hostel_id).toBe(hostel.id);
  expect(row.obligation_id).toBeNull();
});

it('reuses an existing non-expired tenant-scoped token instead of creating a new one', async () => {
  const owner = await createTestOwner();
  const hostel = await createTestHostel(owner.id);
  const tenant = await createTestTenant(owner.id, hostel.id);

  const first = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });
  const second = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });

  expect(second.token).toBe(first.token);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/integration/payment-link-service.test.ts -t "creates a tenant-scoped token even when"`
Expected: FAIL with `Error: No outstanding rent obligations found for this tenant`

- [ ] **Step 3: Rewrite `payment-link-service.ts`**

Replace the entire file content (all 105 lines) with:

```ts
import { prisma } from "@/lib/db";

export class PaymentLinkService {
  /**
   * Finds or creates an active payment link token for a tenant.
   * `obligationId`, if provided, is stored only as a default-amount hint —
   * the payer can always pay any amount on the resulting page, FIFO-allocated
   * across whatever the tenant actually owes at payment time.
   */
  static async getOrCreateToken(params: {
    obligationId?: string;
    tenantId?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const { obligationId, tenantId } = params;

    if (!obligationId && !tenantId) {
      throw new Error("Either obligationId or tenantId must be provided");
    }

    let targetTenantId = tenantId;

    // If only an obligation was given, resolve its tenant.
    if (obligationId && !targetTenantId) {
      const obligation = await prisma.rent_obligations.findUnique({
        where: { id: obligationId },
        select: { tenant_id: true },
      });
      if (!obligation) {
        throw new Error("Obligation not found");
      }
      targetTenantId = obligation.tenant_id;
    }

    if (!targetTenantId) {
      throw new Error("Could not resolve tenant");
    }

    // Reuse an existing non-expired token for this (tenant, obligation-hint) pair.
    const existing = await prisma.payment_link_tokens.findFirst({
      where: {
        tenant_id: targetTenantId,
        obligation_id: obligationId ?? null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    });

    if (existing) {
      return {
        token: existing.token,
        expiresAt: existing.expires_at,
      };
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: targetTenantId },
      select: { hostel_id: true, owner_id: true },
    });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const created = await prisma.payment_link_tokens.create({
      data: {
        obligation_id: obligationId ?? null,
        tenant_id: targetTenantId,
        hostel_id: tenant.hostel_id,
        owner_id: tenant.owner_id,
        expires_at: expiresAt,
      },
      select: { token: true, expires_at: true },
    });

    return {
      token: created.token,
      expiresAt: created.expires_at,
    };
  }
}
```

Note: this drops the "resolve tenantId to oldest PENDING/PARTIAL obligation" step entirely, and derives `hostel_id`/`owner_id` directly from the `tenants` row instead of from the (now-optional) obligation — simpler and correct for both the hinted and unhinted case. Confirm `tenants.hostel_id` and `tenants.owner_id` are the correct field names by checking `backend-next/prisma/schema.prisma`'s `tenants` model before this step if either lookup fails at runtime.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/integration/payment-link-service.test.ts`
Expected: PASS (all tests in the file, including the pre-existing "resolves tenantId to their oldest unpaid obligation" test — check its assertions still hold; if it asserted the service resolves to an obligation automatically, update it to instead assert `obligation_id` stays null unless explicitly passed, since that auto-resolution behavior was intentionally removed)

- [ ] **Step 5: Commit**

```bash
cd backend-next
git add src/services/payments/payment-link-service.ts tests/integration/payment-link-service.test.ts
git commit -m "feat(payments): payment links no longer require an outstanding obligation

PaymentLinkService.getOrCreateToken now creates a tenant-scoped token
unconditionally; obligationId becomes an optional default-amount hint
instead of a hard resolution requirement."
```

---

### Task 3: `POST /api/payments/pay-link` — tenant self-service generation

**Files:**
- Modify: `backend-next/app/api/payments/pay-link/route.ts:16-42`
- Test: `backend-next/tests/pay-link-tenant-auth.test.ts`

**Interfaces:**
- Consumes: `getSession(req)` from `@/lib/auth` (returns `{ role: "OWNER" | "TENANT" | ...; tenant_id?: string }`, matching the pattern used elsewhere in this route file), `PaymentLinkService.getOrCreateToken` from Task 2.
- Produces: no interface change — same `POST /api/payments/pay-link` request/response shape, now also reachable by `TENANT`-role sessions.

- [ ] **Step 1: Write the failing test**

Create `backend-next/tests/pay-link-tenant-auth.test.ts`, following the mocked-route-handler style of `backend-next/tests/settlement-preview-entry-points.test.ts` (real DB via factories, only `authService`/`getSession` mocked):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant } from './factories/tenant-factory';

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from '@/lib/auth';
import { POST } from '../app/api/payments/pay-link/route';

describe('POST /api/payments/pay-link — tenant self-service', () => {
  it('lets a tenant generate a link for their own account', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    vi.mocked(getSession).mockResolvedValue({
      role: 'TENANT',
      tenant_id: tenant.id,
      owner_id: owner.id,
    } as any);

    const req = new NextRequest('http://localhost/api/payments/pay-link', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toContain('/pay/');

    const token = await prisma.payment_link_tokens.findFirst({ where: { tenant_id: tenant.id } });
    expect(token).not.toBeNull();
  });

  it('rejects a tenant trying to generate a link for a different tenant', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const otherTenant = await createTestTenant(owner.id, hostel.id);

    vi.mocked(getSession).mockResolvedValue({
      role: 'TENANT',
      tenant_id: tenant.id,
      owner_id: owner.id,
    } as any);

    const req = new NextRequest('http://localhost/api/payments/pay-link', {
      method: 'POST',
      body: JSON.stringify({ tenantId: otherTenant.id }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/pay-link-tenant-auth.test.ts`
Expected: FAIL — first test gets 403 (route currently rejects all non-OWNER sessions at line 16).

- [ ] **Step 3: Edit the route**

In `backend-next/app/api/payments/pay-link/route.ts`, replace lines 15-42:

```ts
    const session = await getSession(req);
    if (!session || session.role !== "OWNER") {
      return ApiResponse.error(ApiError.forbidden("Unauthorized"));
    }

    const scope = resolveOwnerScope(session);
    const ownerId = scope.owner_id;

    const data = await req.json().catch(() => ({}));
    const { tenantId, obligationId } = data;

    if (!tenantId && !obligationId) {
      return ApiResponse.error(ApiError.badRequest("Either tenantId or obligationId must be provided"));
    }

    // 1. Perform authorization checks
    if (tenantId) {
      const tenant = await prisma.tenants.findUnique({
        where: { id: tenantId },
        select: { owner_id: true },
      });
      if (!tenant) {
        return ApiResponse.error(ApiError.notFound("Tenant not found"));
      }
      if (tenant.owner_id !== ownerId) {
        return ApiResponse.error(ApiError.forbidden("Tenant does not belong to this owner"));
      }
    }

    if (obligationId) {
      const obligation = await prisma.rent_obligations.findUnique({
        where: { id: obligationId },
        select: { owner_id: true },
      });
      if (!obligation) {
        return ApiResponse.error(ApiError.notFound("Rent obligation not found"));
      }
      if (obligation.owner_id !== ownerId) {
        return ApiResponse.error(ApiError.forbidden("Rent obligation does not belong to this owner"));
      }
    }
```

with:

```ts
    const session = await getSession(req);
    if (!session || (session.role !== "OWNER" && session.role !== "TENANT")) {
      return ApiResponse.error(ApiError.forbidden("Unauthorized"));
    }

    const data = await req.json().catch(() => ({}));
    let { tenantId, obligationId } = data;

    if (session.role === "TENANT") {
      // Tenants may only ever generate a link for their own account.
      if ((tenantId && tenantId !== session.tenant_id) || obligationId) {
        return ApiResponse.error(ApiError.forbidden("You can only generate a payment link for your own account"));
      }
      tenantId = session.tenant_id;
      if (!tenantId) {
        return ApiResponse.error(ApiError.forbidden("No tenant account associated with this session"));
      }
    }

    if (!tenantId && !obligationId) {
      return ApiResponse.error(ApiError.badRequest("Either tenantId or obligationId must be provided"));
    }

    // 1. Perform authorization checks (owner path only — tenant path is
    // already scoped to their own tenantId above, with obligationId disallowed)
    if (session.role === "OWNER") {
      const scope = resolveOwnerScope(session);
      const ownerId = scope.owner_id;

      if (tenantId) {
        const tenant = await prisma.tenants.findUnique({
          where: { id: tenantId },
          select: { owner_id: true },
        });
        if (!tenant) {
          return ApiResponse.error(ApiError.notFound("Tenant not found"));
        }
        if (tenant.owner_id !== ownerId) {
          return ApiResponse.error(ApiError.forbidden("Tenant does not belong to this owner"));
        }
      }

      if (obligationId) {
        const obligation = await prisma.rent_obligations.findUnique({
          where: { id: obligationId },
          select: { owner_id: true },
        });
        if (!obligation) {
          return ApiResponse.error(ApiError.notFound("Rent obligation not found"));
        }
        if (obligation.owner_id !== ownerId) {
          return ApiResponse.error(ApiError.forbidden("Rent obligation does not belong to this owner"));
        }
      }
    }
```

The rest of the file (the `PaymentLinkService.getOrCreateToken` call and URL construction, lines 57-73 in the original) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/pay-link-tenant-auth.test.ts`
Expected: PASS

Then run the full existing owner-path test coverage for this route (if any exists under a different filename — check `grep -rl "pay-link" backend-next/tests/` and re-run any hits) to confirm the owner path still works unchanged.

- [ ] **Step 5: Commit**

```bash
cd backend-next
git add app/api/payments/pay-link/route.ts tests/pay-link-tenant-auth.test.ts
git commit -m "feat(payments): allow tenants to generate their own payment link

Owners keep full existing behavior (any tenant/obligation in their
hostel); a TENANT-role session may now also self-generate a link,
scoped strictly to their own tenant_id."
```

---

### Task 4: `POST /api/payments/pay/[token]` — add a `preview` action

**Files:**
- Modify: `backend-next/app/api/payments/pay/[token]/route.ts` (imports + POST handler)
- Test: `backend-next/tests/payment-link-flow.test.ts`

**Interfaces:**
- Consumes: `financialPaymentFacade.previewSettlement({ tenantId, hostelId, amountRupees }): Promise<SettlementPlan>` from `@/src/services/payments/financial-payment-facade` (existing, unchanged).
- Produces: `POST /api/payments/pay/[token]` with `{ action: "preview", amount: number }` → `{ success: true, plan: SettlementPlan }`. `SettlementPlan` shape (for Task 7's client script to consume): `{ allocations: { label: string; allocated: number; result: "PAID"|"PARTIAL"|"UNCHANGED" }[]; future_credit: number; total_outstanding: number; payment_accepted: boolean; rejection_reason: string | null; summary: string; ... }` (full shape defined in `settlement-planner.ts`'s `SettlementPlan` type — read it before Task 7 if any field name is unclear).

- [ ] **Step 1: Write the failing test**

Add to `backend-next/tests/payment-link-flow.test.ts`, following its existing fully-mocked-Prisma style (see its top-of-file `vi.mock("@/lib/db", ...)` setup):

```ts
it("returns a settlement preview for a valid token and amount", async () => {
  mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
    token: mockToken,
    tenant_id: "tenant-1",
    hostel_id: "hostel-1",
    owner_id: "owner-1",
    obligation_id: null,
    expires_at: new Date(Date.now() + 1000 * 60 * 60),
    rent_obligations: null,
    hostels: { name: "Adithya Hostel", phone: "1234567890" },
    tenants: { profiles: { name: "John Doe" } },
  });

  vi.mocked(financialPaymentFacade.previewSettlement).mockResolvedValueOnce({
    allocations: [],
    future_credit: 5000,
    total_outstanding: 0,
    total_to_settle: 0,
    remaining_outstanding: 0,
    minimum_allowed: 1,
    first_tier_label: "Future Rent Credit",
    payment_accepted: true,
    rejection_reason: null,
    payment_policy: "PARTIAL_ALLOWED",
    warnings: [],
    summary: "₹5,000 → credited as future rent",
    explanation: [],
    skipped_obligations: [],
    recommendation_score: 100,
  } as any);

  const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
    method: "POST",
    body: JSON.stringify({ action: "preview", amount: 5000 }),
  });
  const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });
  const json = await response.json();

  expect(response.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.plan.future_credit).toBe(5000);
});

it("rejects a preview request with a non-positive amount", async () => {
  mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
    token: mockToken,
    tenant_id: "tenant-1",
    hostel_id: "hostel-1",
    owner_id: "owner-1",
    obligation_id: null,
    expires_at: new Date(Date.now() + 1000 * 60 * 60),
    rent_obligations: null,
    hostels: { name: "Adithya Hostel", phone: "1234567890" },
    tenants: { profiles: { name: "John Doe" } },
  });

  const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
    method: "POST",
    body: JSON.stringify({ action: "preview", amount: 0 }),
  });
  const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });

  expect(response.status).toBe(400);
});
```

Check the top of `backend-next/tests/payment-link-flow.test.ts` for how `mockToken` is declared and whether `financialPaymentFacade` needs a new `vi.mock("@/src/services/payments/financial-payment-facade", ...)` block added (it isn't mocked yet, since the `preview` action doesn't exist before this task) — add one mirroring the existing `vi.mock("@/src/services/payments/payment-service", ...)` block's structure, mocking `previewSettlement` as a `vi.fn()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/payment-link-flow.test.ts -t "returns a settlement preview"`
Expected: FAIL — no `preview` action exists yet; the route falls through to the default "initiate" branch and errors trying to call `createMultiObligationPaymentIntent` with mocked-away data.

- [ ] **Step 3: Add the import and the `preview` branch**

In `backend-next/app/api/payments/pay/[token]/route.ts`, add to the imports (near line 6, alongside the existing `paymentService` import):

```ts
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";
```

Then, in the POST handler, insert a new branch immediately before the existing `if (body.action === "verify")` block (i.e. right after the `client_diagnostic` branch, before line 1117 in the original):

```ts
    if (body.action === "preview") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ success: false, error: "Enter a valid amount." }, { status: 400 });
      }

      const plan = await financialPaymentFacade.previewSettlement({
        tenantId: linkToken.tenant_id,
        hostelId: linkToken.hostel_id,
        amountRupees: amount,
      });

      return NextResponse.json({ success: true, plan });
    }
```

Also remove the now-obsolete obligation-status guard a few lines above it — replace (originally lines 1094-1097):

```ts
    // 3. Obligation status check
    if (linkToken.rent_obligations.status === "PAID") {
      return NextResponse.json({ success: false, error: "This payment obligation has already been paid." }, { status: 400 });
    }
```

with nothing (delete these lines entirely — a payment link is no longer tied to one obligation's paid/unpaid state; `createAmountPaymentIntent` in Task 5 handles "nothing to pay" by turning the whole amount into future credit instead of erroring).

Also change the Prisma `include` at the top of the POST handler (originally lines 1078-1082) from:

```ts
      include: {
        rent_obligations: true,
        hostels: { select: { name: true, phone: true } },
        tenants: { include: { profiles: { select: { name: true } } } },
      },
```

to (unchanged — `rent_obligations: true` still works fine as an optional relation include, returning `null` when absent; no edit needed here, confirmed by the Task 1 migration making the relation optional at the schema level only).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/payment-link-flow.test.ts`
Expected: PASS for the two new tests. Re-run the full file and fix any pre-existing test that asserted on the now-removed obligation-status-PAID 400 response (search the file for `"already been paid"` and update/remove that test since the behavior changed intentionally — see Task 5/6 for the replacement "everything becomes future credit" behavior it should assert instead, if such a test exists).

- [ ] **Step 5: Commit**

```bash
cd backend-next
git add app/api/payments/pay/[token]/route.ts tests/payment-link-flow.test.ts
git commit -m "feat(payments): add live settlement preview to the payment link page

New POST action 'preview' lets the payer-facing page show a
FIFO-allocation breakdown as they edit the amount, before checkout.
Also drops the obligation-must-be-unpaid guard now that links are
tenant-scoped rather than locked to one obligation."
```

---

### Task 5: `payment-service.ts` — new `createAmountPaymentIntent` function

This is the core new backend capability: an amount-first Razorpay intent creator, reusing `buildSettlementPlan` instead of requiring a pre-picked obligation list.

**Files:**
- Modify: `backend-next/src/services/payments/payment-service.ts` (add a new method to the `PaymentService` class, immediately after `createMultiObligationPaymentIntent`, i.e. after its closing brace around line 1129)
- Test: `backend-next/tests/integration/amount-payment-intent.test.ts`

**Interfaces:**
- Consumes: `buildSettlementPlan`, `toObligationSnapshot`, `PAYABLE_STATUSES` (from `./settlement-planner`, already imported in this file); `financialPolicyEngine` (already imported); `getProviderContext` (from `./merchant-context`, already imported); `PaymentProviderFactory` (already imported); `paymentStatusEventService` (already imported); `SETTLEMENT_STATUS`, `PAYMENT_DOMAIN`, `PAYMENT_FLOW`, `PAYMENT_SCOPE` (already imported constants, same ones `createMultiObligationPaymentIntent` uses).
- Produces: `paymentService.createAmountPaymentIntent(amountRupees: number, ownerId: string, tenantId: string, hostelId: string, options?: { bypassCollectionPolicy?: boolean; source?: string }): Promise<PaymentAttempt>` (same return shape as `createMultiObligationPaymentIntent` — a `paymentAttempt` row, possibly with `isReused` short-circuit before the gateway call). Task 6 calls this directly.

- [ ] **Step 1: Write the failing tests**

Create `backend-next/tests/integration/amount-payment-intent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation } from '../factories/payment-factory';

vi.mock('@/src/services/payments/providers/razorpay', () => ({
  RazorpayProvider: vi.fn().mockImplementation(() => ({
    createIntent: vi.fn().mockResolvedValue({
      provider: 'RAZORPAY',
      merchant_txn_id: 'test-txn',
      checkout_url: null,
      upi_intent_url: null,
      qr_payload: null,
      expires_at: null,
      gateway_txn_id: 'order_test123',
      provider_order_id: 'order_test123',
      provider_transaction_id: null,
      provider_reference_id: 'order_test123',
      raw_response: { id: 'order_test123', key_id: 'rzp_test_key' },
    }),
  })),
}));

import { paymentService } from '@/src/services/payments/payment-service';

describe('paymentService.createAmountPaymentIntent', () => {
  it('allocates a FIFO plan across obligations and links only the ones with allocated > 0', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const obligation1 = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 0, 1)),
      due_date: new Date(Date.UTC(2027, 0, 5)),
      rent_month: new Date(Date.UTC(2027, 0, 1)),
    });
    const obligation2 = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 1, 1)),
      due_date: new Date(Date.UTC(2027, 1, 5)),
      rent_month: new Date(Date.UTC(2027, 1, 1)),
    });

    // Pay 10,000: fully covers obligation1 (8,000), partially covers obligation2 (2,000)
    const attempt = await paymentService.createAmountPaymentIntent(
      10000,
      owner.id,
      tenant.id,
      hostel.id,
      { bypassCollectionPolicy: true, source: 'PAYMENT_LINK' }
    );

    expect(Number((attempt as any).amount)).toBe(10000);

    const links = await prisma.payment_attempt_obligations.findMany({
      where: { payment_attempt_id: (attempt as any).id },
    });
    expect(links.length).toBe(2);
    const byObligation = Object.fromEntries(links.map((l) => [l.obligation_id, Number(l.amount)]));
    expect(byObligation[obligation1.id]).toBe(8000);
    expect(byObligation[obligation2.id]).toBe(2000);
  });

  it('creates a pure future-credit intent (no linked obligations) when the tenant owes nothing', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    // No obligations at all.

    const attempt = await paymentService.createAmountPaymentIntent(
      5000,
      owner.id,
      tenant.id,
      hostel.id,
      { bypassCollectionPolicy: true, source: 'PAYMENT_LINK' }
    );

    expect(Number((attempt as any).amount)).toBe(5000);

    const links = await prisma.payment_attempt_obligations.findMany({
      where: { payment_attempt_id: (attempt as any).id },
    });
    expect(links.length).toBe(0);

    const raw = (attempt as any).raw_create_response as any;
    expect(Array.isArray(raw?.allowed_obligation_ids)).toBe(true);
    expect(raw.allowed_obligation_ids.length).toBe(0);
  });

  it('rejects a zero or negative amount', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    await expect(
      paymentService.createAmountPaymentIntent(0, owner.id, tenant.id, hostel.id, { source: 'PAYMENT_LINK' })
    ).rejects.toThrow(/greater than zero/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/integration/amount-payment-intent.test.ts`
Expected: FAIL — `paymentService.createAmountPaymentIntent is not a function`

- [ ] **Step 3: Add the new method**

In `backend-next/src/services/payments/payment-service.ts`, insert this new method into the `PaymentService` class immediately after the closing `}` of `createMultiObligationPaymentIntent` (after its return-null-on-catch block, around the original line 1129):

```ts
  /**
   * Amount-first counterpart to createMultiObligationPaymentIntent: instead of
   * a pre-picked obligation list, the caller supplies a raw rupee amount. The
   * FIFO settlement plan (same engine the offline "Receive Payment" flow uses)
   * decides which obligations absorb it and how much of each; any remainder
   * becomes future rent credit at finalization — no obligations required.
   */
  async createAmountPaymentIntent(
    amountRupees: number,
    ownerId: string,
    tenantId: string,
    hostelId: string,
    options: { bypassCollectionPolicy?: boolean; source?: string } = {}
  ) {
    if (!(amountRupees > 0)) {
      throw new Error("BAD_REQUEST: Amount must be greater than zero");
    }

    const hostelIdSafe = requireFinancialHostelId(hostelId, "amount-based payment intent");

    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: PAYMENT_FLOW.RENT,
      operationalOwnerId: ownerId,
      financialOwnerId: ownerId,
      hostelId: hostelIdSafe,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    const { provider, config } = providerContext;
    const instance = PaymentProviderFactory.getProvider(provider, config);

    const txResult = await prisma.$transaction(async (tx) => {
      // Same tenant-scoped advisory lock createMultiObligationPaymentIntent uses,
      // so the two intent-creation paths mutually exclude each other for one tenant.
      const advisoryKey = `pay_intent:${tenantId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey})::bigint)`;

      await tx.$queryRaw`
        SELECT id FROM rent_obligations
        WHERE tenant_id = ${tenantId}::uuid
          AND hostel_id = ${hostelIdSafe}::uuid
          AND status = ANY(ARRAY['OVERDUE','PENDING','PARTIAL','UPCOMING']::text[])
          AND is_superseded = false
        FOR UPDATE
      `;

      const obligations = await tx.rent_obligations.findMany({
        where: {
          tenant_id: tenantId,
          hostel_id: hostelIdSafe,
          status: { in: PAYABLE_STATUSES },
          is_superseded: false,
        },
        include: { payments: { select: { amount_paid: true } } },
      });

      const snapshots = obligations.map((ob: any) => toObligationSnapshot(ob));

      const hostelRecord = await tx.hostels.findUnique({
        where: { id: hostelIdSafe },
        select: { preferences_config: true },
      });
      const paymentPolicy = financialPolicyEngine.resolvePaymentPolicy(hostelRecord);

      const plan = buildSettlementPlan(snapshots, amountRupees, paymentPolicy);

      if (!plan.payment_accepted && !options.bypassCollectionPolicy) {
        throw new Error(`BAD_REQUEST: ${plan.rejection_reason}`);
      }

      const obligationsToLink = plan.allocations.filter((a) => a.allocated > 0);

      // Dedup against an in-flight/valid attempt already covering the same
      // obligations — mirrors createMultiObligationPaymentIntent. Only
      // meaningful when there's a real obligation set to check against; the
      // pure-future-credit case (no obligations) skips this check.
      if (obligationsToLink.length > 0) {
        const existingLinks = await tx.payment_attempt_obligations.findMany({
          where: {
            obligation_id: { in: obligationsToLink.map((a) => a.obligation_id) },
            payment_attempts: { hostel_id: hostelIdSafe, status: { in: ["CREATED", "PENDING"] } },
          },
          include: { payment_attempts: true },
          orderBy: { created_at: "desc" },
        });

        if (existingLinks.length > 0) {
          const existingAttempt = existingLinks[0].payment_attempts;
          const checkoutUrl = existingAttempt.checkout_url || "";
          const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
          const isInFlight = existingAttempt.status === "CREATED" && existingAttempt.created_at > twoMinAgo;
          const isSandboxCheckout = ["mercury-t2", "api-preprod", "pg-sandbox"].some((m) => checkoutUrl.includes(m));
          const hasValidCheckout = checkoutUrl.length > 0 && !checkoutUrl.includes("/payment-return") && !isSandboxCheckout;

          if (isInFlight || hasValidCheckout) {
            return { attempt: this.mapAttemptWithRawResponse(existingAttempt), isReused: true as const };
          }

          await this.updateAttemptStatus(tx, {
            attemptId: existingAttempt.id,
            fromStatus: existingAttempt.status,
            toStatus: "EXPIRED",
            source: "CREATE_INTENT",
            reason: "stale amount-based checkout attempt expired before replacement",
            operationalOwnerId: existingAttempt.owner_id,
            financialOwnerId: existingAttempt.owner_id,
            hostelId: existingAttempt.hostel_id,
            data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
          });
        }
      }

      const merchantTxnId = `hms_amt_${crypto.randomBytes(6).toString("hex")}`;

      const newAttempt = await tx.paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          provider,
          merchant_txn_id: merchantTxnId,
          merchant_transaction_id: merchantTxnId,
          amount: amountRupees,
          status: "CREATED",
          hostel_id: hostelIdSafe,
          payment_domain: providerContext.payment_domain,
          scope_type: providerContext.scope_type,
          flow_type: providerContext.flow_type,
          merchant_context_type: providerContext.merchant_context_type,
          merchant_context_id: providerContext.merchant_context_id,
          settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
          raw_create_response: {
            source: options.source,
            bypass_collection_policy: Boolean(options.bypassCollectionPolicy),
            // Persisted even when non-empty (harmless/ignored once
            // payment_attempt_obligations rows exist) — but REQUIRED to be a
            // real empty array (not omitted) when obligationsToLink is empty,
            // so finalizePaymentAttempt's fallback branch routes the full
            // amount to future credit instead of re-sweeping all outstanding
            // obligations. See payment-service.ts's `allowedIds` handling in
            // finalizePaymentAttempt's `else if (attempt.tenant_id)` branch.
            allowed_obligation_ids: obligationsToLink.map((a) => a.obligation_id),
          },
        },
      });

      await paymentStatusEventService.append(tx, {
        attemptId: newAttempt.id,
        fromStatus: null,
        toStatus: "CREATED",
        source: "CREATE_INTENT",
        reason: "amount-based payment attempt created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId: hostelIdSafe,
      });

      if (obligationsToLink.length > 0) {
        await tx.payment_attempt_obligations.createMany({
          data: obligationsToLink.map((a) => ({
            id: crypto.randomUUID(),
            payment_attempt_id: newAttempt.id,
            obligation_id: a.obligation_id,
            amount: a.allocated,
          })),
        });
      }

      return { attempt: newAttempt, isReused: false as const };
    });

    if (txResult.isReused) return txResult.attempt;

    const { attempt } = txResult;

    const tenantRecord = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { profiles: true },
    });

    try {
      const result = await instance.createIntent({
        amount: amountRupees,
        merchant_txn_id: attempt.merchant_txn_id,
        tenant_name: (tenantRecord as any)?.profiles?.name || "Tenant",
        tenant_email: (tenantRecord as any)?.profiles?.email || "",
        tenant_phone: (tenantRecord as any)?.profiles?.phone || "",
        metadata: {
          tenant_id: tenantId,
          attempt_id: attempt.id,
          is_amount_based: true,
        },
      });

      return await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "PENDING",
        source: "CREATE_INTENT",
        reason: "provider checkout created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId: hostelIdSafe,
        data: {
          gateway_txn_id: result.gateway_txn_id,
          ...this.attemptIdentityData(attempt.merchant_txn_id, result),
          upi_intent_url: result.upi_intent_url,
          qr_payload: result.qr_payload,
          checkout_url: result.checkout_url,
          expires_at: result.expires_at,
          raw_create_response: result.raw_response as any,
        },
      });
    } catch (error) {
      logger.error("payments.create_amount_intent.failed", {
        attemptId: attempt.id,
        provider,
        merchantTxnId: attempt.merchant_txn_id,
        error: String(error),
      });
      await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "FAILED",
        source: "CREATE_INTENT",
        reason: "provider checkout creation failed",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId: hostelIdSafe,
        data: { raw_create_response: { error: String(error) } as any, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      });
      throw error;
    }
  }
```

Before running, confirm two things by reading the top of `payment-service.ts` (do not guess): (a) that `logger` is already an in-scope module-level logger (used elsewhere in this file, e.g. inside `createMultiObligationPaymentIntent`'s catch block) — if the file uses a differently-named logger instance, use that name instead; (b) that `requireFinancialHostelId` is already imported in this file (it's used at line 837 of `createMultiObligationPaymentIntent`) — if not exported from wherever that import comes from, import it the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/integration/amount-payment-intent.test.ts`
Expected: PASS for all three tests.

- [ ] **Step 5: Regression-check the financial safety invariant**

Run: `cd backend-next && npm run check:financial-safety -- --warn-only`
Expected: `NO_OBLIGATION_OVERPAYMENT` and all other checks pass (or, if run against a database with pre-existing unrelated findings, confirm no *new* findings reference obligations touched by the test run above — the test DB and dev DB are separate per `DATABASE_URL_TEST` vs `DATABASE_URL`, so this is primarily a sanity check that the script itself still runs cleanly against schema post-Task-1-migration).

- [ ] **Step 6: Commit**

```bash
cd backend-next
git add src/services/payments/payment-service.ts tests/integration/amount-payment-intent.test.ts
git commit -m "feat(payments): add amount-first Razorpay intent creation

createAmountPaymentIntent mirrors createMultiObligationPaymentIntent
but starts from a raw rupee amount instead of a pre-picked obligation
list, using buildSettlementPlan (the same engine the offline Receive
Payment flow already uses) to decide the FIFO allocation. Reuses
finalizePaymentAttempt's existing obligation-linked and tenant-fallback
branches unchanged — verified the empty-allocation case correctly
routes 100% to future credit via the fallback branch's
allowed_obligation_ids handling."
```

---

### Task 6: Wire the `initiate` action to the new amount-first intent

**Files:**
- Modify: `backend-next/app/api/payments/pay/[token]/route.ts:1138-1151` (the default/"initiate" branch)
- Test: `backend-next/tests/payment-link-flow.test.ts`

**Interfaces:**
- Consumes: `paymentService.createAmountPaymentIntent` from Task 5.
- Produces: `POST /api/payments/pay/[token]` with `{ action: "initiate", amount: number }` (amount now required in the request body; previously the action took no body fields at all).

- [ ] **Step 1: Write the failing test**

Add to `backend-next/tests/payment-link-flow.test.ts`:

```ts
it("initiates a payment for the payer-entered amount, not a fixed obligation balance", async () => {
  mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
    token: mockToken,
    tenant_id: "tenant-1",
    hostel_id: "hostel-1",
    owner_id: "owner-1",
    obligation_id: null,
    expires_at: new Date(Date.now() + 1000 * 60 * 60),
    rent_obligations: null,
    hostels: { name: "Adithya Hostel", phone: "1234567890" },
    tenants: { profiles: { name: "John Doe", email: "j@example.com", phone: "9999999999" } },
  });

  vi.mocked(paymentService.createAmountPaymentIntent).mockResolvedValueOnce({
    id: "attempt-1",
    amount: 12000,
    status: "PENDING",
    raw_response: { key_id: "rzp_test", amount: 1200000, currency: "INR" },
    gateway_txn_id: "order_abc",
  } as any);

  const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
    method: "POST",
    body: JSON.stringify({ action: "initiate", amount: 12000 }),
  });
  const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });
  const json = await response.json();

  expect(response.status).toBe(200);
  expect(paymentService.createAmountPaymentIntent).toHaveBeenCalledWith(
    12000,
    "owner-1",
    "tenant-1",
    "hostel-1",
    expect.objectContaining({ source: "PAYMENT_LINK" })
  );
  expect(json.attempt.amount).toBe(12000);
});

it("rejects initiate with a missing or non-positive amount", async () => {
  mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
    token: mockToken,
    tenant_id: "tenant-1",
    hostel_id: "hostel-1",
    owner_id: "owner-1",
    obligation_id: null,
    expires_at: new Date(Date.now() + 1000 * 60 * 60),
    rent_obligations: null,
    hostels: { name: "Adithya Hostel", phone: "1234567890" },
    tenants: { profiles: { name: "John Doe" } },
  });

  const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
    method: "POST",
    body: JSON.stringify({ action: "initiate" }),
  });
  const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });

  expect(response.status).toBe(400);
});
```

Add `createAmountPaymentIntent: vi.fn()` to the existing `vi.mock("@/src/services/payments/payment-service", ...)` block's mocked shape at the top of the file (alongside the already-mocked `createMultiObligationPaymentIntent`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/payment-link-flow.test.ts -t "initiates a payment for the payer-entered amount"`
Expected: FAIL — route still calls `createMultiObligationPaymentIntent([linkToken.obligation_id], ...)`, which is `null` now and errors, or the mock isn't called with the expected args.

- [ ] **Step 3: Edit the route**

In `backend-next/app/api/payments/pay/[token]/route.ts`, replace the default "initiate" block (originally lines 1138-1151):

```ts
    // Default: initiate payment
    logger.info("payment_link.checkout.initiate", {
      token,
      obligation_id: linkToken.obligation_id,
      tenant_id: linkToken.tenant_id,
      hostel_id: linkToken.hostel_id,
    });

    const rawAttempt = await paymentService.createMultiObligationPaymentIntent(
      [linkToken.obligation_id],
      linkToken.owner_id,
      linkToken.tenant_id,
      { bypassCollectionPolicy: true, source: "PAYMENT_LINK" }
    );
```

with:

```ts
    // Default: initiate payment
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "Enter a valid amount before proceeding." }, { status: 400 });
    }

    logger.info("payment_link.checkout.initiate", {
      token,
      amount,
      obligation_id: linkToken.obligation_id,
      tenant_id: linkToken.tenant_id,
      hostel_id: linkToken.hostel_id,
    });

    const rawAttempt = await paymentService.createAmountPaymentIntent(
      amount,
      linkToken.owner_id,
      linkToken.tenant_id,
      linkToken.hostel_id,
      { bypassCollectionPolicy: true, source: "PAYMENT_LINK" }
    );
```

The rest of the handler (the `isReused` unwrap, `key_id` injection, response construction) is unchanged — it already operates generically on `attempt`, not on obligation-specific fields.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env.test npx vitest run tests/payment-link-flow.test.ts`
Expected: PASS. Also search the file for any remaining test asserting the old `createMultiObligationPaymentIntent([linkToken.obligation_id], ...)` call shape for the default action and update/remove it, since that call site no longer exists.

- [ ] **Step 5: Commit**

```bash
cd backend-next
git add app/api/payments/pay/[token]/route.ts tests/payment-link-flow.test.ts
git commit -m "feat(payments): initiate checkout with the payer-entered amount

POST .../pay/[token] with action 'initiate' now requires an 'amount'
field and calls the new createAmountPaymentIntent instead of always
charging one pre-linked obligation's full balance."
```

---

### Task 7: `GET /api/payments/pay/[token]` — editable amount + live breakdown

**Files:**
- Modify: `backend-next/app/api/payments/pay/[token]/route.ts` (`renderPage`'s DUE-state HTML, the GET handler's amount/breakdown computation, the inline client `<script>`)

**Interfaces:**
- Consumes: `financialPaymentFacade.previewSettlement` (Task 4's import), the `preview` and `initiate` POST actions (Tasks 4 and 6).
- Produces: no new backend interface — this is the payer-facing HTML/JS only. No automated test (this route renders a full HTML document with inline JS driving a real Razorpay checkout modal — the existing test suite for this file only exercises the JSON-returning POST branches, not the rendered page). Verify manually per Step 4.

- [ ] **Step 1: Replace the DUE-state HTML block in `renderPage`**

In `backend-next/app/api/payments/pay/[token]/route.ts`, replace the `case "DUE":` block (originally lines 69-101, everything from `` `<div class="amount-card">` `` through the closing `` `; `` before `case` moves to the next status):

```ts
      case "DUE":
        return `
          <div class="amount-card">
            <p class="label">Amount to Pay</p>
            <div class="amount-input-row">
              <span class="amount-currency">₹</span>
              <input type="number" id="amount-input" class="amount-input" min="1" step="1" inputmode="numeric" value="${Math.round(amount || 0)}" />
            </div>
          </div>

          <div class="breakdown-box">
            <p class="breakdown-title">Payment Breakdown</p>
            <div id="breakdown-content">
              <p class="breakdown-loading">Calculating...</p>
            </div>
          </div>

          <button type="button" id="pay-btn" class="pay-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Proceed to Secure Payment
          </button>
          <div id="error-message" class="error-msg" style="display: none;"></div>
        `;
```

This drops the static server-rendered `breakdown` table (the `content.breakdown` array is no longer used for the DUE case — the breakdown is now always computed live via the `preview` action) and adds an editable amount `<input>`. Leave the `renderPage` function's `content.breakdown` parameter and the other status cases (`PAID`/`EXPIRED`/`ERROR`) untouched.

- [ ] **Step 2: Rewrite the GET handler's amount computation**

In the GET handler, replace the block from the obligation-status/outstanding checks through the breakdown-building code (originally lines 933-1004: everything from `// 3. Obligation status check` through the `renderPage({...})` call, but keep the `formatDate` helper at lines 981-985 and the final `return new NextResponse(renderPage({...}), ...)` structure) with:

```ts
    // 3. Compute the default amount to pre-fill.
    // Priority: (a) the hinted obligation's remaining balance, if any and
    // still unpaid; (b) the tenant's current total outstanding across all
    // payable obligations; (c) the tenant's monthly rent, so a fully-paid-up
    // tenant can still pay ahead.
    let defaultAmount = 0;
    if (obligation && obligation.status !== "PAID") {
      const paidAmount = obligation.payments.reduce(
        (sum: number, p: any) => sum + Number(p.amount_paid),
        0
      );
      defaultAmount = Math.max(0, Number(obligation.amount) - paidAmount);
    }

    if (defaultAmount <= 0) {
      const probePlan = await financialPaymentFacade.previewSettlement({
        tenantId: linkToken.tenant_id,
        hostelId: linkToken.hostel_id,
        amountRupees: 0,
      });
      defaultAmount = probePlan.total_outstanding > 0
        ? probePlan.total_outstanding
        : Number(linkToken.tenants.monthly_rent || 0);
    }

    const formatDate = (date: Date | string | null): string => {
      if (!date) return "N/A";
      const d = new Date(date);
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    };

    // 4. Render summary page with the editable amount + Proceed button
    return new NextResponse(
      renderPage({
        title: `Pay ${hostelName}`,
        hostelName,
        tenantName,
        status: "DUE",
        dueMonth: obligation ? formatMonth(obligation.rent_month) : undefined,
        dueDate: obligation ? formatDate(obligation.due_date) : undefined,
        amount: defaultAmount,
        supportPhone,
        token,
        roomNo,
        openedFromWhatsApp,
        hostelAddress,
        logoUrl,
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
```

Also update the earlier variable declaration `const obligation = linkToken.rent_obligations;` (originally line 893) — no change needed to that line itself (it now naturally holds `null` when unset, matching the Task 1 schema change), but every remaining reference to `obligation.*` above this point in the function must be null-guarded. Specifically:
- The WhatsApp continuity check (originally lines 908-924) references `obligation.id` in the `whatsapp_logs` lookup — wrap it: only run that lookup `if (obligation)`, otherwise leave `openedFromWhatsApp` as determined by the `source` query param alone.
- Remove the breakdown-generation block entirely (originally lines 954-979, the `monthlyRent`/`maintenance`/`breakdown.push(...)` logic) — it's superseded by the live `preview` action.

- [ ] **Step 3: Extend the inline client script**

In the `clientScript` template (inside the `status === "DUE"` conditional, originally starting at line 138), add these pieces. First, right after the `const logoUrl = "${logoUrl}";` line, add:

```js
      const amountInput = document.getElementById('amount-input');
      const breakdownContent = document.getElementById('breakdown-content');
      const monthlyRent = ${Number(linkToken.tenants.monthly_rent || 0)};
      let previewDebounceTimer = null;

      function renderBreakdown(plan) {
        if (!breakdownContent) return;
        if (!plan.payment_accepted) {
          breakdownContent.innerHTML = '<p class="breakdown-error">' + escapeHtml(plan.rejection_reason || 'This amount cannot be accepted.') + '</p>';
          return;
        }
        const rows = plan.allocations
          .filter(function(a) { return a.allocated > 0; })
          .map(function(a) {
            return '<div class="breakdown-row"><span>' + escapeHtml(a.label) + '</span><span>₹' + Number(a.allocated).toLocaleString('en-IN') + '</span></div>';
          })
          .join('');
        const creditRow = plan.future_credit > 0
          ? '<div class="breakdown-row"><span>Advance / Future Rent Credit</span><span>₹' + Number(plan.future_credit).toLocaleString('en-IN') + '</span></div>'
          : '';
        breakdownContent.innerHTML = (rows + creditRow) || '<p class="breakdown-loading">Enter an amount above.</p>';
      }

      async function fetchPreview(amount) {
        if (!amount || amount <= 0) {
          if (breakdownContent) breakdownContent.innerHTML = '<p class="breakdown-loading">Enter an amount above.</p>';
          return;
        }
        try {
          const res = await fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'preview', amount: amount })
          });
          const data = await res.json();
          if (data.success) renderBreakdown(data.plan);
        } catch (e) {
          console.error('preview fetch failed', e);
        }
      }

      if (amountInput) {
        fetchPreview(Number(amountInput.value));
        amountInput.addEventListener('input', function() {
          clearTimeout(previewDebounceTimer);
          previewDebounceTimer = setTimeout(function() {
            fetchPreview(Number(amountInput.value));
          }, 400);
        });
      }
```

Then, inside the `payBtn.addEventListener('click', async () => { ... })` handler, immediately after the existing `payBtn.disabled = true; payBtn.innerText = 'Initializing...';` lines and before the `fetch(...)` call, insert the amount read + soft-warning confirmation:

```js
          const enteredAmount = Number(amountInput ? amountInput.value : 0);
          if (!enteredAmount || enteredAmount <= 0) {
            payBtn.disabled = false;
            payBtn.innerText = 'Proceed to Secure Payment';
            if (errorMsg) { errorMsg.textContent = 'Please enter an amount before proceeding.'; errorMsg.style.display = 'block'; }
            return;
          }
          if (monthlyRent > 0 && enteredAmount > monthlyRent * 3) {
            const confirmed = window.confirm('That is a large amount (₹' + enteredAmount.toLocaleString('en-IN') + '). Are you sure you want to proceed?');
            if (!confirmed) {
              payBtn.disabled = false;
              payBtn.innerText = 'Proceed to Secure Payment';
              return;
            }
          }
```

And change the existing `initiate` fetch body from:

```js
              body: JSON.stringify({ action: 'initiate' })
```

to:

```js
              body: JSON.stringify({ action: 'initiate', amount: enteredAmount })
```

- [ ] **Step 4: Manual verification**

Run: `cd backend-next && DOTENV_CONFIG_PATH=../.env npm run dev` and `cd frontend-v2 && npm run dev` (or reuse already-running dev servers). In a browser, generate a payment link for (a) a tenant with two outstanding obligations, (b) a fully-paid-up tenant, (c) via an obligation card's link (obligation hint present). For each: confirm the amount field pre-fills as designed, edit the amount and confirm the breakdown updates within ~400ms without a full page reload, confirm entering an amount over 3× monthly rent triggers the browser `confirm()` dialog, and confirm clicking "Proceed to Secure Payment" opens the Razorpay checkout modal with the entered amount reflected (check the modal's displayed amount). Do not need to complete a real payment for this check — cancelling the Razorpay modal after it opens with the correct amount is sufficient evidence the wiring is correct.

- [ ] **Step 5: Commit**

```bash
cd backend-next
git add app/api/payments/pay/[token]/route.ts
git commit -m "feat(payments): editable amount + live breakdown on the payment link page

Replaces the fixed obligation-amount display with an editable amount
field, a debounced live FIFO-allocation breakdown (via the new preview
action), and a soft warning above 3x monthly rent before checkout."
```

---

### Task 8: Frontend — drop the outstanding-dues gate, update stale copy

**Files:**
- Modify: `frontend-v2/src/features/tenants/components/list/TenantCardMoreSheet.tsx:112-126`
- Modify: `frontend-v2/src/features/tenants/components/financial/DocumentsHub.tsx:134`

**Interfaces:** none — purely presentational/conditional-rendering changes, no new props or state.

- [ ] **Step 1: Remove the gate in `TenantCardMoreSheet.tsx`**

In `frontend-v2/src/features/tenants/components/list/TenantCardMoreSheet.tsx`, replace:

```tsx
    {/* Share Payment Link if outstanding */}
    {tenant.outstandingAmount > 0 && (
      <button
        type="button"
        onClick={() =>
          handleAction(() =>
            actions.sharePaymentLink(tenant.id, tenant.phone, tenant.outstandingAmount)
          )
        }
        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
      >
        <Share2 className="w-5 h-5 text-indigo-500 shrink-0" />
        <span>Share Payment Link</span>
      </button>
    )}
```

with:

```tsx
    {/* Share Payment Link — available regardless of outstanding dues */}
    <button
      type="button"
      onClick={() =>
        handleAction(() =>
          actions.sharePaymentLink(tenant.id, tenant.phone, tenant.outstandingAmount)
        )
      }
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-secondary text-foreground transition-colors font-medium text-left"
    >
      <Share2 className="w-5 h-5 text-indigo-500 shrink-0" />
      <span>Share Payment Link</span>
    </button>
```

`actions.sharePaymentLink(tenant.id, tenant.phone, tenant.outstandingAmount)` is unchanged — passing `tenant.outstandingAmount` (which may now be `0`) as the WhatsApp message's amount hint is harmless; `useTenantActions.ts:151`'s message template only mentions the amount `if (amount)`, so a `0` value naturally omits the amount clause from the composed message.

- [ ] **Step 2: Update stale copy in `DocumentsHub.tsx`**

In `frontend-v2/src/features/tenants/components/financial/DocumentsHub.tsx`, replace:

```tsx
        <p className="text-xs text-muted-foreground">Generate a payment link the tenant can use to pay outstanding dues directly.</p>
```

with:

```tsx
        <p className="text-xs text-muted-foreground">Generate a payment link the tenant can use to pay any amount — current dues, upcoming rent, or in advance.</p>
```

- [ ] **Step 3: Manual verification**

Run: `cd frontend-v2 && npm run dev`. Open a tenant profile for a tenant with zero outstanding dues, open the tenant list's "more" sheet for that tenant, confirm "Share Payment Link" now renders (previously hidden). Open the Documents tab's "Payment Links" sub-tab and confirm the updated copy.

- [ ] **Step 4: Build check**

Run: `cd frontend-v2 && npm run build`
Expected: succeeds (includes `check:architecture` and the branding check, per `CLAUDE.md`).

- [ ] **Step 5: Commit**

```bash
cd frontend-v2
git add src/features/tenants/components/list/TenantCardMoreSheet.tsx src/features/tenants/components/financial/DocumentsHub.tsx
git commit -m "feat(payments): show Share Payment Link regardless of outstanding dues

Both entry points previously hid or implied the link only worked for
tenants who owed money; it now works unconditionally."
```

---

### Task 9: Frontend — tenant self-service "Share Payment Link" in the tenant portal

**Files:**
- Modify: `frontend-v2/src/portal/pages/TenantFinancialsPage.tsx`

**Interfaces:**
- Consumes: `paymentService.generatePayLink({ tenantId })` from `frontend-v2/src/features/payments/api/index.js:273-276` (already imported in this file, per research — used for `createTestIntent`), `profile?.tenant?.id` from `useTenantDashboard()` (already in scope via `const { profile, dues, readModel, payments, advance, isLoading } = useTenantDashboard();`).
- Produces: no new exports — a new button + click handler local to this page.

- [ ] **Step 1: Add the handler**

In `frontend-v2/src/portal/pages/TenantFinancialsPage.tsx`, near `handleOpenPaymentModal` (originally around line 739), add:

```tsx
  const handleSharePaymentLink = async () => {
    const tenantId = (profile?.tenant as Record<string, unknown> | undefined)?.id as string | undefined;
    if (!tenantId) return;
    try {
      const res = await paymentService.generatePayLink({ tenantId });
      await navigator.clipboard?.writeText(res.url).catch(() => {});
      toast.success('Payment link copied to clipboard');
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Could not generate payment link');
    }
  };
```

Verify the exact shape of `profile.tenant` by checking how `TenantDashboardPage.tsx` reads it (`const tenant = profile?.tenant as Record<string, unknown> | undefined;`, confirmed in research) — if `TenantFinancialsPage.tsx`'s `profile` type already exposes a narrower `tenant.id` type without the cast, use that instead of the `Record<string, unknown>` cast shown above.

- [ ] **Step 2: Add the button**

Immediately after the existing "Make Payment" button (originally lines 829-837, inside the same action-row `<div>`), add a second button:

```tsx
          <button
            type="button"
            onClick={handleSharePaymentLink}
            className="px-5 py-2.5 rounded-xl bg-white/10 text-white font-bold text-sm border border-white/30 hover:bg-white/20 transition-colors flex items-center justify-center gap-2 cursor-pointer self-start sm:self-center"
          >
            <Send className="w-4 h-4" />
            Share Payment Link
          </button>
```

`Send` is already imported at the top of this file (per research, line 8 of the `lucide-react` import block) — no new import needed. If the surrounding action row's flex layout doesn't naturally wrap a second button (check visually in Step 4), adjust the row's container to `flex-wrap` rather than changing this button's own classes.

- [ ] **Step 3: Manual verification**

Run: `cd frontend-v2 && npm run dev`, log in as a tenant (or use an existing tenant-portal session), navigate to `/tenant/financials`, confirm the new "Share Payment Link" button renders beside "Make Payment," click it, confirm a success toast appears and the link is on the clipboard (paste it somewhere to confirm it's a valid `/pay/<uuid>` URL). Open that URL in a new tab/incognito window and confirm it renders the flexible payment page from Task 7 (no login required — it's the public token-gated route).

- [ ] **Step 4: Build check**

Run: `cd frontend-v2 && npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
cd frontend-v2
git add src/portal/pages/TenantFinancialsPage.tsx
git commit -m "feat(payments): tenants can generate their own payment link

Adds a 'Share Payment Link' action next to 'Make Payment' on the
tenant portal's financials page, so a tenant can send a payable link
to a guardian or anyone else paying on their behalf."
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/obsidian/APIs.md:80`
- Modify: `docs/obsidian/Database.md` (add a new `payment_link_tokens` section)
- Modify: `docs/obsidian/Business-Rules.md` (new section)
- Modify: `docs/obsidian/Features.md` (new entry)
- Modify: `docs/obsidian/Changelog.md` (new entry)
- Modify: `docs/obsidian/Decisions.md` (new `ADR-017`, inserted at the top per the file's own convention)

- [ ] **Step 1: `docs/obsidian/APIs.md`**

Replace the single dense line at `docs/obsidian/APIs.md:80` — find the substring `` `/api/payments/pay-link`, `/api/payments/pay/[token]` (**public**, unauthenticated token-gated payment page) `` within that paragraph and replace it with:

```
`/api/payments/pay-link` (owner- or tenant-authenticated; tenants may only generate a link for their own account), `/api/payments/pay/[token]` (**public**, unauthenticated token-gated payment page — payer enters any amount; live FIFO-allocation preview via an in-page `preview` action, checkout via `initiate` with the entered amount)
```

- [ ] **Step 2: `docs/obsidian/Database.md`**

Add a new short section (place it near the other Payments-infra prose sections, following the narrative style of the existing per-table blocks, e.g. the `correction_case_events` block referenced at lines 60-61):

```markdown
### `payment_link_tokens`

A token maps to a `tenant_id` (required) and an optional `obligation_id` hint
(nullable as of 2026-07-21 — see [[Decisions#ADR-017]]). The hint, when
present, only seeds a default pre-filled amount on the payer-facing page; it
does not restrict what the payer can actually pay. There is no `amount`
column — the amount charged is always decided at payment time and
FIFO-allocated across whatever the tenant currently owes via
`buildSettlementPlan` (see [[Backend]]), with any excess credited as future
rent. See [[APIs#Payments]] for the two routes that create and consume a
token.
```

- [ ] **Step 3: `docs/obsidian/Business-Rules.md`**

Add a new section:

```markdown
## Flexible payment links

A payment link (`payment_link_tokens`) is tenant-scoped, not
obligation-locked. The payer can enter any amount on the link's page; the
backend FIFO-allocates it across the tenant's currently outstanding
obligations (`OVERDUE`, `PENDING`, `PARTIAL`, `UPCOMING`) using the same
`buildSettlementPlan` engine the owner's offline "Receive Payment" flow uses
— any amount left over after covering everything payable is credited as
future rent (`FUTURE_RENT_CREDIT_TOPUP`). A tenant with zero outstanding
obligations can still generate and use a link to pay ahead of their next
rent. Both owners and tenants can generate a link; a tenant may only
generate one for their own account. See [[Decisions#ADR-017]] for why this
changed from the prior obligation-locked, dues-only behavior.
```

- [ ] **Step 4: `docs/obsidian/Features.md`**

Add an entry (near the existing "Share Payment Link" / Tenant Profile consolidation entries referenced in the vault):

```markdown
- **Flexible payment links (2026-07-21):** "Share Payment Link" no longer
  requires the tenant to have an outstanding obligation, and the payer can
  enter any amount rather than being locked to one obligation's exact
  balance. Tenants can also self-generate a link from their own portal
  (`/tenant/financials`), not just owners. See [[Business-Rules#Flexible
  payment links]].
```

- [ ] **Step 5: `docs/obsidian/Changelog.md`**

Add an entry at the top of the changelog list, following its existing entry format (check the two or three most recent entries for exact date/format conventions before writing this one, then match it):

```markdown
- **2026-07-21** — Payment links are now amount-flexible and tenant-scoped
  instead of locked to one obligation's exact balance; tenants can also
  generate their own link. See [[Business-Rules]], [[APIs]], [[Database]].
```

- [ ] **Step 6: `docs/obsidian/Decisions.md`**

Insert at the top of the ADR list (per the file's own instruction to append new entries at the top with real dates):

```markdown
## ADR-017: Payment links are amount-flexible and tenant-scoped, not obligation-locked

- **Date:** 2026-07-21
- **Status:** accepted
- **Evidence:** `src/services/payments/payment-link-service.ts::getOrCreateToken` previously required resolving a `tenantId` to exactly one `PENDING`/`PARTIAL` obligation, throwing `"No outstanding rent obligations found for this tenant"` otherwise; `payment_link_tokens.obligation_id` was a required FK with no `amount` column, and the online checkout path (`createMultiObligationPaymentIntent`) always charged that one obligation's full remaining balance.
- **Decision:** A payment link now maps to a tenant, not an obligation. `obligation_id` became an optional default-amount hint. The payer enters any amount on the link's page; the backend FIFO-allocates it across the tenant's outstanding obligations via `buildSettlementPlan` — the same engine the offline "Receive Payment" flow already used — with any excess credited as future rent, via a new `createAmountPaymentIntent` function that mirrors `createMultiObligationPaymentIntent` but starts from a raw amount instead of a pre-picked obligation list. Both owners and tenants can generate a link.
- **Alternatives considered:** Synthesizing a placeholder `rent_obligations` row for the entered amount — rejected, since obligations are the audit-first source of truth for money owed and a synthetic row would pollute every dues/report calculation that reads obligations. A separate parallel "flexible link" type that always books as future credit — rejected, since a payer with real current dues would have their payment misfiled as advance credit instead of clearing what they actually owe.
- **Consequences:** The online (Razorpay) and offline (manual "Receive Payment") payment paths now converge on the same FIFO allocation engine for the first time, rather than diverging (online was previously obligation-first-only, offline was amount-first-only). A payment link generated from a specific obligation card is no longer a hard guarantee that payment will apply to only that obligation — it's a default-amount suggestion. Full design: `docs/superpowers/specs/2026-07-21-flexible-payment-links-design.md`.
- **Related:** [[Business-Rules]], [[APIs]], [[Database]]
```

- [ ] **Step 7: Commit**

```bash
git add docs/obsidian/APIs.md docs/obsidian/Database.md docs/obsidian/Business-Rules.md docs/obsidian/Features.md docs/obsidian/Changelog.md docs/obsidian/Decisions.md
git commit -m "docs: document flexible payment links (ADR-017)"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

Run: `cd backend-next && npm test`
Expected: all tests pass, including every test added in Tasks 1-6 and the full pre-existing suite (single-worker/real-DB per `vitest.config.ts` — this will take a while; let it finish).

- [ ] **Step 2: Financial safety and payment-production checks**

Run: `cd backend-next && npm run check:financial-safety`
Run: `cd backend-next && npm run check:payment-production`
Expected: both pass. If `check:payment-production` fails on env-var checks unrelated to this feature (it only validates deployment config, per Task-5's research), that's pre-existing environment state, not a regression from this work — note it but don't treat it as a plan failure.

- [ ] **Step 3: Architectural invariants**

Run: `cd backend-next && npm run check:invariants`
Expected: passes — this feature doesn't touch `hostelId`-optional patterns or dashboard cache invalidation, but confirm no incidental violation was introduced.

- [ ] **Step 4: Both app builds**

Run: `cd backend-next && npm run build`
Run: `cd frontend-v2 && npm run build`
Expected: both succeed (frontend build includes `check:architecture` and the branding check).

- [ ] **Step 5: End-to-end manual smoke test**

Using the dev servers, walk through the three scenarios from Task 7 Step 4 one more time end-to-end, plus: complete one real (or Razorpay test-mode) payment for a tenant with two obligations and an entered amount that partially covers the second one, then confirm on the owner-side Tenant Profile page (`UnifiedActivityTimeline`) that both obligations show correct paid/partial status and any future credit appears in the ledger.

- [ ] **Step 6: Update the status report if one exists for this feature**

Check whether `docs/business-logic/` should get a short investigation-style writeup analogous to `docs/business-logic/financial-consistency-investigation-report.md`, given this change unifies two previously-divergent payment-allocation engines — optional, at the implementer's judgment, not required by this plan.
