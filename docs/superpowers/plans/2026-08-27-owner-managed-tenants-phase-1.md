# Owner-Managed Tenants (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner fully manage a tenant who ignored their invitation — rent generated, occupancy counted, payments recorded, and automated WhatsApp reminders delivered — without the tenant ever activating an account.

**Architecture:** Splits the overloaded `TenantStatus` into two axes by adding `access_mode` (`SELF_SERVE | OWNER_MANAGED`) to `tenants`. `ACTIVE` returns to meaning "lives here, owes rent" and becomes reachable by owner adoption, so rent generation, room capacity, analytics and reminders — all of which already key on `ACTIVE` — start working with no changes. A second, independent hard-coding is then removed: the notification layer reads contact details from `tenant.profiles`, which is null for these tenants, so name/phone resolution moves behind helpers.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres (Supabase), Vitest, React 19 + Vite, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md`

## Global Constraints

- **Deploy the migration BEFORE the code that declares the fields.** Adding a field to `schema.prisma` makes Prisma request it on every unselected read of that table; if the migration has not been applied, all of them 500. This took production down on 2026-08-22. `tenants` is one of the hottest tables in the system.
- **Never fabricate tenant consent.** An owner's adoption click is recorded in `tenant_owner_attestations`, never as a `TenantPolicyAcceptance`. No task may write a `TenantPolicyAcceptance` row on the owner's behalf.
- **Do not re-add the owner-side "Activate" button.** `InvitedTenantProfileView.tsx:44-47` records that it was deliberately deleted for bypassing registration. The new action is labelled "Keep records myself" and sets `access_mode`; it never claims registration occurred.
- **`hostelId` is always required**, never optional, and no "first hostel" fallback — enforced by `npm run check:invariants`.
- Backend pure tests only run if the file is added to `vitest.pure.config.ts`'s explicit `include` allowlist. A new test file silently never runs otherwise.
- Frontend tests are node-environment only (no jsdom). Logic goes in pure `.ts` with colocated `.test.ts`; components stay thin renderers. Never add a `.test.tsx`.
- All feature API calls go through `@lib/api-client` — raw `fetch`/`axios` fails `npm run check:architecture`.
- Phone values are stored and compared as E.164 `+91XXXXXXXXXX` via `normalizeIndianPhone` (backend) / `canonicalPhone` (frontend).

---

### Task 1: Schema — access mode, display name, attestation table

**Files:**
- Create: `apps/backend/prisma/migrations/20260827100000_owner_managed_tenants/migration.sql`
- Modify: `apps/backend/prisma/schema.prisma` (the `tenants` model at line 1738, and a new enum + model)

**Interfaces:**
- Consumes: nothing
- Produces: `TenantAccessMode` enum (`SELF_SERVE`, `OWNER_MANAGED`); `tenants.access_mode: TenantAccessMode` (default `SELF_SERVE`); `tenants.display_name: String?`; model `tenant_owner_attestations`

- [ ] **Step 1: Write the migration SQL**

Create `apps/backend/prisma/migrations/20260827100000_owner_managed_tenants/migration.sql`:

```sql
CREATE TYPE "TenantAccessMode" AS ENUM ('SELF_SERVE', 'OWNER_MANAGED');

ALTER TABLE "tenants"
  ADD COLUMN "access_mode" "TenantAccessMode" NOT NULL DEFAULT 'SELF_SERVE',
  ADD COLUMN "display_name" TEXT;

CREATE TABLE "tenant_owner_attestations" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"     UUID NOT NULL,
  "hostel_id"     UUID NOT NULL,
  "attested_by"   UUID NOT NULL,
  "attested_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "attested_ip"   TEXT,
  "rules_version" TEXT,
  "note"          TEXT,
  CONSTRAINT "tenant_owner_attestations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_owner_attestations_tenant_id_idx"
  ON "tenant_owner_attestations"("tenant_id");
CREATE INDEX "tenant_owner_attestations_hostel_id_idx"
  ON "tenant_owner_attestations"("hostel_id");

ALTER TABLE "tenant_owner_attestations"
  ADD CONSTRAINT "tenant_owner_attestations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_owner_attestations"
  ADD CONSTRAINT "tenant_owner_attestations_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

`access_mode` defaults to `SELF_SERVE` so every existing row keeps today's exact meaning and no backfill is needed.

- [ ] **Step 2: Declare the enum and model in `schema.prisma`**

Add near the other tenant enums (beside `enum TenantStatus`, around line 2130):

```prisma
enum TenantAccessMode {
  SELF_SERVE
  OWNER_MANAGED
}
```

Add these two fields to `model tenants` (after `document_verified`, around line 1789):

```prisma
  access_mode                       TenantAccessMode                    @default(SELF_SERVE)
  display_name                      String?
  owner_attestations                tenant_owner_attestations[]
```

Add the new model after `model tenant_notes`:

```prisma
/// An owner asserting that a tenancy is managed offline. Deliberately NOT a
/// `TenantPolicyAcceptance`: the tenant never accepted anything, and recording
/// the owner's click as a tenant signature would make the audit trail false in
/// exactly the situation that tests it — a deposit dispute.
model tenant_owner_attestations {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenant_id     String   @db.Uuid
  hostel_id     String   @db.Uuid
  attested_by   String   @db.Uuid
  attested_at   DateTime @default(now()) @db.Timestamptz(6)
  attested_ip   String?
  rules_version String?
  note          String?

  tenant tenants @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  hostel hostels @relation(fields: [hostel_id], references: [id], onDelete: Cascade)

  @@index([tenant_id])
  @@index([hostel_id])
  @@map("tenant_owner_attestations")
}
```

Add the back-relation to `model hostels`:

```prisma
  tenant_owner_attestations tenant_owner_attestations[]
```

- [ ] **Step 3: Regenerate the Prisma client and confirm it compiles**

Run: `cd apps/backend && npm run prisma:generate`
Expected: `Generated Prisma Client` with no errors. If it reports a missing back-relation, the `hostels` or `tenants` relation field in Step 2 was omitted.

- [ ] **Step 4: Apply the migration to the database before anything else ships**

Run the SQL from Step 1 against the database (Supabase SQL editor or psql). Verify:

```sql
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'tenants' AND column_name IN ('access_mode','display_name');
```

Expected: two rows; `access_mode` with default `'SELF_SERVE'::"TenantAccessMode"` and `is_nullable = NO`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/migrations/20260827100000_owner_managed_tenants/migration.sql apps/backend/prisma/schema.prisma
git commit -m "feat(tenants): add access_mode axis and owner attestation table

Separates 'lives here and owes rent' from 'has an account'. access_mode
defaults to SELF_SERVE so every existing row keeps today's meaning."
```

---

### Task 2: Tenant identity resolution helpers

An owner-managed tenant has `profile_id: null`, so every consumer that reads `tenant.profiles.name` or `tenant.profiles.phone` gets null. These two pure helpers are the single place that fallback is decided.

**Files:**
- Create: `apps/backend/lib/tenants/tenant-identity.ts`
- Create: `apps/backend/tests/tenant-identity.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the test to `include`)

**Interfaces:**
- Consumes: `normalizeIndianPhone` from `@/lib/utils/phone-utils`
- Produces:
  - `resolveTenantName(tenant: TenantIdentityLike): string`
  - `resolveTenantPhone(tenant: TenantIdentityLike): string | null`
  - `interface TenantIdentityLike`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/tenant-identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveTenantName, resolveTenantPhone } from '@/lib/tenants/tenant-identity';

/** Pure — no database. Runs under `npm run test:pure`. */

describe('resolveTenantName', () => {
  it('prefers the profile name when the tenant has an account', () => {
    expect(resolveTenantName({
      profiles: { name: 'Rakesh Kumar' },
      display_name: 'Rakesh K',
    })).toBe('Rakesh Kumar');
  });

  it('falls back to display_name for an owner-managed tenant with no profile', () => {
    expect(resolveTenantName({ profiles: null, display_name: 'Rakesh Kumar' }))
      .toBe('Rakesh Kumar');
  });

  it('falls back to the invitation name when neither is set', () => {
    expect(resolveTenantName({
      profiles: null,
      display_name: null,
      tenant_invitations: [{ name: 'Rakesh Kumar' }],
    })).toBe('Rakesh Kumar');
  });

  it('never returns an empty string — reminders address a person, not a blank', () => {
    expect(resolveTenantName({})).toBe('Tenant');
    expect(resolveTenantName({ display_name: '   ' })).toBe('Tenant');
  });
});

describe('resolveTenantPhone', () => {
  it('prefers the profile phone, in E.164', () => {
    expect(resolveTenantPhone({
      profiles: { phone: '+919876543210' },
      phone_1: '+918008046952',
    })).toBe('+919876543210');
  });

  it('falls back to phone_1 for an owner-managed tenant', () => {
    expect(resolveTenantPhone({ profiles: null, phone_1: '9876543210' }))
      .toBe('+919876543210');
  });

  it('normalizes every accepted notation to the stored form', () => {
    expect(resolveTenantPhone({ phone_1: '098765 43210' })).toBe('+919876543210');
    expect(resolveTenantPhone({ phone_1: '+91 98765 43210' })).toBe('+919876543210');
  });

  it('returns null rather than a half-number, so no send is attempted', () => {
    expect(resolveTenantPhone({ phone_1: '98765' })).toBeNull();
    expect(resolveTenantPhone({})).toBeNull();
  });

  it('matches the frontend canonicalPhone contract exactly', () => {
    // apps/frontend/src/shared/lib/phone.ts::canonicalPhone produces this form.
    // A divergence here silently creates duplicate tenancies at claim time.
    expect(resolveTenantPhone({ phone_1: '8008046952' })).toBe('+918008046952');
  });
});
```

- [ ] **Step 2: Register the test file so it actually runs**

In `apps/backend/vitest.pure.config.ts`, add to the `include` array:

```ts
      'tests/tenant-identity.test.ts',
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/backend && npm run test:pure -- -t "resolveTenantName"`
Expected: FAIL — `Failed to resolve import "@/lib/tenants/tenant-identity"`.

- [ ] **Step 4: Write the implementation**

Create `apps/backend/lib/tenants/tenant-identity.ts`:

```ts
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";

/**
 * Where a tenant's name and phone live depends on whether they have an account.
 *
 * A SELF_SERVE tenant carries them on `profiles`. An OWNER_MANAGED tenant has
 * `profile_id: null` by design — their details live on the tenancy itself
 * (`display_name`, `phone_1`), put there by the owner. Reaching into
 * `tenant.profiles` directly is what made every reminder to an owner-managed
 * tenant skip with TENANT_PHONE_MISSING.
 */
export interface TenantIdentityLike {
  display_name?: string | null;
  phone_1?: string | null;
  profiles?: { name?: string | null; phone?: string | null } | null;
  tenant_invitations?: { name?: string | null; phone?: string | null }[] | null;
}

function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return null;
}

/** Never blank: a reminder addresses a person, and "" reads as a bug to the tenant. */
export function resolveTenantName(tenant: TenantIdentityLike): string {
  return firstNonBlank(
    tenant.profiles?.name,
    tenant.display_name,
    tenant.tenant_invitations?.[0]?.name,
  ) ?? "Tenant";
}

/** E.164 (`+91XXXXXXXXXX`), or null when no complete number is known. */
export function resolveTenantPhone(tenant: TenantIdentityLike): string | null {
  const candidate = firstNonBlank(
    tenant.profiles?.phone,
    tenant.phone_1,
    tenant.tenant_invitations?.[0]?.phone,
  );
  return candidate ? normalizeIndianPhone(candidate) : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/backend && npm run test:pure -- tests/tenant-identity.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/lib/tenants/tenant-identity.ts apps/backend/tests/tenant-identity.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(tenants): resolve name and phone without requiring a profile

An owner-managed tenant has profile_id: null, so tenant.profiles.phone is
null and every WhatsApp reminder skipped as TENANT_PHONE_MISSING. One
helper decides the fallback; a parity test pins the E.164 form against
the frontend's canonicalPhone."
```

---

### Task 3: Extract the reservation → allocation converter

The conversion — plus its overbooking guard — already exists at `tenant-invitation-lifecycle-service.ts:1148-1163`, but it is trapped inside token-gated `completeActivation()`. Adoption needs the same logic. Extract, don't reimplement.

**Files:**
- Create: `apps/backend/src/services/tenants/tenancy-allocation.ts`
- Modify: `apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts:1148-1163`

**Interfaces:**
- Consumes: `roomCapacityService.getRoomCapacitySnapshot(roomId, { tx })`
- Produces: `ensureActiveAllocation(tx, params): Promise<{ created: boolean }>` where `params` is `{ tenantId: string; roomId: string; hostelId: string; startDate: Date }`

- [ ] **Step 1: Write the new module**

Create `apps/backend/src/services/tenants/tenancy-allocation.ts`:

```ts
import crypto from "crypto";
import { roomCapacityService } from "@/src/services/rooms/room-capacity-service";

export interface EnsureAllocationParams {
  tenantId: string;
  roomId: string;
  hostelId: string;
  startDate: Date;
}

/**
 * Give a tenancy a live room allocation, idempotently.
 *
 * Extracted from `completeActivation` so owner adoption reaches the same code
 * path the tenant's own activation does — including the overbooking guard.
 * Two ways into one allocation, never two implementations of it.
 *
 * Caller must already hold the row locks (`SELECT ... FOR UPDATE` on the room)
 * — capacity is only meaningful under a lock.
 */
export async function ensureActiveAllocation(
  tx: any,
  params: EnsureAllocationParams,
): Promise<{ created: boolean }> {
  const existing = await tx.roomAllocation.findFirst({
    where: { tenant_id: params.tenantId, is_active: true, end_date: null },
  });
  if (existing) return { created: false };

  const capacity = await roomCapacityService.getRoomCapacitySnapshot(params.roomId, { tx });
  if (capacity.occupied >= Number(capacity.room.capacity || 0)) {
    throw new Error("CAPACITY_EXCEEDED: Reserved room no longer has available capacity");
  }

  await tx.roomAllocation.create({
    data: {
      id: crypto.randomUUID(),
      tenant_id: params.tenantId,
      room_id: params.roomId,
      hostel_id: params.hostelId,
      start_date: params.startDate,
      is_active: true,
    },
  });

  return { created: true };
}
```

Verify the import path for `roomCapacityService` matches how `tenant-invitation-lifecycle-service.ts` imports it; copy that import verbatim rather than guessing.

- [ ] **Step 2: Replace the inline block in `completeActivation`**

In `tenant-invitation-lifecycle-service.ts`, replace lines 1143-1163 (the `getRoomCapacitySnapshot` call, the capacity check, the `existingAllocation` lookup, and the `roomAllocation.create`) with:

```ts
      await ensureActiveAllocation(tx, {
        tenantId: tenant.id,
        roomId: reservation.room_id,
        hostelId: reservation.hostel_id,
        startDate: tenantRow[0].joined_on || startOfToday(),
      });
```

Keep the `SELECT ... FOR UPDATE` on the room immediately above it — the lock stays with the caller. Add the import at the top of the file:

```ts
import { ensureActiveAllocation } from "./tenancy-allocation";
```

- [ ] **Step 3: Verify the extraction changed no behaviour**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

Run: `cd apps/backend && npm run check:invariants`
Expected: all checks pass. (This confirms no `hostelId`-optional or first-hostel-fallback violation was introduced.)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/services/tenants/tenancy-allocation.ts apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts
git commit -m "refactor(tenants): extract reservation-to-allocation conversion

Owner adoption needs the same conversion and the same overbooking guard
that activation performs. One implementation, two entry points."
```

---

### Task 4: Adoption service and endpoint

**Files:**
- Create: `apps/backend/src/services/tenants/owner-managed-tenancy-service.ts`
- Create: `apps/backend/app/api/tenants/[id]/adopt/route.ts`

**Interfaces:**
- Consumes: `ensureActiveAllocation` (Task 3), `resolveTenantName` (Task 2), `tenants.access_mode` / `display_name` / `tenant_owner_attestations` (Task 1)
- Produces: `ownerManagedTenancyService.adopt(params): Promise<AdoptResult>` where params is `{ tenantId: string; ownerId: string; hostelId: string; displayName?: string; note?: string; ip?: string | null }` and `AdoptResult` is `{ tenant_id: string; access_mode: "OWNER_MANAGED"; status: "ACTIVE"; display_name: string; allocation_created: boolean }`

- [ ] **Step 1: Write the service**

Create `apps/backend/src/services/tenants/owner-managed-tenancy-service.ts`:

```ts
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { resolveTenantName } from "@/lib/tenants/tenant-identity";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { ensureActiveAllocation } from "./tenancy-allocation";

export interface AdoptParams {
  tenantId: string;
  ownerId: string;
  hostelId: string;
  displayName?: string;
  note?: string;
  ip?: string | null;
}

export interface AdoptResult {
  tenant_id: string;
  access_mode: "OWNER_MANAGED";
  status: "ACTIVE";
  display_name: string;
  allocation_created: boolean;
}

/**
 * Adopting a tenant who ignored their invitation.
 *
 * This is NOT the owner-side "Activate" button that was deliberately deleted
 * (see InvitedTenantProfileView.tsx:44-47). That button claimed registration
 * had happened. This records that it did not: the tenancy becomes ACTIVE and
 * OWNER_MANAGED, and the owner's assertion is stored as an attestation, never
 * as a TenantPolicyAcceptance.
 *
 * The invitation is marked SUPERSEDED rather than cancelled — if the tenant
 * clicks that month-old link later, it must still resolve to this tenancy so
 * they can claim it (Phase 2), not fail as invalid.
 */
export const ownerManagedTenancyService = {
  async adopt(params: AdoptParams): Promise<AdoptResult> {
    const { tenantId, ownerId, hostelId } = params;

    return prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenants.findFirst({
        where: { id: tenantId, owner_id: ownerId, hostel_id: hostelId },
        select: {
          id: true,
          status: true,
          access_mode: true,
          display_name: true,
          phone_1: true,
          joined_on: true,
          hostel_id: true,
          profiles: { select: { name: true, phone: true } },
          tenant_invitations: {
            where: { status: "PENDING" },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true, name: true, phone: true, room_id: true },
          },
        },
      });

      if (!tenant) throw new Error("NOT_FOUND: Tenant not found in this hostel");
      if (tenant.status === "ACTIVE" && tenant.access_mode === "OWNER_MANAGED") {
        throw new Error("CONFLICT: Tenant is already managed by you");
      }
      if (tenant.status !== "INVITED") {
        throw new Error(`CONFLICT: Only an invited tenant can be adopted (status: ${tenant.status})`);
      }

      const displayName = (params.displayName || "").trim() || resolveTenantName(tenant);
      const phone = normalizeIndianPhone(tenant.profiles?.phone || tenant.phone_1);
      if (!phone) {
        throw new Error("VALIDATION_ERROR: A valid mobile number is required before managing this tenant");
      }

      const reservation = await tx.tenant_invitation_reservations.findFirst({
        where: { tenant_id: tenant.id, status: "ACTIVE" },
        orderBy: { reserved_at: "desc" },
        select: { id: true, room_id: true, hostel_id: true },
      });
      const roomId = reservation?.room_id ?? tenant.tenant_invitations[0]?.room_id;
      if (!roomId) throw new Error("VALIDATION_ERROR: No room is reserved for this tenant");

      await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;

      const { created } = await ensureActiveAllocation(tx, {
        tenantId: tenant.id,
        roomId,
        hostelId: tenant.hostel_id,
        startDate: tenant.joined_on || new Date(),
      });

      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          status: "ACTIVE",
          access_mode: "OWNER_MANAGED",
          display_name: displayName,
          phone_1: phone,
          activation_completed_at: new Date(),
          updated_at: new Date(),
        },
      });

      await tx.tenant_owner_attestations.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          hostel_id: tenant.hostel_id,
          attested_by: ownerId,
          attested_ip: params.ip || null,
          note: params.note || null,
        },
      });

      if (reservation) {
        await tx.tenant_invitation_reservations.update({
          where: { id: reservation.id },
          data: {
            status: "RELEASED",
            released_by: ownerId,
            released_at: new Date(),
            release_reason: "ADOPTED",
            updated_at: new Date(),
          },
        });
      }

      if (tenant.tenant_invitations[0]) {
        await tx.tenant_invitations.update({
          where: { id: tenant.tenant_invitations[0].id },
          data: { status: "SUPERSEDED", updated_at: new Date() },
        });
      }

      return {
        tenant_id: tenant.id,
        access_mode: "OWNER_MANAGED" as const,
        status: "ACTIVE" as const,
        display_name: displayName,
        allocation_created: created,
      };
    });
  },
};
```

- [ ] **Step 2: Write the route**

Create `apps/backend/app/api/tenants/[id]/adopt/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { ownerManagedTenancyService } from "@/src/services/tenants/owner-managed-tenancy-service";

/**
 * 📍 POST /api/tenants/[id]/adopt
 *
 * "Keep records myself" — the owner takes over a tenancy whose invitation the
 * tenant ignored. The tenancy becomes ACTIVE and OWNER_MANAGED, so rent
 * generation, room capacity, analytics and reminders (all of which key on
 * ACTIVE) begin working. The invitation is superseded, not cancelled: the
 * tenant may still claim this tenancy later.
 *
 * Access: Owner/Admin only, scoped to their own tenants and an explicit hostel.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const body = await req.json().catch(() => ({}));
  const hostelId = String(body?.hostel_id || "");
  if (!hostelId) {
    return apiError("hostel_id is required", "VALIDATION_ERROR", 400);
  }

  try {
    const result = await ownerManagedTenancyService.adopt({
      tenantId: params.id,
      ownerId: session.sub,
      hostelId,
      displayName: body?.display_name,
      note: body?.note,
      ip: req.headers.get("x-forwarded-for"),
    });
    return apiResponse(result, 200);
  } catch (error: any) {
    const message = String(error?.message || "Failed to adopt tenant");
    const [code] = message.split(":");
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      CONFLICT: 409,
      VALIDATION_ERROR: 400,
      CAPACITY_EXCEEDED: 409,
    };
    const status = statusMap[code] ?? 500;
    if (status === 500) console.error("Detailed API Error [tenants.adopt.POST]:", error);
    return apiError(message.replace(/^[A-Z_]+:\s*/, ""), code || "ADOPT_ERROR", status);
  }
}
```

- [ ] **Step 3: Typecheck and run the invariant checks**

Run: `cd apps/backend && npx tsc --noEmit && npm run check:invariants`
Expected: no type errors; all invariant checks pass. `hostel_id` is a required body field precisely so check 3 (no optional `hostelId`) holds.

- [ ] **Step 4: Verify adoption end to end against a real invited tenant**

Run against a development database with one `INVITED` tenant:

```bash
cd apps/backend && npm run dev
# In another shell, with an owner session cookie:
curl -X POST localhost:3000/api/tenants/<TENANT_ID>/adopt \
  -H 'Content-Type: application/json' -b 'hms_session=<TOKEN>' \
  -d '{"hostel_id":"<HOSTEL_ID>"}'
```

Expected: `200` with `{"access_mode":"OWNER_MANAGED","status":"ACTIVE",...}`. Then confirm the three consequences:

```sql
SELECT status, access_mode, display_name FROM tenants WHERE id = '<TENANT_ID>';
SELECT count(*) FROM "roomAllocation" WHERE tenant_id = '<TENANT_ID>' AND is_active = true;
SELECT count(*) FROM tenant_owner_attestations WHERE tenant_id = '<TENANT_ID>';
```

Expected: `ACTIVE / OWNER_MANAGED / <name>`; one active allocation; one attestation.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/tenants/owner-managed-tenancy-service.ts apps/backend/app/api/tenants/\[id\]/adopt/route.ts
git commit -m "feat(tenants): adopt a tenant who ignored their invitation

Flips an INVITED tenancy to ACTIVE + OWNER_MANAGED, converts the
reservation to an allocation, and records the owner's assertion as an
attestation rather than as tenant consent. The invitation is superseded,
not cancelled, so the tenant can still claim the tenancy later."
```

---

### Task 5: Make the activation invariants conditional

Weakening these globally would let genuine self-serve bugs through. They become conditional on `access_mode` instead.

**Files:**
- Modify: `apps/backend/scripts/activation-invariants-check.ts`

**Interfaces:**
- Consumes: `tenants.access_mode` (Task 1), `tenant_owner_attestations` (Task 1)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Scope the two existing checks to SELF_SERVE and add three new ones**

In `apps/backend/scripts/activation-invariants-check.ts`, add `access_mode: "SELF_SERVE"` to the `where` of both `activeMissingProfileOrCompletion` and `activeMissingAcceptance`, then add three queries to the `Promise.all` array:

```ts
    prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        access_mode: "OWNER_MANAGED",
        OR: [{ display_name: null }, { display_name: "" }, { phone_1: null }],
      },
      select: { id: true, display_name: true, phone_1: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        access_mode: "OWNER_MANAGED",
        owner_attestations: { none: {} },
      },
      select: { id: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        access_mode: "OWNER_MANAGED",
        profiles: { auth_user_id: { not: null } },
      },
      select: { id: true, profile_id: true },
      take: 25,
    }),
```

Destructure the three new results alongside the existing four, and add them to the `failures` list:

```ts
    ["OWNER_MANAGED ACTIVE tenant must have a display name and phone", ownerManagedMissingContact],
    ["OWNER_MANAGED ACTIVE tenant must have an owner attestation", ownerManagedMissingAttestation],
    ["OWNER_MANAGED tenant must not hold a linked auth identity", ownerManagedWithAuthIdentity],
```

The third check is the one that catches the failure mode this whole design exists to avoid: an owner-managed tenant must never be able to sign in. It is the machine-checkable form of "adoption is not activation."

- [ ] **Step 2: Run the check against the database**

Run: `cd apps/backend && npm run check:activation-invariants`
Expected: `OK activation workflow data invariants`. If the run fails on a tenant adopted during Task 4's Step 4, that is a real finding — fix the data or the service, not the check.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/scripts/activation-invariants-check.ts
git commit -m "test(tenants): make activation invariants conditional on access_mode

Self-serve rules stay exactly as strict. Owner-managed tenancies get
their own three: a name and phone, an attestation, and — the one that
matters — no linked auth identity."
```

---

### Task 6: Deliver reminders to a tenant with no account

`reminder-service.ts:482` resolves the recipient as `tenant.profiles?.phone`, which is null for every owner-managed tenant, so all their WhatsApp reminders skip with `TENANT_PHONE_MISSING`.

**Files:**
- Modify: `apps/backend/src/services/payments/reminder-service.ts:407-530` (`triggerNotification`)

**Interfaces:**
- Consumes: `resolveTenantName`, `resolveTenantPhone` (Task 2)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Import the helpers and resolve once at the top of `triggerNotification`**

Add the import at the top of `reminder-service.ts`:

```ts
import { resolveTenantName, resolveTenantPhone } from "@/lib/tenants/tenant-identity";
```

Immediately after `const tenant = obligation.tenant;` in `triggerNotification`, add:

```ts
    const tenantName = resolveTenantName(tenant);
    const tenantPhone = resolveTenantPhone(tenant);
    const isOwnerManaged = tenant.access_mode === "OWNER_MANAGED";
```

- [ ] **Step 2: Use the resolved values in both channels**

In the email branch, replace `name: tenant.profiles?.name || "Tenant",` with:

```ts
          name: tenantName,
```

In the WhatsApp branch, replace the guard `} else if (!tenant.profiles?.phone) {` with:

```ts
    } else if (!tenantPhone) {
```

and inside `sendRentReminder`, replace `phone: tenant.profiles.phone,` and `tenantName: tenant.profiles?.name || "Tenant",` with:

```ts
            phone: tenantPhone,
            tenantName,
```

- [ ] **Step 3: Ensure the tenant query actually selects the new fields**

`triggerNotification` reads `obligation.tenant`. Find the query in `processDailyReminders` / `financialService.getOperationalOverdueObligations` that populates it and confirm the tenant selection includes `display_name`, `phone_1` and `access_mode` alongside `profiles`. If it uses an explicit `select`, add all three; if it uses `include`, they arrive already. Do not skip this — without it `resolveTenantPhone` sees `undefined` and the bug persists silently.

Run: `cd apps/backend && grep -n "getOperationalOverdueObligations" -A 40 src/services/payments/financial-service.ts | grep -n "select\|tenant"`

- [ ] **Step 4: Verify a reminder reaches an owner-managed tenant**

With the tenant adopted in Task 4 and holding one overdue obligation, and the hostel's `reminder_whatsapp` config enabled:

```bash
cd apps/backend && npx tsx -e "
  import('./src/services/payments/reminder-service').then(async (m) => {
    const r = await m.reminderService.sendManualReminder('<TENANT_ID>', '<OWNER_ID>');
    console.log(JSON.stringify(r, null, 2));
  })"
```

Expected: `channels.whatsapp.attempted === true` and no `TENANT_PHONE_MISSING`. Before this task the same call returns `whatsapp: { skipped: true, reason: "TENANT_PHONE_MISSING" }` — run it first to see the failure, so the fix is demonstrated rather than assumed.

Note `sendManualReminder` at line 350 filters `status: "ACTIVE"`, which an adopted tenant now satisfies — no change needed there.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/payments/reminder-service.ts
git commit -m "fix(reminders): reach tenants who have no account

The recipient was read as tenant.profiles?.phone, which is null for every
owner-managed tenant, so all their WhatsApp reminders skipped as
TENANT_PHONE_MISSING and emails addressed them as 'Tenant'."
```

---

### Task 7: Stop escalation advancing on messages nobody received

`triggerNotification` writes a `reminder_logs` row for the in-app channel unconditionally, and escalation reads those rows. An owner-managed tenant would climb `DUE_SOON → WARNING → FINAL_NOTICE` and then go permanently silent, with the owner seeing "final notice sent" against a tenant never contacted.

**Files:**
- Modify: `apps/backend/src/services/payments/reminder-service.ts:407-530` (`triggerNotification`)

**Interfaces:**
- Consumes: `isOwnerManaged` (Task 6, Step 1)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Skip the in-app channel for tenants with no account**

Replace the in-app branch condition `if (canInApp) {` with:

```ts
    if (isOwnerManaged) {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
    } else if (canInApp) {
```

and remove the `await prisma.reminder_logs.create({...})` call from inside that branch — the log write moves to Step 2. Keep `result.in_app.sent = true;`.

- [ ] **Step 2: Write the escalation log only when a channel actually delivered**

At the end of `triggerNotification`, immediately before `return result;`, add:

```ts
    // `reminder_logs` is escalation state, not just an audit trail: the next
    // reminder's type is chosen from the last row here. Writing one when every
    // channel was skipped would march an unreachable tenant up to FINAL_NOTICE
    // and then silence them forever. Only a delivery counts.
    const deliveredChannel = result.in_app.sent
      ? "IN_APP"
      : result.whatsapp.sent
        ? "WHATSAPP"
        : result.email.sent
          ? "EMAIL"
          : null;

    if (deliveredChannel) {
      await prisma.reminder_logs.create({
        data: {
          id: randomUUID(),
          obligation_id: obligation.id,
          tenant_id: tenant.id,
          reminder_type: type,
          channel: deliveredChannel,
          hostel_id: obligation.hostel_id,
        },
      });
    }

    return result;
```

For a self-serve tenant with in-app enabled, in-app always delivers, so a row is always written with `channel: "IN_APP"` — byte-identical to today's behaviour. Only tenants nothing reached are affected.

- [ ] **Step 3: Verify existing behaviour is unchanged for self-serve tenants**

Run: `cd apps/backend && npx vitest run tests/ -t "reminder"`
Expected: PASS. If no reminder tests exist, verify manually — send a manual reminder to a `SELF_SERVE` `ACTIVE` tenant and confirm exactly one `reminder_logs` row appears with `channel = 'IN_APP'`:

```sql
SELECT channel, reminder_type, sent_at FROM reminder_logs
WHERE tenant_id = '<SELF_SERVE_TENANT_ID>' ORDER BY sent_at DESC LIMIT 3;
```

- [ ] **Step 4: Verify an undeliverable reminder leaves no escalation trace**

Adopt a tenant, leave the hostel's `reminder_whatsapp` disabled and the tenant's `personal_email` null, then send a manual reminder. Expected: all three channels skipped, and **no new `reminder_logs` row**:

```sql
SELECT count(*) FROM reminder_logs WHERE tenant_id = '<ADOPTED_TENANT_ID>';
```

Expected: unchanged from before the send.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/payments/reminder-service.ts
git commit -m "fix(reminders): escalate only on reminders that were delivered

reminder_logs is escalation state, not only audit: the in-app row was
written unconditionally, so a tenant with no account would climb to
FINAL_NOTICE and then go permanently silent having received nothing."
```

---

### Task 8: Owner UI — "Keep records myself"

**Files:**
- Create: `apps/frontend/src/features/owner-tenants/api/ownerManaged.ts`
- Create: `apps/frontend/src/features/owner-tenants/adopt/adoptPrompt.ts`
- Create: `apps/frontend/src/features/owner-tenants/adopt/adoptPrompt.test.ts`
- Create: `apps/frontend/src/features/owner-tenants/adopt/AdoptTenantSheet.tsx`
- Modify: `apps/frontend/src/features/owner-tenants/components/InvitedTenantProfileView.tsx`

**Interfaces:**
- Consumes: `POST /api/tenants/[id]/adopt` (Task 4); `useHostelPolicy` from `@features/settings/settingsHooks`
- Produces: `ownerManagedService.adopt(input)`; `shouldOfferAdoption(invitation)`; `adoptionPromptText(name, days)`

- [ ] **Step 1: Write the failing test for the prompt logic**

Create `apps/frontend/src/features/owner-tenants/adopt/adoptPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldOfferAdoption, adoptionPromptText } from './adoptPrompt';

describe('shouldOfferAdoption', () => {
  it('offers once an unopened invitation has gone quiet for a week', () => {
    expect(shouldOfferAdoption({ openedAt: null, sentDaysAgo: 12 })).toBe(true);
    expect(shouldOfferAdoption({ openedAt: null, sentDaysAgo: 7 })).toBe(true);
  });

  it('stays quiet while the invitation is still fresh', () => {
    expect(shouldOfferAdoption({ openedAt: null, sentDaysAgo: 2 })).toBe(false);
  });

  it('still offers when the tenant opened it but never finished', () => {
    expect(shouldOfferAdoption({ openedAt: '2026-08-01', sentDaysAgo: 20 })).toBe(true);
  });
});

describe('adoptionPromptText', () => {
  it('states the fact and the remedy, without blaming anyone', () => {
    expect(adoptionPromptText('Rakesh', 12))
      .toBe("Rakesh hasn't opened this invite in 12 days. You can keep his records yourself and invite him again anytime.");
  });

  it('reads naturally at exactly one day', () => {
    expect(adoptionPromptText('Rakesh', 1))
      .toBe("Rakesh hasn't opened this invite in 1 day. You can keep his records yourself and invite him again anytime.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-tenants/adopt/adoptPrompt.test.ts`
Expected: FAIL — cannot resolve `./adoptPrompt`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/features/owner-tenants/adopt/adoptPrompt.ts`:

```ts
/**
 * When to offer the owner the option of keeping a tenant's records themselves.
 *
 * Pure so it can be tested — this repo's frontend tests are node-only, so the
 * decision lives here and the sheet just renders it.
 */
const QUIET_DAYS = 7;

export interface InvitationQuietness {
  openedAt: string | null;
  sentDaysAgo: number;
}

export function shouldOfferAdoption(invitation: InvitationQuietness): boolean {
  return invitation.sentDaysAgo >= QUIET_DAYS;
}

/** Neutral by design: the tenant is not at fault, and the owner is not stuck. */
export function adoptionPromptText(name: string, days: number): string {
  const dayWord = days === 1 ? 'day' : 'days';
  return `${name} hasn't opened this invite in ${days} ${dayWord}. You can keep his records yourself and invite him again anytime.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/owner-tenants/adopt/adoptPrompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the API wrapper**

Create `apps/frontend/src/features/owner-tenants/api/ownerManaged.ts`:

```ts
import api from '@lib/api-client';

/**
 * "Keep records myself" — taking over a tenancy whose invitation was ignored.
 *
 * Deliberately not an "activate" call. The tenant did not register; the backend
 * records the owner's assertion as an attestation and leaves the invitation
 * superseded rather than cancelled, so the tenant can still claim the tenancy.
 */

export interface AdoptTenantInput {
  tenantId: string;
  hostelId: string;
  displayName?: string;
  note?: string;
}

export const ownerManagedService = {
  adopt: async (input: AdoptTenantInput) => {
    const response = await api.post(`/tenants/${input.tenantId}/adopt`, {
      hostel_id: input.hostelId,
      display_name: input.displayName,
      note: input.note,
    });
    return response.data;
  },
};
```

- [ ] **Step 6: Write the confirmation sheet**

Create `apps/frontend/src/features/owner-tenants/adopt/AdoptTenantSheet.tsx`, following `MoveOutSheet.tsx`'s structure (same `BottomSheet` from `@shared/ui-patterns/BottomSheet`, same `useMutation` + `toast` + `queryClient.invalidateQueries` idiom). It must:

- state plainly what will happen: *"Rakesh will be added to your records as an active tenant. Rent will start generating and reminders will go to his WhatsApp. He won't have a login until he joins the app himself."*
- take an optional note (free text, passed as `note`)
- call `ownerManagedService.adopt({ tenantId, hostelId, note })`
- on success invalidate `queryKeys` entries for the tenant detail and the owner's tenant lists, then `toast.success('Now managing ' + name)`
- surface a `CAPACITY_EXCEEDED` error as "That room is now full — move him to a room with space first", not a raw message
- **check the hostel's `reminder_whatsapp` setting before promising anything.** WhatsApp is the only channel that reaches an owner-managed tenant, and `config.reminder_whatsapp` defaults to `false` per hostel — so the sheet's reassuring line would otherwise be false for most hostels, and the tenant would receive nothing at all. Read it via the existing `useHostelPolicy` hook (already used by `QuickCollectModal`). When it is off, replace the WhatsApp line with an inline notice — *"WhatsApp reminders are off for this hostel. Rakesh won't receive anything until you turn them on."* — and a link to the reminder settings. Do not block adoption on it; the owner may genuinely prefer to chase rent themselves.

- [ ] **Step 7: Wire it into the invited-tenant workspace**

In `InvitedTenantProfileView.tsx`, add the adoption prompt above the existing invitation timeline, rendered only when `shouldOfferAdoption(...)` returns true, with a single button labelled **"Keep records myself"** opening `AdoptTenantSheet`. Do not remove or alter the existing "Resend invite" action — adoption is an addition, never a replacement.

Update the file's header comment: it currently states that the owner-side Activate button was removed because a tenant becomes ACTIVE only by finishing registration. Extend it to record that adoption is a *different* act, which is why it is permitted where Activate was not.

- [ ] **Step 8: Verify the architecture check and build pass**

Run: `cd apps/frontend && npm run check:architecture && npm run build`
Expected: both pass. The architecture check confirms the new API wrapper uses `@lib/api-client` rather than raw `fetch`.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/features/owner-tenants/adopt apps/frontend/src/features/owner-tenants/api/ownerManaged.ts apps/frontend/src/features/owner-tenants/components/InvitedTenantProfileView.tsx
git commit -m "feat(owner-tenants): keep records for a tenant who ignored the invite

Offers adoption once an invite has been quiet for a week. Deliberately
not the owner-side Activate button that was removed: it never claims the
tenant registered, and the invite stays claimable."
```

---

### Task 9: Owner UI — add a tenant straight to the books

The invite wizard collects everything an owner-managed tenancy needs. It gains a second exit on its final step rather than becoming a second wizard — owners should never have to choose the mode before entering data.

**Files:**
- Modify: `apps/frontend/src/features/owner-tenants/hooks/useInviteWizard.ts`
- Modify: `apps/frontend/src/features/owner-tenants/invite/InviteTenantWizard.tsx:63,130`

**Interfaces:**
- Consumes: `ownerManagedService.adopt` (Task 8), the existing `submit()` in `useInviteWizard`
- Produces: `wizard.submitAsOwnerManaged()`

- [ ] **Step 1: Add the second submission path to the hook**

In `useInviteWizard.ts`, add a mutation alongside the existing one at line 97. It reuses the same invite-creation call (so the tenancy row, reservation and terms are created exactly as today) and then immediately adopts the resulting tenant:

```ts
  const ownerManagedMutation = useMutation({
    mutationFn: async () => {
      const created = await tenantService.invite(buildInvitePayload(data));
      return ownerManagedService.adopt({
        tenantId: created.tenant_id,
        hostelId: data.hostelId,
      });
    },
  });

  const submitAsOwnerManaged = () => ownerManagedMutation.mutate();
```

Match `buildInvitePayload` and `tenantService.invite` to whatever the existing `mutationFn` at line 97 actually calls — reuse that call verbatim rather than constructing a new payload shape.

Export `submitAsOwnerManaged` and `ownerManagedMutation.isPending` from the hook's return object.

- [ ] **Step 2: Make email optional on this path**

The wizard requires an email to send an invitation. An owner-managed tenant needs none. In `VerifyStep`'s validation (and any `isLast` gating in `InviteTenantWizard.tsx:63`), require email only for the "Send invite" action; phone and name remain required for both.

- [ ] **Step 3: Add the second exit to the final step**

In `InviteTenantWizard.tsx`, on the `wizard.step === 3` footer, render two actions: the existing primary **"Send invite"**, and a secondary **"Just add to my records"** calling `wizard.submitAsOwnerManaged()`. Place the secondary as a text/ghost button beneath the primary so the invite path stays the default.

The secondary needs one line of explanation beneath it: *"No invite sent. You keep the records; reminders still go to their WhatsApp."*

- [ ] **Step 4: Verify build and architecture**

Run: `cd apps/frontend && npm run check:architecture && npm run build`
Expected: both pass.

- [ ] **Step 5: Verify the flow against a running backend**

Start both apps, walk the wizard, choose "Just add to my records". Expected: the new tenant appears in the tenant list as **active**, not as a pending invitation, and:

```sql
SELECT status, access_mode FROM tenants ORDER BY created_at DESC LIMIT 1;
```

Expected: `ACTIVE | OWNER_MANAGED`.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/owner-tenants/hooks/useInviteWizard.ts apps/frontend/src/features/owner-tenants/invite/InviteTenantWizard.tsx
git commit -m "feat(owner-tenants): add a tenant straight to the books

One wizard, two exits. Owners should not have to decide whether a tenant
will use the app before entering their details, so the choice lands on
the last step and email is only required for the invite path."
```

---

### Task 10: Show access mode without making it a warning

An owner-managed tenant is a full tenant. The marker is informational; anything that reads as a problem to fix would recreate the nagging this feature removes.

**Files:**
- Modify: `apps/frontend/src/features/owner-tenants/components/TenantRow.tsx`
- Create: `apps/frontend/src/features/owner-tenants/accessMode.ts`
- Create: `apps/frontend/src/features/owner-tenants/accessMode.test.ts`

**Interfaces:**
- Consumes: `tenants.access_mode` as surfaced by the tenants API
- Produces: `accessModeLabel(mode): string | null`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/features/owner-tenants/accessMode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { accessModeLabel } from './accessMode';

describe('accessModeLabel', () => {
  it('marks an owner-managed tenant as not on the app', () => {
    expect(accessModeLabel('OWNER_MANAGED')).toBe('Not on app');
  });

  it('shows nothing for a normal tenant — the common case needs no badge', () => {
    expect(accessModeLabel('SELF_SERVE')).toBeNull();
    expect(accessModeLabel(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-tenants/accessMode.test.ts`
Expected: FAIL — cannot resolve `./accessMode`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/features/owner-tenants/accessMode.ts`:

```ts
export type AccessMode = 'SELF_SERVE' | 'OWNER_MANAGED';

/**
 * Null for the common case: a badge on every row is noise, and an
 * owner-managed tenant is a full tenant, not a degraded one. The label states
 * a fact about reach, never a problem to fix.
 */
export function accessModeLabel(mode: AccessMode | string | undefined | null): string | null {
  return mode === 'OWNER_MANAGED' ? 'Not on app' : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/owner-tenants/accessMode.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Render the marker in `TenantRow`**

In `TenantRow.tsx`, render `accessModeLabel(tenant.accessMode)` when non-null, using the existing `StatusPill` in its neutral/muted variant — never the warning or danger variant. Place it beside the room label, not in the status position: it is not a tenancy status.

Confirm the tenants API response surfaces `access_mode` and that `normalizeTenants` in `@features/tenants/utils/normalize` maps it to `accessMode`; add the mapping if it is absent.

- [ ] **Step 6: Confirm adopted tenants have left the nag list**

`usePendingActivations` fetches `GET /api/tenants?status=INVITED`, so an adopted tenant drops out automatically once `ACTIVE` — no code change. Verify it rather than assume it: adopt a tenant, then open the owner's pending-activations surface and confirm they are gone.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/owner-tenants/accessMode.ts apps/frontend/src/features/owner-tenants/accessMode.test.ts apps/frontend/src/features/owner-tenants/components/TenantRow.tsx
git commit -m "feat(owner-tenants): mark tenants who are not on the app

Neutral pill, never a warning: an owner-managed tenant is a full tenant.
Adopted tenants leave usePendingActivations on their own, since it
queries status=INVITED."
```

---

### Task 11: Documentation

Per CLAUDE.md this ships in the same change, not as follow-up.

**Files:**
- Modify: `docs/obsidian/Database.md`, `docs/obsidian/APIs.md`, `docs/obsidian/Business-Rules.md`, `docs/obsidian/Features.md`, `docs/obsidian/Decisions.md`, `docs/obsidian/Changelog.md`, `docs/obsidian/Bugs.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Write the vault updates**

- **[[Database]]** — `TenantAccessMode` enum; `tenants.access_mode` (default `SELF_SERVE`) and `display_name`; the `tenant_owner_attestations` table and why it is deliberately not `TenantPolicyAcceptance`.
- **[[APIs]]** — `POST /api/tenants/[id]/adopt`: owner/admin only, requires `hostel_id` in the body, returns `{ tenant_id, access_mode, status, display_name, allocation_created }`, error codes `NOT_FOUND` / `CONFLICT` / `VALIDATION_ERROR` / `CAPACITY_EXCEEDED`.
- **[[Business-Rules]]** — the two axes and why `ACTIVE` no longer implies an account; the conditional activation invariants; that an owner attestation is never tenant consent; and, in the Notification-triggers section, that `reminder_logs` is escalation state so a row is now written only when a channel actually delivered.
- **[[Features]]** — owner-managed tenants: adopt an ignored invitation, add straight to the books, WhatsApp reach without a login.
- **[[Decisions]]** — a new ADR recording the access-mode split, why owner attestation is deliberately not a `TenantPolicyAcceptance`, and why adoption is permitted where the removed owner-side Activate button was not.
- **[[Bugs]]** — the escalation defect fixed in Task 7: an unreachable tenant would climb to `FINAL_NOTICE` and go permanently silent while the owner saw "final notice sent".
- **[[Changelog]]** — a Keep-a-Changelog entry for the above.

Cross-link with `[[wiki links]]` so the graph stays connected. Mark anything unverified as "Unknown / needs clarification" rather than asserting it.

- [ ] **Step 2: Note Phase 2's dependency**

In [[TODO]], record that Phase 2 (tenant claims the tenancy by OTP) is specified in `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md` §7, and that Phase 1's reminder copy should carry a claim link once that route exists.

- [ ] **Step 3: Commit**

```bash
git add docs/obsidian/
git commit -m "docs(obsidian): record owner-managed tenants (phase 1)"
```

---

## Verification

Run all of these before calling Phase 1 done, and paste the actual output rather than asserting success:

```bash
cd apps/backend && npm run test:pure
cd apps/backend && npx tsc --noEmit
cd apps/backend && npm run check:invariants
cd apps/backend && npm run check:activation-invariants
cd apps/frontend && npx vitest run
cd apps/frontend && npm run check:architecture && npm run build
```

The scenario itself is the real test, and it must be walked end to end on a real database:

1. Invite a tenant. Do not activate them.
2. Confirm they generate no obligations and their room reads as having space.
3. Adopt them via "Keep records myself".
4. Run rent generation; confirm an obligation now exists.
5. Confirm the room's occupancy and the owner's analytics both count them.
6. Record a cash payment through `QuickCollectModal`; confirm it allocates.
7. Send a manual reminder; confirm WhatsApp was attempted against `phone_1`.
8. Turn the hostel's `reminder_whatsapp` off, adopt another tenant, and confirm the sheet says plainly that they will receive nothing — not that reminders will reach them.
9. Confirm no `reminder_logs` row is written for that unreachable tenant, so they never climb the escalation ladder in silence.
10. Confirm they no longer appear in pending activations.
