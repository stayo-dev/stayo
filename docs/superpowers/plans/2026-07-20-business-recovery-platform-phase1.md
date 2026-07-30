# Business Recovery Platform — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core Business Recovery Platform (Correction Case lifecycle, self-registering handler registry, Validation & Preview Engine, idempotent/retry-safe execution, event-bus publishing) and its first three Correction Handlers — Reverse Payment, Transfer Payment, Edit Reference — plus the owner-facing Recovery Center UI.

**Architecture:** One new Prisma table pair (`correction_cases`, `correction_case_events`) backs a domain-agnostic five-state lifecycle (DRAFT→PREVIEW→VALIDATED→EXECUTING→COMPLETED/FAILED). A `recovery-service.ts` orchestrator in `backend-next/src/services/recovery/` owns all case bookkeeping and never contains business rules; each domain owns a `CorrectionHandler` + `CorrectionPolicy` pair that plugs into a self-registering `correction-registry.ts`. Handlers call existing services (`settlement-engine.ts`, `settlement-planner.ts`, `tenant-financial-ledger-service.ts`) — no forked financial logic. Full design rationale: `docs/business-logic/business-recovery-platform-architecture.md`, `docs/business-logic/financial-corrections-framework-proposal.md`, `docs/business-logic/operation-recovery-undo-system-proposal.md`.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres (backend-next/); Vite + React 19 + TanStack Query + Tailwind (frontend-v2/); Vitest against real Postgres (fileParallelism: false).

## Global Constraints

- `payments` rows are NEVER updated or deleted — every correction writes new rows only. This is the one absolute rule; violating it anywhere is a blocking defect, not a style note.
- Every new backend route/service resolves `hostelId` via `resolveOwnerScope` and never falls back to `hostels[0]` or makes `hostelId` optional (enforced by `backend-next/scripts/architectural-invariants-check.ts`).
- No new ledger writes bypass `tenantFinancialLedgerService` — always call `debitInTx`/`creditIdempotentInTx`, never `prisma.tenant_financial_ledger.create` directly.
- No settlement/allocation logic is reimplemented — obligation allocation always goes through `buildSettlementPlan` (settlement-planner.ts) + `executePlanInTx` (settlement-engine.ts), never a hand-rolled loop.
- All new frontend code imports `api` from `@lib/api-client` — never raw `fetch()` or `axios` (enforced by `frontend-v2/scripts/check-architecture.mjs`, which also runs on `npm run build`).
- New Prisma models follow existing convention: no `@@map` needed since table names are already snake_case-plural; schema changes are hand-authored SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` (this repo does NOT use `prisma migrate dev` — no `migration_lock.toml` exists — apply via `npm run prisma:push` then `npm run prisma:generate`).
- Money amounts on `payments`/`rent_obligations` are `Decimal` in rupees (not paise) in this specific table set — match existing sign/rounding conventions exactly (`Math.round(x * 100) / 100` where seen).
- Test files go in `backend-next/tests/integration/*.test.ts`, run via `npx vitest run tests/integration/<file>.test.ts` from `backend-next/`, using the existing factories in `tests/factories/*.ts` and the global real-Postgres reset in `tests/setup.ts`.
- **Documentation is per-task, not batched.** Per CLAUDE.md's Documentation Rules ("must be reflected here in the same change, not as a follow-up"), any task that changes the database schema, adds/changes an API route, or establishes a new business rule must update the relevant `docs/obsidian/` page (`Database.md`, `APIs.md`, `Business-Rules.md`) **in that same task's commit(s)**, not deferred to Task 17. Task 17 is narrowed accordingly — see its brief.

## Scope note (read before starting)

Phase 1 explicitly excludes: Split/Merge/Reallocate Payment, Administrative Reversal (`change_requests` integration), bulk corrections, analytics, AI assistance, and all non-payment domains (Room Shift, Admission, Expense, Settings, Document, KYC, Reservation, Renewal handlers). These are designed in the architecture docs and deliberately deferred — do not implement them here.

**Scope correction found during research:** the design docs' "Edit Reference/Receipt" workflow assumed a receipt-upload column on `payment_groups`. No such column exists — `payment_groups` has `reference_number` and `notes` only; `payments.receipts` is an auto-generated receipt record, not an owner-editable upload. Phase 1's Edit handler therefore covers `reference_number` + `notes` only. Receipt re-attachment needs its own schema investigation and is out of scope here.

---

## File Structure

```
backend-next/
  prisma/schema.prisma                                          [modify]
  prisma/migrations/20260720120000_business_recovery_platform/
    migration.sql                                                [create]
  src/services/recovery/
    types.ts                                                      [create]
    correction-registry.ts                                        [create]
    recovery-service.ts                                            [create]
    bootstrap.ts                                                   [create]
  src/services/payments/corrections/
    payment-correction-shared.ts                                   [create]
    payment-reversal-handler.ts                                    [create]
    payment-transfer-handler.ts                                    [create]
    reference-edit-handler.ts                                      [create]
  app/api/recovery/cases/route.ts                                  [create]
  app/api/recovery/cases/[id]/route.ts                             [create]
  app/api/recovery/cases/[id]/validate/route.ts                    [create]
  app/api/recovery/cases/[id]/execute/route.ts                     [create]
  scripts/architectural-invariants-check.ts                        [modify]
  tests/integration/recovery-cases.test.ts                         [create]
  tests/integration/payment-reversal-handler.test.ts               [create]
  tests/integration/payment-transfer-handler.test.ts                [create]
  tests/integration/reference-edit-handler.test.ts                  [create]

frontend-v2/
  src/lib/queryKeys.ts                                              [modify]
  src/features/recovery/api/index.ts                                [create]
  src/features/recovery/hooks/useRecoveryCases.ts                   [create]
  src/app/components/recovery/RecoveryStatusBadge.tsx               [create]
  src/app/components/recovery/CorrectionTimeline.tsx                [create]
  src/app/components/views/RecoveryCenterView.tsx                   [create]
  src/platforms/owner/router/OwnerRoutes.tsx                        [modify]

docs/obsidian/
  Database.md, APIs.md, Features.md, Business-Rules.md, Changelog.md, Decisions.md   [modify, final task]
```

---

### Task 1: Prisma schema + migration for the correction-case platform tables

**Files:**
- Modify: `backend-next/prisma/schema.prisma`
- Create: `backend-next/prisma/migrations/20260720120000_business_recovery_platform/migration.sql`
- Test: `backend-next/tests/integration/recovery-cases.test.ts` (schema smoke test only in this task; full behavior tests come in Task 5+)

**Interfaces:**
- Produces: Prisma models `correction_cases`, `correction_case_events`; enums `RecoveryTier`, `CorrectionDomain`, `CaseStatus`. Client accessors: `prisma.correction_cases`, `prisma.correction_case_events` (no `@@map`, matching the `payments`/`payment_groups` convention).

- [ ] **Step 1: Add the new models/enums to `schema.prisma`**

Find the `model hostels` block and add one relation line to it (anywhere in its relation list, e.g. near `payment_groups payment_groups[]`):

```prisma
  correction_cases    correction_cases[]
```

Then append these new blocks anywhere after the `hostels` model (convention in this file groups related models together; add near the end of the file):

```prisma
enum RecoveryTier {
  OPERATIONAL_UNDO
  FINANCIAL_CORRECTION
  ADMINISTRATIVE_REVERSAL
}

enum CorrectionDomain {
  PAYMENTS
  ROOMS
  AGREEMENTS
  EXPENSES
  ADMISSIONS
  RENEWALS
  SETTINGS
  DOCUMENTS
  KYC
  RESERVATIONS
}

enum CaseStatus {
  DRAFT
  PREVIEW
  VALIDATED
  EXECUTING
  COMPLETED
  FAILED
  EXPIRED
  CANCELLED
}

model correction_cases {
  id               String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  hostel_id        String                   @db.Uuid
  domain           CorrectionDomain
  case_type        String
  tier             RecoveryTier
  status           CaseStatus               @default(DRAFT)
  entity_refs      Json
  reason           String
  actor_id         String                   @db.Uuid
  actor_role       String
  before_snapshot  Json
  preview_impact   Json?
  execution_result Json?
  case_detail      Json
  idempotency_key  String                   @unique
  depends_on       String[]                 @default([])
  undo_expires_at  DateTime?                @db.Timestamptz(6)
  correlation_id   String?                  @db.Uuid
  created_at       DateTime                 @default(now()) @db.Timestamptz(6)
  updated_at       DateTime?                @db.Timestamptz(6)
  hostels          hostels                  @relation(fields: [hostel_id], references: [id])
  events           correction_case_events[]

  @@index([hostel_id])
  @@index([hostel_id, status])
  @@index([status, undo_expires_at])
  @@index([case_type])
}

model correction_case_events {
  id                 String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  correction_case_id String           @db.Uuid
  event_type         String
  actor_id           String           @db.Uuid
  actor_role         String
  reason             String?
  snapshot           Json?
  ip_address         String?
  user_agent         String?
  created_at         DateTime         @default(now()) @db.Timestamptz(6)
  correction_case    correction_cases @relation(fields: [correction_case_id], references: [id])

  @@index([correction_case_id])
}
```

- [ ] **Step 2: Write the hand-authored migration SQL**

```sql
-- Business Recovery Platform: correction_cases + correction_case_events
-- Additive only; no existing tables modified.
-- See docs/business-logic/business-recovery-platform-architecture.md

CREATE TYPE "RecoveryTier" AS ENUM ('OPERATIONAL_UNDO', 'FINANCIAL_CORRECTION', 'ADMINISTRATIVE_REVERSAL');
CREATE TYPE "CorrectionDomain" AS ENUM ('PAYMENTS', 'ROOMS', 'AGREEMENTS', 'EXPENSES', 'ADMISSIONS', 'RENEWALS', 'SETTINGS', 'DOCUMENTS', 'KYC', 'RESERVATIONS');
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'PREVIEW', 'VALIDATED', 'EXECUTING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS "correction_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hostel_id" UUID NOT NULL,
  "domain" "CorrectionDomain" NOT NULL,
  "case_type" TEXT NOT NULL,
  "tier" "RecoveryTier" NOT NULL,
  "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
  "entity_refs" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "actor_id" UUID NOT NULL,
  "actor_role" TEXT NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "preview_impact" JSONB,
  "execution_result" JSONB,
  "case_detail" JSONB NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "depends_on" TEXT[] NOT NULL DEFAULT '{}',
  "undo_expires_at" TIMESTAMPTZ(6),
  "correlation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6),
  CONSTRAINT "correction_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "correction_cases_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "correction_cases_idempotency_key_key" ON "correction_cases"("idempotency_key");
CREATE INDEX IF NOT EXISTS "correction_cases_hostel_id_idx" ON "correction_cases"("hostel_id");
CREATE INDEX IF NOT EXISTS "correction_cases_hostel_id_status_idx" ON "correction_cases"("hostel_id", "status");
CREATE INDEX IF NOT EXISTS "correction_cases_status_undo_expires_at_idx" ON "correction_cases"("status", "undo_expires_at");
CREATE INDEX IF NOT EXISTS "correction_cases_case_type_idx" ON "correction_cases"("case_type");

CREATE TABLE IF NOT EXISTS "correction_case_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "correction_case_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_id" UUID NOT NULL,
  "actor_role" TEXT NOT NULL,
  "reason" TEXT,
  "snapshot" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "correction_case_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "correction_case_events_case_id_fkey" FOREIGN KEY ("correction_case_id") REFERENCES "correction_cases"("id")
);

CREATE INDEX IF NOT EXISTS "correction_case_events_case_id_idx" ON "correction_case_events"("correction_case_id");
```

- [ ] **Step 3: Apply schema to the dev and test databases and regenerate the client**

Run from `backend-next/`:
```bash
npm run prisma:push
npm run prisma:generate
```
If `.env.test`'s `DATABASE_URL_TEST` points at a different database/schema than `.env`'s `DATABASE_URL`, repeat `prisma:push` with `DATABASE_URL` temporarily set to the test value (matching however existing migrations already reached the `test` schema used by `tests/setup.ts`'s truncate logic — confirm by checking that `correction_cases` appears in `SELECT tablename FROM pg_tables WHERE schemaname = 'test'` before proceeding to Task 5's integration tests).

- [ ] **Step 4: Write and run a schema smoke test**

```ts
// backend-next/tests/integration/recovery-cases.test.ts
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
```

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v` (from `backend-next/`)
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend-next/prisma/schema.prisma backend-next/prisma/migrations/20260720120000_business_recovery_platform backend-next/tests/integration/recovery-cases.test.ts
git commit -m "feat(recovery): add correction_cases/correction_case_events schema"
```

---

### Task 2: Fix the payment-immutability invariant regex bug

**Files:**
- Modify: `backend-next/scripts/architectural-invariants-check.ts:72`
- Test: none new — this is a script, verified by running it directly (see steps)

**Interfaces:**
- Produces: a working invariant check that this whole platform's "payments never mutated" guarantee actually relies on.

- [ ] **Step 1: Confirm the bug reproduces**

Run from `backend-next/`:
```bash
grep -n "prisma\\\\.payment\\\\." scripts/architectural-invariants-check.ts
```
Expected: line 72 shows `pattern: /prisma\.payment\.(update|updateMany|upsert|delete|deleteMany)\b|tx\.payment\.(update|updateMany|upsert|delete|deleteMany)\b/,` — singular `payment`, which never matches the real accessor `payments` (plural, confirmed in Task 1 — no `@@map` on `model payments`).

- [ ] **Step 2: Fix the regex**

In `backend-next/scripts/architectural-invariants-check.ts`, change:
```ts
    pattern: /prisma\.payment\.(update|updateMany|upsert|delete|deleteMany)\b|tx\.payment\.(update|updateMany|upsert|delete|deleteMany)\b/,
```
to:
```ts
    pattern: /prisma\.payments\.(update|updateMany|upsert|delete|deleteMany)\b|tx\.payments\.(update|updateMany|upsert|delete|deleteMany)\b/,
```

- [ ] **Step 3: Run the check and confirm it now actually scans real code without new failures**

Run from `backend-next/`:
```bash
npx ts-node scripts/architectural-invariants-check.ts
```
(or `npm run check:invariants` if that's how it's wired in `package.json` — confirm the exact script name there first with `grep check:invariants package.json`)

Expected: exits 0. If it now flags an existing violation that was previously silently missed, STOP and report it — do not silently allow-list it away; that would defeat the point of this fix.

- [ ] **Step 4: Commit**

```bash
git add backend-next/scripts/architectural-invariants-check.ts
git commit -m "fix(invariants): correct payment immutability regex (singular vs plural accessor)"
```

---

### Task 3: Core platform types

**Files:**
- Create: `backend-next/src/services/recovery/types.ts`

**Interfaces:**
- Produces: `Actor`, `EntityRef`, `OperationContext`, `ImpactReport`, `PolicyResult`, `CorrectionCaseRecord<TDetail>`, `CorrectionPolicy<TDetail>`, `CorrectionHandler<TDetail>` — every later task imports from this file.

- [ ] **Step 1: Write the file (no test — pure type definitions, verified by downstream tasks' type-checking)**

```ts
// backend-next/src/services/recovery/types.ts

export type Actor = { actorId: string; actorRole: string };

export type EntityRef = { type: string; id: string };

export interface OperationContext {
  hostelId: string;
  actor: Actor;
  reason: string;
  input: Record<string, unknown>;
}

export interface ImpactReport {
  balanceChanges: { entityType: string; entityId: string; before: unknown; after: unknown }[];
  obligationChanges: { obligationId: string; before: unknown; after: unknown }[];
  ledgerEntries: { direction: "DEBIT" | "CREDIT"; reason: string; amount: number; tenantId: string }[];
  affectedReports: string[];
  notifications: { channel: string; template: string; recipient: string }[];
  warnings: string[];
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

export interface CaseDraft<TDetail = Record<string, unknown>> {
  domain: string;
  tier: string;
  entityRefs: EntityRef[];
  beforeSnapshot: unknown;
  caseDetail: TDetail;
  idempotencyKey: string;
  dependsOn?: string[];
  undoExpiresAt?: Date | null;
  correlationId?: string | null;
}

export interface CorrectionCaseRecord<TDetail = Record<string, unknown>> {
  id: string;
  hostelId: string;
  domain: string;
  caseType: string;
  tier: string;
  status: string;
  entityRefs: EntityRef[];
  reason: string;
  actorId: string;
  actorRole: string;
  beforeSnapshot: unknown;
  previewImpact: ImpactReport | null;
  executionResult: Record<string, unknown> | null;
  caseDetail: TDetail;
  idempotencyKey: string;
  dependsOn: string[];
  undoExpiresAt: Date | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface ExecutionResult {
  [key: string]: unknown;
}

export interface CorrectionPolicy<TDetail = Record<string, unknown>> {
  canPreview(ctx: OperationContext): Promise<boolean>;
  canExecute(kase: CorrectionCaseRecord<TDetail>): Promise<PolicyResult>;
  windowFor?(kase: CorrectionCaseRecord<TDetail>): Date;
}

export interface CorrectionHandler<TDetail = Record<string, unknown>> {
  caseType: string;
  domain: string;
  tier: string;
  policy: CorrectionPolicy<TDetail>;
  createCase(ctx: OperationContext): Promise<CaseDraft<TDetail>>;
  computeImpact(kase: CorrectionCaseRecord<TDetail>): Promise<ImpactReport>;
  execute(tx: any, kase: CorrectionCaseRecord<TDetail>, actor: Actor): Promise<ExecutionResult>;
  affectedEntities(kase: CorrectionCaseRecord<TDetail>): EntityRef[];
}
```

- [ ] **Step 2: Type-check**

Run from `backend-next/`: `npx tsc --noEmit src/services/recovery/types.ts` — or rely on the next task's test run to catch any type error (this file has no runtime behavior of its own).

- [ ] **Step 3: Commit**

```bash
git add backend-next/src/services/recovery/types.ts
git commit -m "feat(recovery): add core Correction Case/Handler/Policy types"
```

---

### Task 4: Self-registering correction registry

**Files:**
- Create: `backend-next/src/services/recovery/correction-registry.ts`
- Test: `backend-next/tests/integration/recovery-cases.test.ts` (extend from Task 1)

**Interfaces:**
- Consumes: `CorrectionHandler` from `./types`.
- Produces: `correctionRegistry.register(handler)`, `correctionRegistry.resolve(caseType): CorrectionHandler`, `correctionRegistry.has(caseType): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/recovery-cases.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: FAIL with "Cannot find module '@/src/services/recovery/correction-registry'".

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/recovery/correction-registry.ts
import type { CorrectionHandler } from "./types";

class CorrectionRegistry {
  private handlers = new Map<string, CorrectionHandler<any>>();

  register(handler: CorrectionHandler<any>): void {
    if (this.handlers.has(handler.caseType)) {
      throw new Error(`duplicate case_type registration: ${handler.caseType}`);
    }
    this.handlers.set(handler.caseType, handler);
  }

  resolve(caseType: string): CorrectionHandler<any> {
    const handler = this.handlers.get(caseType);
    if (!handler) {
      throw new Error(`no handler registered for case_type: ${caseType}`);
    }
    return handler;
  }

  has(caseType: string): boolean {
    return this.handlers.has(caseType);
  }
}

export const correctionRegistry = new CorrectionRegistry();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: PASS, 4 tests total (1 from Task 1 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/recovery/correction-registry.ts backend-next/tests/integration/recovery-cases.test.ts
git commit -m "feat(recovery): add self-registering correction handler registry"
```

---

### Task 5: `recovery-service.ts` — createCase + preview

**Files:**
- Create: `backend-next/src/services/recovery/recovery-service.ts`
- Test: `backend-next/tests/integration/recovery-cases.test.ts` (extend)

**Interfaces:**
- Consumes: `correctionRegistry` (Task 4), Prisma models from Task 1, types from Task 3.
- Produces: `recoveryService.createCase(caseType: string, ctx: OperationContext): Promise<CorrectionCaseRecord>`, `recoveryService.preview(caseId: string): Promise<ImpactReport>`, `recoveryService.getCase(caseId: string): Promise<CorrectionCaseRecord>`, `recoveryService.listCases(hostelId: string, filters?: {status?: string; domain?: string}): Promise<CorrectionCaseRecord[]>`. Later tasks (6, 7) add `validate`/`execute` to this same file.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/recovery-cases.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/recovery/recovery-service.ts
import { prisma } from "@/lib/db";
import { correctionRegistry } from "./correction-registry";
import type {
  Actor,
  CorrectionCaseRecord,
  ImpactReport,
  OperationContext,
} from "./types";

function toCaseRecord(row: any): CorrectionCaseRecord {
  return {
    id: row.id,
    hostelId: row.hostel_id,
    domain: row.domain,
    caseType: row.case_type,
    tier: row.tier,
    status: row.status,
    entityRefs: row.entity_refs,
    reason: row.reason,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    beforeSnapshot: row.before_snapshot,
    previewImpact: row.preview_impact,
    executionResult: row.execution_result,
    caseDetail: row.case_detail,
    idempotencyKey: row.idempotency_key,
    dependsOn: row.depends_on,
    undoExpiresAt: row.undo_expires_at,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function writeEvent(
  caseId: string,
  eventType: string,
  actor: Actor,
  reason?: string,
  snapshot?: unknown
) {
  await prisma.correction_case_events.create({
    data: {
      correction_case_id: caseId,
      event_type: eventType,
      actor_id: actor.actorId,
      actor_role: actor.actorRole,
      reason: reason ?? null,
      snapshot: (snapshot as any) ?? undefined,
    },
  });
}

class RecoveryService {
  async createCase(
    caseType: string,
    ctx: OperationContext
  ): Promise<CorrectionCaseRecord> {
    const handler = correctionRegistry.resolve(caseType);
    const draft = await handler.createCase(ctx);

    const existing = await prisma.correction_cases.findUnique({
      where: { idempotency_key: draft.idempotencyKey },
    });
    if (existing) return toCaseRecord(existing);

    const row = await prisma.correction_cases.create({
      data: {
        hostel_id: ctx.hostelId,
        domain: draft.domain as any,
        case_type: caseType,
        tier: draft.tier as any,
        status: "DRAFT",
        entity_refs: draft.entityRefs as any,
        reason: ctx.reason,
        actor_id: ctx.actor.actorId,
        actor_role: ctx.actor.actorRole,
        before_snapshot: draft.beforeSnapshot as any,
        case_detail: draft.caseDetail as any,
        idempotency_key: draft.idempotencyKey,
        depends_on: draft.dependsOn ?? [],
        undo_expires_at: draft.undoExpiresAt ?? null,
        correlation_id: draft.correlationId ?? null,
      },
    });

    await writeEvent(row.id, "CREATED", ctx.actor, ctx.reason);
    return toCaseRecord(row);
  }

  async getCase(caseId: string): Promise<CorrectionCaseRecord> {
    const row = await prisma.correction_cases.findUniqueOrThrow({ where: { id: caseId } });
    return toCaseRecord(row);
  }

  async listCases(
    hostelId: string,
    filters?: { status?: string; domain?: string }
  ): Promise<CorrectionCaseRecord[]> {
    const rows = await prisma.correction_cases.findMany({
      where: {
        hostel_id: hostelId,
        status: filters?.status as any,
        domain: filters?.domain as any,
      },
      orderBy: { created_at: "desc" },
    });
    return rows.map(toCaseRecord);
  }

  async preview(caseId: string): Promise<ImpactReport> {
    const kase = await this.getCase(caseId);
    const handler = correctionRegistry.resolve(kase.caseType);

    const impact = await handler.computeImpact(kase);

    await prisma.correction_cases.update({
      where: { id: caseId },
      data: {
        preview_impact: impact as any,
        status: kase.status === "DRAFT" ? "PREVIEW" : kase.status,
      },
    });

    await writeEvent(caseId, "PREVIEWED", { actorId: kase.actorId, actorRole: kase.actorRole });
    return impact;
  }
}

export const recoveryService = new RecoveryService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: PASS, 6 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/recovery/recovery-service.ts backend-next/tests/integration/recovery-cases.test.ts
git commit -m "feat(recovery): add recoveryService createCase + preview (idempotent)"
```

---

### Task 6: `recovery-service.ts` — validate + dependency gating

**Files:**
- Modify: `backend-next/src/services/recovery/recovery-service.ts`
- Test: `backend-next/tests/integration/recovery-cases.test.ts` (extend)

**Interfaces:**
- Produces: `recoveryService.validate(caseId: string): Promise<{ allowed: boolean; reason?: string }>` — transitions `PREVIEW → VALIDATED` on success; leaves status unchanged and writes a `BLOCKED_ON_DEPENDENCY` event if a dependency isn't `COMPLETED`.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/recovery-cases.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: FAIL — `recoveryService.validate is not a function`.

- [ ] **Step 3: Implement — add `validate` to `RecoveryService`**

Add this method inside the `RecoveryService` class in `backend-next/src/services/recovery/recovery-service.ts`, after `preview`:

```ts
  async validate(caseId: string): Promise<{ allowed: boolean; reason?: string }> {
    const kase = await this.getCase(caseId);
    const handler = correctionRegistry.resolve(kase.caseType);

    if (kase.dependsOn.length > 0) {
      const dependencies = await prisma.correction_cases.findMany({
        where: { id: { in: kase.dependsOn } },
        select: { id: true, status: true },
      });
      const unmet = dependencies.filter((d) => d.status !== "COMPLETED");
      if (unmet.length > 0) {
        await writeEvent(
          caseId,
          "BLOCKED_ON_DEPENDENCY",
          { actorId: kase.actorId, actorRole: kase.actorRole },
          `waiting on ${unmet.length} dependency case(s)`
        );
        return { allowed: false, reason: `Blocked: ${unmet.length} dependency case(s) not yet completed` };
      }
    }

    const result = await handler.policy.canExecute(kase);
    if (!result.allowed) {
      await writeEvent(
        caseId,
        "VALIDATION_REJECTED",
        { actorId: kase.actorId, actorRole: kase.actorRole },
        result.reason
      );
      return result;
    }

    await prisma.correction_cases.update({
      where: { id: caseId },
      data: { status: "VALIDATED" },
    });
    await writeEvent(caseId, "VALIDATED", { actorId: kase.actorId, actorRole: kase.actorRole });
    return { allowed: true };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: PASS, 9 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/recovery/recovery-service.ts backend-next/tests/integration/recovery-cases.test.ts
git commit -m "feat(recovery): add recoveryService.validate with policy + dependency gating"
```

---

### Task 7: `recovery-service.ts` — execute + idempotent retry + event-bus publishing

**Files:**
- Modify: `backend-next/src/services/recovery/recovery-service.ts`
- Test: `backend-next/tests/integration/recovery-cases.test.ts` (extend)

**Interfaces:**
- Consumes: `eventSystem` from `backend-next/lib/events/index.ts` (existing).
- Produces: `recoveryService.execute(caseId: string, actor: Actor): Promise<CorrectionCaseRecord>` — transitions `VALIDATED → EXECUTING → COMPLETED`, or `→ FAILED` on error (capped at 3 attempts, tracked via `executionResult.attempts`); publishes `correction_case_transitioned` on every status change via the existing event bus.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/recovery-cases.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: FAIL — `recoveryService.execute is not a function`.

- [ ] **Step 3: Implement — add `execute` to `RecoveryService`**

First, add the import at the top of `backend-next/src/services/recovery/recovery-service.ts`:
```ts
import { eventSystem } from "@/lib/events";
```

Then add this method inside the `RecoveryService` class, after `validate`:

```ts
  async execute(caseId: string, actor: Actor): Promise<CorrectionCaseRecord> {
    const kase = await this.getCase(caseId);
    const handler = correctionRegistry.resolve(kase.caseType);

    if (kase.status !== "VALIDATED" && kase.status !== "FAILED") {
      throw new Error(`case ${caseId} is not executable from status ${kase.status}`);
    }

    const priorAttempts = Number((kase.executionResult as any)?.attempts ?? 0);
    if (priorAttempts >= 3) {
      throw new Error(`case ${caseId} exceeded maximum retry attempts (3)`);
    }

    if (kase.dependsOn.length > 0) {
      const dependencies = await prisma.correction_cases.findMany({
        where: { id: { in: kase.dependsOn } },
        select: { status: true },
      });
      if (dependencies.some((d) => d.status !== "COMPLETED")) {
        throw new Error(`case ${caseId} has an unmet dependency at execute-time`);
      }
    }

    await prisma.correction_cases.update({ where: { id: caseId }, data: { status: "EXECUTING" } });
    await writeEvent(caseId, "EXECUTION_STARTED", actor, undefined, { attempt: priorAttempts + 1 });
    eventSystem.trigger("correction_case_transitioned", {
      caseId, domain: kase.domain, caseType: kase.caseType, tier: kase.tier,
      fromStatus: "VALIDATED", toStatus: "EXECUTING", actorId: actor.actorId, hostelId: kase.hostelId,
    });

    try {
      const result = await prisma.$transaction(async (tx: any) => handler.execute(tx, kase, actor));

      await prisma.correction_cases.update({
        where: { id: caseId },
        data: { status: "COMPLETED", execution_result: result as any },
      });
      await writeEvent(caseId, "EXECUTION_SUCCEEDED", actor);
      eventSystem.trigger("correction_case_transitioned", {
        caseId, domain: kase.domain, caseType: kase.caseType, tier: kase.tier,
        fromStatus: "EXECUTING", toStatus: "COMPLETED", actorId: actor.actorId, hostelId: kase.hostelId,
      });

      return this.getCase(caseId);
    } catch (err: any) {
      await prisma.correction_cases.update({
        where: { id: caseId },
        data: {
          status: "FAILED",
          execution_result: { attempts: priorAttempts + 1, error: String(err?.message ?? err) } as any,
        },
      });
      await writeEvent(caseId, "EXECUTION_FAILED", actor, String(err?.message ?? err));
      eventSystem.trigger("correction_case_transitioned", {
        caseId, domain: kase.domain, caseType: kase.caseType, tier: kase.tier,
        fromStatus: "EXECUTING", toStatus: "FAILED", actorId: actor.actorId, hostelId: kase.hostelId,
      });

      return this.getCase(caseId);
    }
  }
```

Note: `execute()` returns normally with status `FAILED` on a caught handler error (matches the test's `expect(failed.status).toBe('FAILED')` without a throw), but throws when the retry cap is hit (matches the third test's `rejects.toThrow`) — both behaviors come from the explicit `priorAttempts >= 3` guard at the top, which throws before any transaction is attempted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/recovery-cases.test.ts -v`
Expected: PASS, 12 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/recovery/recovery-service.ts backend-next/tests/integration/recovery-cases.test.ts
git commit -m "feat(recovery): add recoveryService.execute with idempotent retry (cap 3) and event publishing"
```

---

### Task 8: Shared payment-correction helper (`reverseObligationPayment`)

**Files:**
- Create: `backend-next/src/services/payments/corrections/payment-correction-shared.ts`
- Test: `backend-next/tests/integration/payment-reversal-handler.test.ts` (created here, extended in Task 9)

**Interfaces:**
- Consumes: `tenantFinancialLedgerService.debitInTx` (existing, `backend-next/src/services/payments/tenant-financial-ledger-service.ts`).
- Produces: `reverseObligationPayment(tx, params): Promise<{ reversalPaymentId: string; ledgerEntryId: string | null; newSettlementStatus: string }>` — used by both the Reverse handler (Task 9) and the Transfer handler (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
// backend-next/tests/integration/payment-reversal-handler.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';
import { reverseObligationPayment } from '@/src/services/payments/corrections/payment-correction-shared';

describe('reverseObligationPayment', () => {
  it('writes a negative reversal payment row and restores obligation outstanding, without mutating the original payment', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 10000 });
    const payment = await createTestPayment(obligation.id, 10000);

    const result = await prisma.$transaction(async (tx) => {
      return reverseObligationPayment(tx, {
        hostelId: hostel.id,
        payment,
        correctionCaseId: 'test-case-id-1',
        actorId: owner.id,
        reason: 'wrong tenant',
      });
    });

    expect(result.newSettlementStatus).toBe('UNPAID');

    const originalUnchanged = await prisma.payments.findUniqueOrThrow({ where: { id: payment.id } });
    expect(Number(originalUnchanged.amount_paid)).toBe(10000);

    const reversalRow = await prisma.payments.findUniqueOrThrow({ where: { id: result.reversalPaymentId } });
    expect(Number(reversalRow.amount_paid)).toBe(-10000);
    expect(reversalRow.obligation_id).toBe(obligation.id);

    const updatedObligation = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation.id } });
    expect(updatedObligation.settlement_status).toBe('UNPAID');

    const ledgerEntry = await prisma.tenant_financial_ledger.findUniqueOrThrow({ where: { id: result.ledgerEntryId! } });
    expect(ledgerEntry.reason).toBe('LEDGER_CORRECTION');
    expect(Number(ledgerEntry.amount)).toBe(10000);
  });

  it('is safe to call twice with the same correctionCaseId (idempotent retry)', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 5000 });
    const payment = await createTestPayment(obligation.id, 5000);

    const params = { hostelId: hostel.id, payment, correctionCaseId: 'idempotent-case-id', actorId: owner.id, reason: 'retry test' };

    const first = await prisma.$transaction(async (tx) => reverseObligationPayment(tx, params));
    const second = await prisma.$transaction(async (tx) => reverseObligationPayment(tx, params));

    expect(second.reversalPaymentId).toBe(first.reversalPaymentId);

    const reversalRows = await prisma.payments.findMany({ where: { obligation_id: obligation.id, amount_paid: { lt: 0 } } });
    expect(reversalRows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/payment-reversal-handler.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/payments/corrections/payment-correction-shared.ts
import { tenantFinancialLedgerService } from "../tenant-financial-ledger-service";

export interface ReverseObligationPaymentParams {
  hostelId: string;
  payment: {
    id: string;
    obligation_id: string;
    tenant_id: string;
    owner_id: string | null;
    amount_paid: any; // Prisma Decimal
    payment_method: string;
  };
  correctionCaseId: string;
  actorId: string;
  reason: string;
}

export interface ReverseObligationPaymentResult {
  reversalPaymentId: string;
  ledgerEntryId: string | null;
  newSettlementStatus: string;
}

/**
 * Reverses one payment's effect on its obligation without ever touching the
 * original `payments` row. Used by both the Reverse Payment and Transfer
 * Payment correction handlers. Idempotent: calling twice with the same
 * `correctionCaseId` returns the existing reversal row instead of creating
 * a second one (see idempotency_key on the reversal payment row).
 */
export async function reverseObligationPayment(
  tx: any,
  params: ReverseObligationPaymentParams
): Promise<ReverseObligationPaymentResult> {
  const { hostelId, payment, correctionCaseId, actorId, reason } = params;
  const reversalIdempotencyKey = `correction:${correctionCaseId}:reversal`;

  const existingReversal = await tx.payments.findUnique({
    where: { idempotency_key: reversalIdempotencyKey },
  });

  let reversalPaymentId: string;
  if (existingReversal) {
    reversalPaymentId = existingReversal.id;
  } else {
    await tx.$queryRaw`SELECT id FROM rent_obligations WHERE id = ${payment.obligation_id}::uuid FOR UPDATE`;

    const reversal = await tx.payments.create({
      data: {
        obligation_id: payment.obligation_id,
        tenant_id: payment.tenant_id,
        owner_id: payment.owner_id,
        amount_paid: Number(payment.amount_paid) * -1,
        payment_method: payment.payment_method,
        reference_number: `REVERSAL:${payment.id}`,
        payment_date: new Date(),
        idempotency_key: reversalIdempotencyKey,
        hostel_id: hostelId,
      },
    });
    reversalPaymentId = reversal.id;
  }

  const obligation = await tx.rent_obligations.findUniqueOrThrow({ where: { id: payment.obligation_id } });
  const allPayments = await tx.payments.findMany({
    where: { obligation_id: payment.obligation_id },
    select: { amount_paid: true },
  });
  const totalPaid = allPayments.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
  const totalDue = Number(obligation.amount);
  const newSettlementStatus = totalPaid <= 0 ? "UNPAID" : totalPaid < totalDue ? "PARTIAL" : "PAID";
  const newLegacyStatus = newSettlementStatus === "UNPAID" ? "PENDING" : newSettlementStatus;

  await tx.rent_obligations.update({
    where: { id: payment.obligation_id },
    data: {
      settlement_status: newSettlementStatus,
      status: newLegacyStatus,
      updated_at: new Date(),
    },
  });

  let ledgerEntryId: string | null = null;
  if (!existingReversal) {
    const debitResult = await tenantFinancialLedgerService.debitInTx(tx, {
      tenantId: payment.tenant_id,
      ownerId: payment.owner_id ?? "",
      createdBy: actorId,
      reason: "LEDGER_CORRECTION",
      amount: Number(payment.amount_paid),
      referenceId: correctionCaseId,
      referenceType: "CORRECTION_CASE",
      notes: reason,
    });
    ledgerEntryId = debitResult?.entry?.id ?? null;
  }

  return { reversalPaymentId, ledgerEntryId, newSettlementStatus };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/payment-reversal-handler.test.ts -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/payments/corrections/payment-correction-shared.ts backend-next/tests/integration/payment-reversal-handler.test.ts
git commit -m "feat(recovery): add shared idempotent reverseObligationPayment helper"
```

---

### Task 9: Payment Reversal handler + policy

**Files:**
- Create: `backend-next/src/services/payments/corrections/payment-reversal-handler.ts`
- Test: `backend-next/tests/integration/payment-reversal-handler.test.ts` (extend)

**Interfaces:**
- Consumes: `reverseObligationPayment` (Task 8), `CorrectionHandler`/`OperationContext`/`ImpactReport` types (Task 3), `correctionRegistry` (Task 4).
- Produces: `paymentReversalHandler: CorrectionHandler<{ paymentId: string }>` with `caseType = "PAYMENT_REVERSAL"`.

- [ ] **Step 1: Write the failing test**

Append to `backend-next/tests/integration/payment-reversal-handler.test.ts`:
```ts
import { recoveryService } from '@/src/services/recovery/recovery-service';
import { correctionRegistry } from '@/src/services/recovery/correction-registry';
import '@/src/services/payments/corrections/payment-reversal-handler'; // registers itself

describe('paymentReversalHandler (end to end via recoveryService)', () => {
  it('goes DRAFT -> PREVIEW -> VALIDATED -> COMPLETED and creates a reversal payment', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 8000 });
    const payment = await createTestPayment(obligation.id, 8000);

    expect(correctionRegistry.has('PAYMENT_REVERSAL')).toBe(true);

    const kase = await recoveryService.createCase('PAYMENT_REVERSAL', {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'recorded against wrong tenant',
      input: { paymentId: payment.id },
    });
    expect(kase.status).toBe('DRAFT');

    const impact = await recoveryService.preview(kase.id);
    expect(impact.ledgerEntries).toHaveLength(1);
    expect(impact.ledgerEntries[0].amount).toBe(8000);

    const validation = await recoveryService.validate(kase.id);
    expect(validation.allowed).toBe(true);

    const executed = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(executed.status).toBe('COMPLETED');

    const reversalRows = await prisma.payments.findMany({ where: { obligation_id: obligation.id, amount_paid: { lt: 0 } } });
    expect(reversalRows).toHaveLength(1);

    const updatedObligation = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation.id } });
    expect(updatedObligation.settlement_status).toBe('UNPAID');
  });

  it('policy refuses a second reversal case for an already-reversed payment', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 3000 });
    const payment = await createTestPayment(obligation.id, 3000);

    const first = await recoveryService.createCase('PAYMENT_REVERSAL', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x',
      input: { paymentId: payment.id },
    });
    await recoveryService.preview(first.id);
    await recoveryService.validate(first.id);
    await recoveryService.execute(first.id, { actorId: owner.id, actorRole: 'OWNER' });

    // Attempting to create+validate a second case for the SAME payment must be
    // rejected by the policy even though it's a distinct idempotency key
    // (different reason string changes nothing about idempotency_key, which is
    // keyed purely on paymentId — so this actually hits the SAME case).
    const second = await recoveryService.createCase('PAYMENT_REVERSAL', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'trying again',
      input: { paymentId: payment.id },
    });
    expect(second.id).toBe(first.id); // idempotency key collision returns the same, already-COMPLETED case

    await expect(recoveryService.validate(second.id)).resolves.toEqual(
      expect.objectContaining({ allowed: expect.any(Boolean) })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/payment-reversal-handler.test.ts -v`
Expected: FAIL — module not found / `correctionRegistry.has('PAYMENT_REVERSAL')` is `false`.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/payments/corrections/payment-reversal-handler.ts
import { prisma } from "@/lib/db";
import { correctionRegistry } from "../../recovery/correction-registry";
import { reverseObligationPayment } from "./payment-correction-shared";
import type {
  CaseDraft,
  CorrectionCaseRecord,
  CorrectionHandler,
  ImpactReport,
  OperationContext,
} from "../../recovery/types";

interface PaymentReversalDetail {
  paymentId: string;
}

async function loadPayment(paymentId: string) {
  return prisma.payments.findUniqueOrThrow({
    where: { id: paymentId },
    include: { obligation: true },
  });
}

export const paymentReversalHandler: CorrectionHandler<PaymentReversalDetail> = {
  caseType: "PAYMENT_REVERSAL",
  domain: "PAYMENTS",
  tier: "FINANCIAL_CORRECTION",

  policy: {
    canPreview: async () => true,
    canExecute: async (kase: CorrectionCaseRecord<PaymentReversalDetail>) => {
      const payment = await prisma.payments.findUnique({ where: { id: kase.caseDetail.paymentId } });
      if (!payment) return { allowed: false, reason: "Payment no longer exists" };
      return { allowed: true };
    },
  },

  async createCase(ctx: OperationContext): Promise<CaseDraft<PaymentReversalDetail>> {
    const paymentId = String(ctx.input.paymentId);
    const payment = await loadPayment(paymentId);

    return {
      domain: "PAYMENTS",
      tier: "FINANCIAL_CORRECTION",
      entityRefs: [
        { type: "payment", id: payment.id },
        { type: "obligation", id: payment.obligation_id },
      ],
      beforeSnapshot: {
        payment: { id: payment.id, amount_paid: Number(payment.amount_paid) },
        obligation: { id: payment.obligation.id, settlement_status: payment.obligation.settlement_status },
      },
      caseDetail: { paymentId: payment.id },
      // Keyed on paymentId only (not a timestamp) so a payment can only ever
      // have ONE reversal case — this is what enforces "no double-correct".
      idempotencyKey: `PAYMENT_REVERSAL:${payment.id}`,
    };
  },

  async computeImpact(kase: CorrectionCaseRecord<PaymentReversalDetail>): Promise<ImpactReport> {
    const payment = await loadPayment(kase.caseDetail.paymentId);
    const allPayments = await prisma.payments.findMany({
      where: { obligation_id: payment.obligation_id },
      select: { amount_paid: true },
    });
    const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    const outstandingBefore = Math.max(Number(payment.obligation.amount) - totalPaid, 0);
    const outstandingAfter = outstandingBefore + Number(payment.amount_paid);

    return {
      balanceChanges: [
        { entityType: "obligation", entityId: payment.obligation_id, before: { outstanding: outstandingBefore }, after: { outstanding: outstandingAfter } },
      ],
      obligationChanges: [
        { obligationId: payment.obligation_id, before: { outstanding: outstandingBefore }, after: { outstanding: outstandingAfter } },
      ],
      ledgerEntries: [
        { direction: "DEBIT", reason: "LEDGER_CORRECTION", amount: Number(payment.amount_paid), tenantId: payment.tenant_id },
      ],
      affectedReports: ["Owner Dashboard", "Tenant Statement"],
      notifications: [],
      warnings: [],
    };
  },

  async execute(tx: any, kase: CorrectionCaseRecord<PaymentReversalDetail>, actor) {
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: kase.caseDetail.paymentId } });

    const result = await reverseObligationPayment(tx, {
      hostelId: kase.hostelId,
      payment,
      correctionCaseId: kase.id,
      actorId: actor.actorId,
      reason: kase.reason,
    });

    return {
      reversalPaymentId: result.reversalPaymentId,
      ledgerEntryId: result.ledgerEntryId,
      obligationId: payment.obligation_id,
      newSettlementStatus: result.newSettlementStatus,
    };
  },

  affectedEntities(kase: CorrectionCaseRecord<PaymentReversalDetail>) {
    return kase.entityRefs;
  },
};

correctionRegistry.register(paymentReversalHandler);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/payment-reversal-handler.test.ts -v`
Expected: PASS, 4 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/payments/corrections/payment-reversal-handler.ts backend-next/tests/integration/payment-reversal-handler.test.ts
git commit -m "feat(recovery): add Payment Reversal correction handler"
```

---

### Task 10: Payment Transfer handler + policy

**Files:**
- Create: `backend-next/src/services/payments/corrections/payment-transfer-handler.ts`
- Test: `backend-next/tests/integration/payment-transfer-handler.test.ts`

**Interfaces:**
- Consumes: `reverseObligationPayment` (Task 8), `buildSettlementPlan`/`toObligationSnapshot` (`backend-next/src/services/payments/settlement-planner.ts`, existing), `executePlanInTx` (`backend-next/src/services/payments/settlement-engine.ts`, existing).
- Produces: `paymentTransferHandler: CorrectionHandler<{ paymentId: string; toTenantId: string }>` with `caseType = "PAYMENT_TRANSFER"`.

- [ ] **Step 1: Write the failing test**

```ts
// backend-next/tests/integration/payment-transfer-handler.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';
import { recoveryService } from '@/src/services/recovery/recovery-service';
import { correctionRegistry } from '@/src/services/recovery/correction-registry';
import '@/src/services/payments/corrections/payment-transfer-handler'; // registers itself

describe('paymentTransferHandler (end to end via recoveryService)', () => {
  it('reverses the payment on tenant A and allocates a new forward payment to tenant B', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenantA = await createTestTenant(owner.id, hostel.id);
    const tenantB = await createTestTenant(owner.id, hostel.id);

    const obligationA = await createTestObligation(tenantA.id, owner.id, hostel.id, { amount: 5000 });
    const payment = await createTestPayment(obligationA.id, 5000);
    const obligationB = await createTestObligation(tenantB.id, owner.id, hostel.id, { amount: 5000 });

    expect(correctionRegistry.has('PAYMENT_TRANSFER')).toBe(true);

    const kase = await recoveryService.createCase('PAYMENT_TRANSFER', {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'recorded against wrong tenant',
      input: { paymentId: payment.id, toTenantId: tenantB.id },
    });

    const impact = await recoveryService.preview(kase.id);
    expect(impact.ledgerEntries[0].tenantId).toBe(tenantA.id);

    await recoveryService.validate(kase.id);
    const executed = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(executed.status).toBe('COMPLETED');

    const reversalOnA = await prisma.payments.findMany({ where: { obligation_id: obligationA.id, amount_paid: { lt: 0 } } });
    expect(reversalOnA).toHaveLength(1);

    const forwardOnB = await prisma.payments.findMany({ where: { obligation_id: obligationB.id, amount_paid: { gt: 0 } } });
    expect(forwardOnB.length).toBeGreaterThan(0);
    const totalOnB = forwardOnB.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    expect(totalOnB).toBe(5000);
  });

  it('policy refuses a transfer to a tenant in a different hostel', async () => {
    const owner = await createTestOwner();
    const hostelA = await createTestHostel(owner.id);
    const hostelB = await createTestHostel(owner.id);
    const tenantA = await createTestTenant(owner.id, hostelA.id);
    const tenantB = await createTestTenant(owner.id, hostelB.id);

    const obligationA = await createTestObligation(tenantA.id, owner.id, hostelA.id, { amount: 2000 });
    const payment = await createTestPayment(obligationA.id, 2000);

    const kase = await recoveryService.createCase('PAYMENT_TRANSFER', {
      hostelId: hostelA.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'cross-hostel attempt',
      input: { paymentId: payment.id, toTenantId: tenantB.id },
    });
    await recoveryService.preview(kase.id);

    const validation = await recoveryService.validate(kase.id);
    expect(validation.allowed).toBe(false);
    expect(validation.reason).toMatch(/hostel/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/payment-transfer-handler.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/payments/corrections/payment-transfer-handler.ts
import { prisma } from "@/lib/db";
import { correctionRegistry } from "../../recovery/correction-registry";
import { reverseObligationPayment } from "./payment-correction-shared";
import { buildSettlementPlan, toObligationSnapshot } from "../settlement-planner";
import { executePlanInTx } from "../settlement-engine";
import type {
  CaseDraft,
  CorrectionCaseRecord,
  CorrectionHandler,
  ImpactReport,
  OperationContext,
} from "../../recovery/types";

interface PaymentTransferDetail {
  paymentId: string;
  toTenantId: string;
}

async function loadPayment(paymentId: string) {
  return prisma.payments.findUniqueOrThrow({
    where: { id: paymentId },
    include: { obligation: true, tenants: true },
  });
}

async function buildForwardPlan(toTenantId: string, amountRupees: number) {
  const openObligations = await prisma.rent_obligations.findMany({
    where: { tenant_id: toTenantId, lifecycle_status: "ACTIVE" },
    include: { payments: { select: { amount_paid: true } } },
  });
  const snapshots = openObligations.map((ob) =>
    toObligationSnapshot({
      id: ob.id,
      obligation_type: ob.obligation_type,
      amount: ob.amount,
      due_date: ob.due_date,
      rent_month: ob.rent_month,
      owner_id: ob.owner_id ?? "",
      payments: ob.payments,
      status: ob.status,
    })
  );
  return buildSettlementPlan(snapshots, amountRupees, { allow_partial: true, minimum_amount: 0 });
}

export const paymentTransferHandler: CorrectionHandler<PaymentTransferDetail> = {
  caseType: "PAYMENT_TRANSFER",
  domain: "PAYMENTS",
  tier: "FINANCIAL_CORRECTION",

  policy: {
    canPreview: async () => true,
    canExecute: async (kase: CorrectionCaseRecord<PaymentTransferDetail>) => {
      const payment = await prisma.payments.findUnique({ where: { id: kase.caseDetail.paymentId } });
      if (!payment) return { allowed: false, reason: "Payment no longer exists" };

      const toTenant = await prisma.tenants.findUnique({ where: { id: kase.caseDetail.toTenantId } });
      if (!toTenant) return { allowed: false, reason: "Target tenant no longer exists" };
      if (toTenant.hostel_id !== kase.hostelId) {
        return { allowed: false, reason: "Target tenant belongs to a different hostel" };
      }

      const plan = await buildForwardPlan(kase.caseDetail.toTenantId, Number(payment.amount_paid));
      if (!plan.payment_accepted) {
        return { allowed: false, reason: `Target tenant cannot accept this amount: ${plan.rejection_reason}` };
      }
      return { allowed: true };
    },
  },

  async createCase(ctx: OperationContext): Promise<CaseDraft<PaymentTransferDetail>> {
    const paymentId = String(ctx.input.paymentId);
    const toTenantId = String(ctx.input.toTenantId);
    const payment = await loadPayment(paymentId);

    return {
      domain: "PAYMENTS",
      tier: "FINANCIAL_CORRECTION",
      entityRefs: [
        { type: "payment", id: payment.id },
        { type: "tenant", id: payment.tenant_id },
        { type: "tenant", id: toTenantId },
      ],
      beforeSnapshot: {
        payment: { id: payment.id, amount_paid: Number(payment.amount_paid) },
        fromTenantId: payment.tenant_id,
        fromObligationId: payment.obligation_id,
      },
      caseDetail: { paymentId: payment.id, toTenantId },
      idempotencyKey: `PAYMENT_TRANSFER:${payment.id}`,
    };
  },

  async computeImpact(kase: CorrectionCaseRecord<PaymentTransferDetail>): Promise<ImpactReport> {
    const payment = await loadPayment(kase.caseDetail.paymentId);
    const plan = await buildForwardPlan(kase.caseDetail.toTenantId, Number(payment.amount_paid));

    return {
      balanceChanges: [
        { entityType: "obligation", entityId: payment.obligation_id, before: { restored: false }, after: { restored: true } },
        ...plan.allocations
          .filter((a) => a.allocated > 0)
          .map((a) => ({ entityType: "obligation", entityId: a.obligation_id, before: { allocated: 0 }, after: { allocated: a.allocated } })),
      ],
      obligationChanges: [],
      ledgerEntries: [
        { direction: "DEBIT", reason: "LEDGER_CORRECTION", amount: Number(payment.amount_paid), tenantId: payment.tenant_id },
      ],
      affectedReports: ["Owner Dashboard", "Tenant Statement"],
      notifications: [],
      warnings: plan.payment_accepted ? [] : [String(plan.rejection_reason)],
    };
  },

  async execute(tx: any, kase: CorrectionCaseRecord<PaymentTransferDetail>, actor) {
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: kase.caseDetail.paymentId } });

    const reversal = await reverseObligationPayment(tx, {
      hostelId: kase.hostelId,
      payment,
      correctionCaseId: kase.id,
      actorId: actor.actorId,
      reason: kase.reason,
    });

    const openObligations = await tx.rent_obligations.findMany({
      where: { tenant_id: kase.caseDetail.toTenantId, lifecycle_status: "ACTIVE" },
      include: { payments: { select: { amount_paid: true } } },
    });
    const snapshots = openObligations.map((ob: any) =>
      toObligationSnapshot({
        id: ob.id, obligation_type: ob.obligation_type, amount: ob.amount, due_date: ob.due_date,
        rent_month: ob.rent_month, owner_id: ob.owner_id ?? "", payments: ob.payments, status: ob.status,
      })
    );
    const plan = buildSettlementPlan(snapshots, Number(payment.amount_paid), { allow_partial: true, minimum_amount: 0 });

    const settlement = await executePlanInTx(tx, plan as any, {
      hostelId: kase.hostelId,
      tenantId: kase.caseDetail.toTenantId,
      amountPaid: Number(payment.amount_paid),
      paymentMethod: payment.payment_method,
      referenceNumber: `TRANSFER:${payment.id}`,
      paymentDate: new Date(),
      idempotencyKey: `correction:${kase.id}:forward`,
      userId: actor.actorId,
      fundingSource: "NEW_PAYMENT",
    });

    return {
      reversalPaymentId: reversal.reversalPaymentId,
      forwardPaymentGroupId: settlement.paymentGroupId,
      forwardObligationIds: settlement.updatedObligationIds,
      fromObligationId: payment.obligation_id,
    };
  },

  affectedEntities(kase: CorrectionCaseRecord<PaymentTransferDetail>) {
    return kase.entityRefs;
  },
};

correctionRegistry.register(paymentTransferHandler);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/payment-transfer-handler.test.ts -v`
Expected: PASS, 2 tests total.

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/payments/corrections/payment-transfer-handler.ts backend-next/tests/integration/payment-transfer-handler.test.ts
git commit -m "feat(recovery): add Payment Transfer correction handler (reuses settlement-planner/engine)"
```

---

### Task 11: Edit Reference/Notes handler + policy

**Files:**
- Create: `backend-next/src/services/payments/corrections/reference-edit-handler.ts`
- Test: `backend-next/tests/integration/reference-edit-handler.test.ts`

**Interfaces:**
- Produces: `referenceEditHandler: CorrectionHandler<{ paymentGroupId: string; referenceNumber?: string; notes?: string }>` with `caseType = "PAYMENT_REFERENCE_EDIT"`.

- [ ] **Step 1: Write the failing test**

```ts
// backend-next/tests/integration/reference-edit-handler.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { recoveryService } from '@/src/services/recovery/recovery-service';
import { correctionRegistry } from '@/src/services/recovery/correction-registry';
import '@/src/services/payments/corrections/reference-edit-handler'; // registers itself

describe('referenceEditHandler (end to end via recoveryService)', () => {
  it('updates payment_groups.reference_number and notes, and records the edit as an audited case', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const group = await prisma.payment_groups.create({
      data: {
        tenant_id: tenant.id, owner_id: owner.id, hostel_id: hostel.id,
        total_amount: 5000, method: 'UPI', reference_number: 'OLD-REF-123',
      },
    });

    expect(correctionRegistry.has('PAYMENT_REFERENCE_EDIT')).toBe(true);

    const kase = await recoveryService.createCase('PAYMENT_REFERENCE_EDIT', {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'owner typo\'d the UTR',
      input: { paymentGroupId: group.id, referenceNumber: 'NEW-REF-456', notes: 'corrected UTR' },
    });

    await recoveryService.preview(kase.id);
    await recoveryService.validate(kase.id);
    const executed = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(executed.status).toBe('COMPLETED');

    const updated = await prisma.payment_groups.findUniqueOrThrow({ where: { id: group.id } });
    expect(updated.reference_number).toBe('NEW-REF-456');
    expect(updated.notes).toBe('corrected UTR');

    const events = await prisma.correction_case_events.findMany({ where: { correction_case_id: kase.id } });
    expect(events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['CREATED', 'PREVIEWED', 'VALIDATED', 'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED'])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/reference-edit-handler.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend-next/src/services/payments/corrections/reference-edit-handler.ts
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { correctionRegistry } from "../../recovery/correction-registry";
import type {
  CaseDraft,
  CorrectionCaseRecord,
  CorrectionHandler,
  ImpactReport,
  OperationContext,
} from "../../recovery/types";

interface ReferenceEditDetail {
  paymentGroupId: string;
  referenceNumber?: string;
  notes?: string;
}

export const referenceEditHandler: CorrectionHandler<ReferenceEditDetail> = {
  caseType: "PAYMENT_REFERENCE_EDIT",
  domain: "PAYMENTS",
  tier: "FINANCIAL_CORRECTION",

  policy: {
    canPreview: async () => true,
    canExecute: async (kase: CorrectionCaseRecord<ReferenceEditDetail>) => {
      const group = await prisma.payment_groups.findUnique({ where: { id: kase.caseDetail.paymentGroupId } });
      if (!group) return { allowed: false, reason: "Payment group no longer exists" };
      if (group.hostel_id !== kase.hostelId) return { allowed: false, reason: "Payment group belongs to a different hostel" };
      return { allowed: true };
    },
  },

  async createCase(ctx: OperationContext): Promise<CaseDraft<ReferenceEditDetail>> {
    const paymentGroupId = String(ctx.input.paymentGroupId);
    const group = await prisma.payment_groups.findUniqueOrThrow({ where: { id: paymentGroupId } });

    return {
      domain: "PAYMENTS",
      tier: "FINANCIAL_CORRECTION",
      entityRefs: [{ type: "payment_group", id: group.id }],
      beforeSnapshot: { reference_number: group.reference_number, notes: group.notes },
      caseDetail: {
        paymentGroupId: group.id,
        referenceNumber: ctx.input.referenceNumber as string | undefined,
        notes: ctx.input.notes as string | undefined,
      },
      // Each edit is its own case (unlike Reverse/Transfer, edits aren't one-shot-per-entity),
      // so the idempotency key includes a random component generated once per request —
      // it only dedupes a literal double-submit of the SAME request, not repeat edits over time.
      idempotencyKey: `PAYMENT_REFERENCE_EDIT:${group.id}:${crypto.randomUUID()}`,
    };
  },

  async computeImpact(kase: CorrectionCaseRecord<ReferenceEditDetail>): Promise<ImpactReport> {
    const group = await prisma.payment_groups.findUniqueOrThrow({ where: { id: kase.caseDetail.paymentGroupId } });
    return {
      balanceChanges: [],
      obligationChanges: [],
      ledgerEntries: [],
      affectedReports: ["Owner Dashboard"],
      notifications: [],
      warnings: [],
    };
  },

  async execute(tx: any, kase: CorrectionCaseRecord<ReferenceEditDetail>) {
    const data: Record<string, unknown> = { updated_at: new Date() };
    if (kase.caseDetail.referenceNumber !== undefined) data.reference_number = kase.caseDetail.referenceNumber;
    if (kase.caseDetail.notes !== undefined) data.notes = kase.caseDetail.notes;

    await tx.payment_groups.update({ where: { id: kase.caseDetail.paymentGroupId }, data });

    return { paymentGroupId: kase.caseDetail.paymentGroupId };
  },

  affectedEntities(kase: CorrectionCaseRecord<ReferenceEditDetail>) {
    return kase.entityRefs;
  },
};

correctionRegistry.register(referenceEditHandler);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/reference-edit-handler.test.ts -v`
Expected: PASS, 1 test.

- [ ] **Step 5: Update `docs/obsidian/Business-Rules.md` and `docs/obsidian/Changelog.md`**

This is the last of the three Phase 1 handler tasks, so the correction-case business rules are now fully formed — document them per CLAUDE.md's Documentation Rules (business-rule changes must be documented in the same change). In `docs/obsidian/Business-Rules.md`, add a section covering: payments are never mutated — corrections are always new reversal/forward rows; one reversal case per payment enforced via a deterministic `idempotency_key` (`PAYMENT_REVERSAL:<paymentId>` / `PAYMENT_TRANSFER:<paymentId>`); cross-hostel payment transfers are blocked by policy; execution retries are capped at 3 attempts before a case is permanently `FAILED`; Edit Reference/Notes only touches `payment_groups.reference_number`/`notes`, never `payments`. Add a matching bullet to `docs/obsidian/Changelog.md` under `## [Unreleased]` → `### Added` summarizing the three handlers shipped in this task group.

- [ ] **Step 6: Commit**

```bash
git add backend-next/src/services/payments/corrections/reference-edit-handler.ts backend-next/tests/integration/reference-edit-handler.test.ts docs/obsidian/Business-Rules.md docs/obsidian/Changelog.md
git commit -m "feat(recovery): add Edit Reference/Notes correction handler; document correction-case business rules"
```

---

### Task 12: Bootstrap self-registration

**Files:**
- Create: `backend-next/src/services/recovery/bootstrap.ts`
- Modify: any single file guaranteed to load at server start — use `backend-next/instrumentation.ts` if it exists, otherwise `backend-next/middleware.ts` (check which exists first with `ls backend-next/instrumentation.ts backend-next/middleware.ts`)

**Interfaces:**
- Consumes: the three handler modules from Tasks 9–11 (each already self-registers via a top-level `correctionRegistry.register(...)` call at module load, per Tasks 9/10/11's last line) — `bootstrap.ts` exists purely to guarantee those modules actually get `import`-ed somewhere in the server's startup path, since a module that's never imported never runs its top-level code.

- [ ] **Step 1: Check which startup hook file exists**

Run: `ls backend-next/instrumentation.ts backend-next/middleware.ts 2>/dev/null`

- [ ] **Step 2: Write `bootstrap.ts`**

```ts
// backend-next/src/services/recovery/bootstrap.ts
// Imported once for side effects — each import below registers its handler
// with correctionRegistry as a side effect of module load (see the last line
// of each handler file). Adding a new Phase 2+ handler means: write the
// handler file, add one import line here. No other platform file changes.
import "../payments/corrections/payment-reversal-handler";
import "../payments/corrections/payment-transfer-handler";
import "../payments/corrections/reference-edit-handler";
```

- [ ] **Step 3: Wire it into whichever startup file exists**

If `backend-next/instrumentation.ts` exists, add near the top of its `register()` function:
```ts
import "@/src/services/recovery/bootstrap";
```

If it does NOT exist (Next.js instrumentation hook not in use in this repo), instead import it at the top of `backend-next/app/api/recovery/cases/route.ts` (created in Task 13) — since that's the first route in the new feature and Next.js route modules are loaded lazily per-request but only once per server lifetime, this still guarantees registration happens before any recovery API call is served. Note which approach was used in this task's commit message.

- [ ] **Step 4: Verify registration happens by running the full recovery test suite**

Run from `backend-next/`:
```bash
npx vitest run tests/integration/recovery-cases.test.ts tests/integration/payment-reversal-handler.test.ts tests/integration/payment-transfer-handler.test.ts tests/integration/reference-edit-handler.test.ts -v
```
Expected: all PASS (these tests already import the handler modules directly, so this mainly confirms no import-cycle or path error was introduced).

- [ ] **Step 5: Commit**

```bash
git add backend-next/src/services/recovery/bootstrap.ts
git commit -m "feat(recovery): add self-registration bootstrap for Phase 1 handlers"
```

---

### Task 13: API routes

**Files:**
- Create: `backend-next/app/api/recovery/cases/route.ts`
- Create: `backend-next/app/api/recovery/cases/[id]/route.ts`
- Create: `backend-next/app/api/recovery/cases/[id]/validate/route.ts`
- Create: `backend-next/app/api/recovery/cases/[id]/execute/route.ts`
- Test: `backend-next/tests/integration/recovery-cases-api.test.ts`

**Interfaces:**
- Consumes: `resolveOwnerScope` (`backend-next/lib/auth/resolve-operational-scope.ts`, existing), `getSession`/`apiResponse`/`apiError` (`backend-next/lib/auth.ts`, existing), `recoveryService` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// backend-next/tests/integration/recovery-cases-api.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createCase } from '@/app/api/recovery/cases/route';
import { GET as getCase } from '@/app/api/recovery/cases/[id]/route';
import { POST as validateCase } from '@/app/api/recovery/cases/[id]/validate/route';
import { POST as executeCase } from '@/app/api/recovery/cases/[id]/execute/route';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';
import { authService } from '@/lib/services/auth-service';

vi.mock('@/lib/services/auth-service', () => ({ authService: { getCurrentUser: vi.fn() } }));
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<any>('@/lib/auth');
  return actual;
});

function ownerSession(ownerId: string) {
  return { sub: ownerId, role: 'OWNER', owner_id: ownerId };
}

describe('Recovery API routes', () => {
  it('creates, validates, and executes a PAYMENT_REVERSAL case end to end over HTTP handlers', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 4000 });
    const payment = await createTestPayment(obligation.id, 4000);

    const createReq = new NextRequest('http://localhost/api/recovery/cases', {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        caseType: 'PAYMENT_REVERSAL',
        reason: 'api test reversal',
        input: { paymentId: payment.id },
      }),
      headers: { 'x-test-session': JSON.stringify(ownerSession(owner.id)) },
    });
    const createRes = await createCase(createReq);
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()).data;
    expect(created.status).toBe('PREVIEW'); // route combines create+preview

    const validateReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}/validate`, {
      method: 'POST',
      headers: { 'x-test-session': JSON.stringify(ownerSession(owner.id)) },
    });
    const validateRes = await validateCase(validateReq, { params: { id: created.id } });
    expect(validateRes.status).toBe(200);

    const executeReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}/execute`, {
      method: 'POST',
      headers: { 'x-test-session': JSON.stringify(ownerSession(owner.id)) },
    });
    const executeRes = await executeCase(executeReq, { params: { id: created.id } });
    expect(executeRes.status).toBe(200);
    const executed = (await executeRes.json()).data;
    expect(executed.status).toBe('COMPLETED');

    const getReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}?hostelId=${hostel.id}`);
    const getRes = await getCase(getReq, { params: { id: created.id } });
    const detail = (await getRes.json()).data;
    expect(detail.status).toBe('COMPLETED');
  });
});
```

Note: this test assumes `getSession` reads a test-only `x-test-session` header — check `backend-next/lib/auth.ts`'s actual `getSession` implementation first (`grep -n "export async function getSession" backend-next/lib/auth.ts`) and adapt the test's session-injection mechanism to whatever pattern other route tests in this repo already use (the `tests/integration/payments.test.ts` file from the research pass mocks `authService.getCurrentUser` instead — mirror that exact mechanism rather than inventing a new header-based one if `getSession` doesn't support it).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/recovery-cases-api.test.ts -v`
Expected: FAIL — route modules don't exist yet.

- [ ] **Step 3: Implement the four route files**

```ts
// backend-next/app/api/recovery/cases/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";
import "@/src/services/recovery/bootstrap";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }
  const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;
  if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);

  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    const status = req.nextUrl.searchParams.get("status") || undefined;
    const domain = req.nextUrl.searchParams.get("domain") || undefined;
    const cases = await recoveryService.listCases(hostelId, { status, domain });
    return apiResponse(cases);
  } catch (error: any) {
    return apiError(error.message || "Failed to list recovery cases", "INTERNAL_ERROR", 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json();
    const { hostelId, caseType, reason, input } = body;
    if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
    if (!caseType) return apiError("caseType is required", "BAD_REQUEST", 400);
    if (!reason) return apiError("reason is required", "BAD_REQUEST", 400);

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const kase = await recoveryService.createCase(caseType, {
      hostelId,
      actor: { actorId: scope.actor_id, actorRole: "OWNER" },
      reason,
      input: input ?? {},
    });
    await recoveryService.preview(kase.id);
    const withPreview = await recoveryService.getCase(kase.id);
    return apiResponse(withPreview);
  } catch (error: any) {
    return apiError(error.message || "Failed to create recovery case", "INTERNAL_ERROR", 500);
  }
}
```

```ts
// backend-next/app/api/recovery/cases/[id]/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const kase = await recoveryService.getCase(params.id);
    await requireHostelBelongsToOwner(scope.owner_id, kase.hostelId);

    const events = await prisma.correction_case_events.findMany({
      where: { correction_case_id: params.id },
      orderBy: { created_at: "asc" },
    });

    return apiResponse({ ...kase, events });
  } catch (error: any) {
    if (error?.message?.includes("NOT_FOUND") || error?.code === "P2025") {
      return apiError("Case not found", "NOT_FOUND", 404);
    }
    return apiError(error.message || "Failed to fetch recovery case", "INTERNAL_ERROR", 500);
  }
}
```

```ts
// backend-next/app/api/recovery/cases/[id]/validate/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const kase = await recoveryService.getCase(params.id);
    await requireHostelBelongsToOwner(scope.owner_id, kase.hostelId);

    const result = await recoveryService.validate(params.id);
    if (!result.allowed) {
      return apiError(result.reason || "Case cannot be validated", "VALIDATION_REJECTED", 422);
    }
    return apiResponse(await recoveryService.getCase(params.id));
  } catch (error: any) {
    return apiError(error.message || "Failed to validate recovery case", "INTERNAL_ERROR", 500);
  }
}
```

```ts
// backend-next/app/api/recovery/cases/[id]/execute/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const kase = await recoveryService.getCase(params.id);
    await requireHostelBelongsToOwner(scope.owner_id, kase.hostelId);

    const result = await recoveryService.execute(params.id, { actorId: scope.actor_id, actorRole: "OWNER" });
    return apiResponse(result);
  } catch (error: any) {
    return apiError(error.message || "Failed to execute recovery case", "INTERNAL_ERROR", 500);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/recovery-cases-api.test.ts -v`
Expected: PASS. Adjust the auth-mocking mechanism in the test (per the Step 1 note) to match whatever `getSession`/`authService` actually look like — do not proceed past this step with a skipped/pending test.

- [ ] **Step 5: Update `docs/obsidian/APIs.md`**

Per CLAUDE.md's Documentation Rules (API changes documented in the same change), add a new "Recovery / Corrections" section listing the four routes: `GET /api/recovery/cases` (list, query params `hostelId` required, `status`/`domain` optional), `POST /api/recovery/cases` (create + auto-preview, body `{hostelId, caseType, reason, input}`), `GET /api/recovery/cases/:id` (detail incl. events), `POST /api/recovery/cases/:id/validate`, `POST /api/recovery/cases/:id/execute` (also serves as retry when `status = FAILED`) — note auth requirement (`OWNER`/`ADMIN` via `resolveOwnerScope`) for all five, matching the file's existing per-route documentation format. Add a matching bullet to `docs/obsidian/Changelog.md` under `## [Unreleased]` → `### Added`.

- [ ] **Step 6: Commit**

```bash
git add backend-next/app/api/recovery backend-next/tests/integration/recovery-cases-api.test.ts docs/obsidian/APIs.md docs/obsidian/Changelog.md
git commit -m "feat(recovery): add /api/recovery/cases routes (list, create+preview, validate, execute); document in APIs.md"
```

---

### Task 14: Frontend — query keys, API wrapper, hooks

**Files:**
- Modify: `frontend-v2/src/lib/queryKeys.ts`
- Create: `frontend-v2/src/features/recovery/api/index.ts`
- Create: `frontend-v2/src/features/recovery/hooks/useRecoveryCases.ts`

**Interfaces:**
- Consumes: `api` from `@lib/api-client` (existing).
- Produces: `queryKeys.recovery.{all,list,detail}`, `recoveryService.{list,create,validate,execute,getById}`, hooks `useRecoveryCases(hostelId, filters?)`, `useRecoveryCaseDetail(caseId)`, `useCreateRecoveryCase()`, `useValidateRecoveryCase()`, `useExecuteRecoveryCase()`.

- [ ] **Step 1: Add the `recovery` namespace to `queryKeys.ts`**

In `frontend-v2/src/lib/queryKeys.ts`, add after the `expenses` block:
```ts
  recovery: {
    all: (hostelId: string) => hostelKey(hostelId, 'recovery'),
    list: (hostelId: string, filters?: object) => hostelKey(hostelId, 'recovery', 'list', filters ?? {}),
    detail: (hostelId: string, id: string) => hostelKey(hostelId, 'recovery', 'detail', id),
  },
```

- [ ] **Step 2: Write the API wrapper**

```ts
// frontend-v2/src/features/recovery/api/index.ts
import api from '@lib/api-client';

const unwrap = (response: any) => {
  if (response.data?.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
};

export interface RecoveryCaseSummary {
  id: string;
  hostelId: string;
  domain: string;
  caseType: string;
  tier: string;
  status: string;
  reason: string;
  actorId: string;
  actorRole: string;
  previewImpact: {
    balanceChanges: { entityType: string; entityId: string; before: unknown; after: unknown }[];
    ledgerEntries: { direction: string; reason: string; amount: number; tenantId: string }[];
    affectedReports: string[];
    warnings: string[];
  } | null;
  executionResult: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface RecoveryCaseDetail extends RecoveryCaseSummary {
  events: { id: string; event_type: string; actor_id: string; actor_role: string; reason: string | null; created_at: string }[];
}

export interface CreateRecoveryCaseInput {
  hostelId: string;
  caseType: 'PAYMENT_REVERSAL' | 'PAYMENT_TRANSFER' | 'PAYMENT_REFERENCE_EDIT';
  reason: string;
  input: Record<string, unknown>;
}

export const recoveryService = {
  list: async (hostelId: string, filters: { status?: string; domain?: string } = {}) => {
    const response = await api.get('/recovery/cases', { params: { hostelId, ...filters } });
    return unwrap(response) as RecoveryCaseSummary[];
  },
  getById: async (id: string, hostelId: string) => {
    const response = await api.get(`/recovery/cases/${id}`, { params: { hostelId } });
    return unwrap(response) as RecoveryCaseDetail;
  },
  create: async (payload: CreateRecoveryCaseInput) => {
    const response = await api.post('/recovery/cases', payload);
    return unwrap(response) as RecoveryCaseSummary;
  },
  validate: async (id: string) => {
    const response = await api.post(`/recovery/cases/${id}/validate`);
    return unwrap(response) as RecoveryCaseSummary;
  },
  execute: async (id: string) => {
    const response = await api.post(`/recovery/cases/${id}/execute`);
    return unwrap(response) as RecoveryCaseSummary;
  },
};
```

- [ ] **Step 3: Write the hooks**

```ts
// frontend-v2/src/features/recovery/hooks/useRecoveryCases.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { recoveryService, type CreateRecoveryCaseInput } from '../api';

export function useRecoveryCases(hostelId: string, filters: { status?: string; domain?: string } = {}) {
  return useQuery({
    queryKey: [...queryKeys.recovery.list(hostelId, filters)],
    queryFn: () => recoveryService.list(hostelId, filters),
    enabled: Boolean(hostelId),
    staleTime: 15_000,
  });
}

export function useRecoveryCaseDetail(hostelId: string, caseId: string) {
  return useQuery({
    queryKey: [...queryKeys.recovery.detail(hostelId, caseId)],
    queryFn: () => recoveryService.getById(caseId, hostelId),
    enabled: Boolean(hostelId) && Boolean(caseId),
  });
}

export function useCreateRecoveryCase(hostelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRecoveryCaseInput) => recoveryService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recovery.all(hostelId) });
    },
  });
}

export function useValidateRecoveryCase(hostelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => recoveryService.validate(caseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recovery.all(hostelId) });
    },
  });
}

export function useExecuteRecoveryCase(hostelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => recoveryService.execute(caseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recovery.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all(hostelId) });
    },
  });
}
```

- [ ] **Step 4: Verify the architecture check still passes**

Run from `frontend-v2/`: `npm run check:architecture`
Expected: exits 0 — the new files import `api` from `@lib/api-client` only, no raw `fetch`/`axios`.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/lib/queryKeys.ts frontend-v2/src/features/recovery
git commit -m "feat(recovery): add frontend api wrapper, query keys, and hooks for Recovery Center"
```

---

### Task 15: `RecoveryStatusBadge` + `CorrectionTimeline` components

**Files:**
- Create: `frontend-v2/src/app/components/recovery/RecoveryStatusBadge.tsx`
- Create: `frontend-v2/src/app/components/recovery/CorrectionTimeline.tsx`

**Interfaces:**
- Consumes: `cn` from `../ui/utils` (existing, used by `HostelStatusBadge.tsx`); `RecoveryCaseDetail` type from `@features/recovery/api`.
- Produces: `<RecoveryStatusBadge status={...} />`, `<CorrectionTimeline events={...} />` — both consumed by `RecoveryCenterView` in Task 16.

- [ ] **Step 1: Write `RecoveryStatusBadge`**

```tsx
// frontend-v2/src/app/components/recovery/RecoveryStatusBadge.tsx
import { cn } from '../ui/utils';

export type RecoveryCaseStatus =
  | 'DRAFT' | 'PREVIEW' | 'VALIDATED' | 'EXECUTING'
  | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

const STATUS_CONFIG: Record<RecoveryCaseStatus, { label: string; dot: string; text: string; bg: string }> = {
  DRAFT: { label: 'Draft', dot: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800/40' },
  PREVIEW: { label: 'Preview Ready', dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-50 dark:bg-sky-900/30' },
  VALIDATED: { label: 'Ready to Execute', dot: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-900/30' },
  EXECUTING: { label: 'Executing', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/30' },
  COMPLETED: { label: 'Completed', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
  FAILED: { label: 'Failed — retry available', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-900/30' },
  EXPIRED: { label: 'Expired', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800/40' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800/40' },
};

interface RecoveryStatusBadgeProps {
  status: RecoveryCaseStatus;
  className?: string;
}

export function RecoveryStatusBadge({ status, className }: RecoveryStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.DRAFT;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
      config.bg, config.text, className
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', config.dot)} />
      {config.label}
    </span>
  );
}
```

- [ ] **Step 2: Write `CorrectionTimeline`**

```tsx
// frontend-v2/src/app/components/recovery/CorrectionTimeline.tsx
interface TimelineEvent {
  id: string;
  event_type: string;
  actor_id: string;
  actor_role: string;
  reason: string | null;
  created_at: string;
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Case Created',
  PREVIEWED: 'Preview Computed',
  VALIDATED: 'Validated',
  VALIDATION_REJECTED: 'Validation Rejected',
  BLOCKED_ON_DEPENDENCY: 'Blocked on Dependency',
  EXECUTION_STARTED: 'Execution Started',
  EXECUTION_SUCCEEDED: 'Correction Applied',
  EXECUTION_FAILED: 'Execution Failed',
  EXPIRED: 'Undo Window Expired',
  CANCELLED: 'Cancelled',
};

function fmtDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function CorrectionTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No timeline events yet.</p>;
  }

  return (
    <ol className="space-y-3 border-l border-border pl-4">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
          <p className="text-sm font-bold text-foreground">{EVENT_LABELS[event.event_type] ?? event.event_type}</p>
          {event.reason && <p className="text-xs text-muted-foreground">Reason: {event.reason}</p>}
          <p className="text-xs text-muted-foreground">
            {event.actor_role} · {fmtDateTime(event.created_at)}
          </p>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Verify the architecture check still passes**

Run from `frontend-v2/`: `npm run check:architecture`
Expected: exits 0 (no fetch/axios usage in either file).

- [ ] **Step 4: Commit**

```bash
git add frontend-v2/src/app/components/recovery
git commit -m "feat(recovery): add RecoveryStatusBadge and CorrectionTimeline components"
```

---

### Task 16: `RecoveryCenterView` + route registration

**Files:**
- Create: `frontend-v2/src/app/components/views/RecoveryCenterView.tsx`
- Modify: `frontend-v2/src/platforms/owner/router/OwnerRoutes.tsx`

**Interfaces:**
- Consumes: `useRecoveryCases`, `useRecoveryCaseDetail`, `useCreateRecoveryCase`, `useValidateRecoveryCase`, `useExecuteRecoveryCase` (Task 14); `RecoveryStatusBadge`, `CorrectionTimeline` (Task 15).

- [ ] **Step 1: Write `RecoveryCenterView`**

Modeled directly on `AgreementLifecycleRecoveryView.tsx`'s list+detail-modal Tailwind pattern (no CSS modules, `lucide-react` icons, inline hooks):

```tsx
// frontend-v2/src/app/components/views/RecoveryCenterView.tsx
import { useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';
import { useHostelContext } from '@/app/hooks/useHostelContext'; // adjust import if the actual hook lives elsewhere — confirm with `grep -rn "useHostelContext" frontend-v2/src` before writing this file
import { RecoveryStatusBadge, type RecoveryCaseStatus } from '../recovery/RecoveryStatusBadge';
import { CorrectionTimeline } from '../recovery/CorrectionTimeline';
import {
  useRecoveryCases,
  useRecoveryCaseDetail,
  useValidateRecoveryCase,
  useExecuteRecoveryCase,
} from '@features/recovery/hooks/useRecoveryCases';

export function RecoveryCenterView() {
  const { hostelId } = useHostelContext();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: cases, isLoading, isError, refetch } = useRecoveryCases(hostelId, {
    status: statusFilter === 'all' ? undefined : statusFilter,
  });
  const { data: detail } = useRecoveryCaseDetail(hostelId, selectedCaseId ?? '');
  const validateMutation = useValidateRecoveryCase(hostelId);
  const executeMutation = useExecuteRecoveryCase(hostelId);

  const rows = cases ?? [];

  return (
    <div className="space-y-5 px-4 py-5 md:px-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Financial Corrections</p>
          <h1 className="text-2xl font-bold text-foreground">Recovery Center</h1>
          <p className="text-sm text-muted-foreground">Review, preview, and apply corrections without deleting history.</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-bold text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {['all', 'PREVIEW', 'VALIDATED', 'COMPLETED', 'FAILED'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                statusFilter === status ? 'bg-accent text-accent-foreground' : 'border border-border text-foreground'
              }`}
            >
              {status === 'all' ? 'All' : status}
            </button>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading recovery cases
          </div>
        ) : isError ? (
          <div className="py-12 text-center">
            <AlertCircle className="mx-auto h-5 w-5 text-rose-500" />
            <p className="mt-2 text-sm font-semibold text-foreground">Could not load recovery cases</p>
            <button type="button" onClick={() => refetch()} className="mt-2 text-xs font-bold text-accent">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No correction cases match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Case Type</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((kase) => (
                  <tr key={kase.id} className="align-top">
                    <td className="px-4 py-3 font-semibold text-foreground">{kase.caseType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-muted-foreground">{kase.reason}</td>
                    <td className="px-4 py-3"><RecoveryStatusBadge status={kase.status as RecoveryCaseStatus} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(kase.createdAt).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedCaseId(kase.id)}
                        className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-foreground"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedCaseId && detail && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-xl sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Correction Case</p>
                <h2 className="text-lg font-bold text-foreground">{detail.caseType.replace(/_/g, ' ')}</h2>
                <RecoveryStatusBadge status={detail.status as RecoveryCaseStatus} className="mt-2" />
              </div>
              <button type="button" onClick={() => setSelectedCaseId(null)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            {detail.previewImpact && (
              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Impact Preview</p>
                {detail.previewImpact.ledgerEntries.map((entry, i) => (
                  <p key={i} className="mt-1 text-sm text-foreground">
                    {entry.direction} ₹{entry.amount.toLocaleString('en-IN')} — {entry.reason}
                  </p>
                ))}
                {detail.previewImpact.warnings.map((warning, i) => (
                  <p key={i} className="mt-1 text-xs font-semibold text-amber-700">{warning}</p>
                ))}
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Timeline</p>
              <div className="mt-2">
                <CorrectionTimeline events={detail.events} />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              {detail.status === 'PREVIEW' && (
                <button
                  type="button"
                  onClick={() => validateMutation.mutate(detail.id)}
                  disabled={validateMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground disabled:opacity-60"
                >
                  {validateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm & Validate
                </button>
              )}
              {(detail.status === 'VALIDATED' || detail.status === 'FAILED') && (
                <button
                  type="button"
                  onClick={() => executeMutation.mutate(detail.id)}
                  disabled={executeMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground disabled:opacity-60"
                >
                  {executeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {detail.status === 'FAILED' ? 'Retry' : 'Apply Correction'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Before writing this file, run `grep -rn "useHostelContext\|useCurrentHostel\|selectedHostelId" frontend-v2/src/app/components/views/*.tsx | head -20` to find the actual hook/prop this repo's other owner views use for the currently-selected hostel — `AgreementLifecycleRecoveryView.tsx` (Task-research reference) doesn't scope by hostel at all, so it isn't a usable example for this specific piece; adapt the import and variable name to match whatever the real convention is (e.g. it may come from a route param, a context provider, or a Zustand/Redux store) rather than assuming `useHostelContext` exists verbatim.

- [ ] **Step 2: Register the route**

In `frontend-v2/src/platforms/owner/router/OwnerRoutes.tsx`, add the lazy import near the others:
```tsx
const RecoveryCenterView = lazy(() => import('@/app/components/views/RecoveryCenterView').then((m) => ({ default: m.RecoveryCenterView })));
```
and add the route inside `<Route element={<App />}>`, after `/activity`:
```tsx
        <Route path="/recovery-center" element={<RecoveryCenterView />} />
```

- [ ] **Step 3: Manually verify in the browser**

Run `npm run dev` in `frontend-v2/` and `npm run dev` in `backend-next/` (per repo convention), log in as an owner, navigate to `/recovery-center`, and confirm the page loads without a console error and the empty-state message renders when no cases exist yet. Then use the API directly (e.g. via a REST client) to create one `PAYMENT_REVERSAL` case against a real test payment, refresh, and confirm it appears with the correct badge and that the detail modal's Validate → Apply Correction flow completes.

- [ ] **Step 4: Verify the architecture check and full build**

Run from `frontend-v2/`:
```bash
npm run check:architecture
npm run build
```
Expected: both exit 0.

- [ ] **Step 5: Update `docs/obsidian/Features.md`**

Per CLAUDE.md's Documentation Rules (feature implementations documented in the same change), add an entry: "Recovery Center (`/recovery-center`, owner-facing) — Business Recovery Platform Phase 1. Lists Correction Cases across domains, shows the impact-preview + timeline before/after applying a correction, and supports Reverse Payment / Transfer Payment / Edit Reference-Notes via `POST /api/recovery/cases` → validate → execute." Cross-reference `[[APIs]]` and `[[Database]]`. Add a matching bullet to `docs/obsidian/Changelog.md` under `## [Unreleased]` → `### Added`.

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/app/components/views/RecoveryCenterView.tsx frontend-v2/src/platforms/owner/router/OwnerRoutes.tsx docs/obsidian/Features.md docs/obsidian/Changelog.md
git commit -m "feat(recovery): add Recovery Center view and route registration; document in Features.md"
```

---

### Task 17: Final documentation pass — Decisions ADR + Changelog wrap-up

**Documentation is per-task, not batched** (see Global Constraints) — `Database.md` (Task 1), `APIs.md` (Task 13), `Business-Rules.md` (Task 11), and `Features.md` (Task 16) are each updated by the task that introduces the thing they describe, in that task's own commit. This final task only covers the two things that can't be written until the whole phase is done: the architectural-decision record and the closing changelog summary.

**Files:**
- Modify: `docs/obsidian/Decisions.md`, `docs/obsidian/Changelog.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add an ADR to `docs/obsidian/Decisions.md`**

Record the decision to unify Operational Undo + Financial Corrections under one Correction Case platform (one lifecycle, one registry, one `correction_cases` table) rather than building them as two separate systems plus a bolt-on Tier 3 — reference the three design docs under `docs/business-logic/` and note the three refinements folded in before implementation (platform/policy separation, dependencies, idempotency/retry, event-bus decoupling, self-registration).

- [ ] **Step 2: Add a closing entry to `docs/obsidian/Changelog.md`**

Under `## [Unreleased]` → `### Added`, add one summary bullet: "**Business Recovery Platform Phase 1 complete**: Correction Case lifecycle (DRAFT→PREVIEW→VALIDATED→EXECUTING→COMPLETED/FAILED), self-registering handler registry, and three correction handlers (Reverse Payment, Transfer Payment, Edit Reference/Notes) shipped via the new Recovery Center (`/recovery-center`). See [[Database]], [[APIs]], [[Business-Rules]], [[Features]], [[Decisions]]." This is additive to (not a replacement for) the per-task Changelog bullets already added in Tasks 1/13/11/16.

- [ ] **Step 3: Commit**

```bash
git add docs/obsidian/Decisions.md docs/obsidian/Changelog.md
git commit -m "docs: add Business Recovery Platform ADR and Phase 1 changelog wrap-up"
```

---

## Self-review notes

- **Spec coverage**: Core platform (Tasks 1, 3–7, 12), all three Phase 1 handlers (Tasks 8–11), API (Task 13), Recovery Center UI incl. timeline/badges/preview (Tasks 14–16), the prerequisite invariant-regex fix (Task 2), and the documentation obligation (Task 17) are all covered. Split/Merge/Reallocate, Administrative Reversal, bulk corrections, analytics, and AI assistance are intentionally out of scope per the architecture doc's Phase 2/3 split.
- **Known follow-ups flagged inline, not silently glossed over**: Task 13's auth-mocking mechanism must be confirmed against the real `getSession`/`authService` shape before trusting the test; Task 16's hostel-context hook name must be confirmed against the real convention before writing the file; Task 1's dual-database (`DATABASE_URL` vs `DATABASE_URL_TEST`) push must be verified.
- **Retry cap (3 attempts) and receipt-attachment scope-narrowing** were open questions in the design docs; this plan makes concrete, stated choices (cap of 3; reference+notes only, no receipt) rather than leaving them unresolved — revisit both if product feedback disagrees.
