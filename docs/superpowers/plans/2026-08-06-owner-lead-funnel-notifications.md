# Owner Lead Funnel — Notifications + Enquiry Status Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four WhatsApp notification touchpoints and a public `/enquiry/:token` status-tracking surface to the existing, already-working owner-acquisition funnel.

**Architecture:** The funnel's state machine (`src/services/platform-leads/lead-invitation-service.ts`) is correct and stays untouched except where a send is added. All five template payloads are built by **pure** functions in a single registry module, and all five sends go through the existing idempotent `whatsAppTemplateDeliveryService` — which gains a `buttonParameters` passthrough it currently lacks. Owner-visible copy is kept strictly separate from the admin's private `notes` by putting it in its own column.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres (Supabase), Vitest, React 19 + Vite, TanStack Query, Meta WhatsApp Cloud API.

**Spec:** `docs/superpowers/specs/2026-08-06-owner-lead-funnel-notifications-design.md`

## Global Constraints

- **Branch:** `feat/owner-lead-funnel-notifications`. Never push to `main`. Merge target is `dev`.
- **Backend pure tests MUST be added to `apps/backend/vitest.pure.config.ts`'s `include` array.** It is an explicit allowlist — a new test file silently never runs otherwise. Run with `cd apps/backend && npm run test:pure`.
- **`cd apps/backend && npm test` is the DB-backed suite** and is not what you want here. A wall of failures across untouched files means you ran the wrong script.
- **`apps/frontend` tests are node-environment only** — no jsdom, no component rendering. Pure logic goes in `.ts` files with colocated `.test.ts`; components stay thin renderers. `src/**/*.test.ts` is auto-discovered, no allowlist. Run with `cd apps/frontend && npm test`.
- **All frontend network calls go through `@lib/api-client`** — raw `fetch()`/`axios` in `app/`, `platforms/`, `shared/ui`, `features/`, `portal/`, `context/` hard-fails `npm run check:architecture`, which `npm run build` runs.
- **All template URLs use `https://yourstayo.com`**, resolved via `frontendUrl()` from `lib/config/domains`. Never hardcode a host.
- **`DEFAULT_INVITE_DAYS = 7`** stays as-is. Template ② says "expires in {{2}} days" and receives `7`.
- **Meta rejects template parameters containing newlines, tabs, or 4+ consecutive spaces.** Every parameter must be whitespace-collapsed before sending.
- **Docs are part of the change, not follow-up.** Task 11 is not optional.

---

## File Structure

**Backend — create:**
| File | Responsibility |
|---|---|
| `lib/services/notifications/providers/whatsapp/platform-lead-template-contracts.ts` | Registry of all 5 templates (name, language, env override, param shapes) + 5 pure payload builders. **Pure — no I/O.** |
| `src/services/platform-leads/lead-stage-mapper.ts` | `PlatformLeadStatus` → owner-facing display stage + timeline. **Pure.** |
| `src/services/platform-leads/lead-transition-guards.ts` | `canRejectLead(status)`. **Pure.** |
| `src/services/platform-leads/platform-lead-notification-service.ts` | The 5 sends. Owns delivery policy. Impure. |
| `app/api/leads/track/[token]/route.ts` | Public status endpoint. |
| `app/api/platform-admin/leads/[id]/reject/route.ts` | Admin reject action. |
| `prisma/migrations/20260806120000_platform_lead_tracking/migration.sql` | Three columns + backfill. |
| `tests/platform-lead-templates.test.ts` | Pure tests for the builders. |
| `tests/platform-lead-stage-mapper.test.ts` | Pure tests for the mapper + guard. |

**Backend — modify:**
| File | Change |
|---|---|
| `prisma/schema.prisma` | 3 columns on `platform_leads` |
| `lib/services/notifications/whatsapp-template-delivery.ts` | `buttonParameters` passthrough |
| `src/services/platform-leads/lead-invitation-service.ts` | Delegate dispatch; add ②④ sends |
| `app/api/leads/self-serve/route.ts` | Mint `tracking_token`; send ① |
| `app/api/platform-admin/leads/[id]/route.ts` | Accept `applicant_message` |
| `app/api/auth/owner-signup/route.ts` | Repoint welcome → ③ |
| `vitest.pure.config.ts` | Add 2 test files to allowlist |

**Frontend — create:**
| File | Responsibility |
|---|---|
| `src/app/pages/public/EnquiryStatusPage.tsx` | `/enquiry/:token` page |
| `src/features/owner-onboarding/components/OwnerEnquiryPrompt.tsx` | Scroll-depth prompt |
| `src/features/owner-onboarding/enquiryPromptPolicy.ts` | Show/suppress decision. **Pure.** |
| `src/features/owner-onboarding/enquiryPromptPolicy.test.ts` | Its tests |

**Frontend — modify:** `features/hostel-leads/api/index.ts` (public lead calls), `features/platform-admin/api/index.ts` (admin calls — a **separate** module; `AdminLeadsPage` uses this one, not `hostelLeadsApi`), `app/router/PublicRoutes.tsx`, `app/pages/public/LandingPage.tsx`, `features/owner-onboarding/components/HostelLeadModal.tsx`, `platforms/admin/pages/AdminLeadsPage.tsx`.

**Why one contract module instead of five:** the existing codebase has one contract file per template (`owner-welcome-template-contract.ts`, `invitation-template-contract.ts`), each carrying its own ~100-line assert/check machinery. Copying that five times for five templates added in a single change would be ~500 lines of near-identical code. A registry keeps the same guarantees (declared param shape, env override, pure builder) in one file. This is a deliberate departure from the existing pattern — note it in the docs task.

---

### Task 1: Schema — tracking token, applicant message, rejection reason

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (the `platform_leads` model, ~line 2916)
- Create: `apps/backend/prisma/migrations/20260806120000_platform_lead_tracking/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `platform_leads.tracking_token: string` (non-null, unique, 64-char hex), `platform_leads.applicant_message: string | null`, `platform_leads.rejection_reason: string | null`.

- [ ] **Step 1: Add the columns to the Prisma model**

In `prisma/schema.prisma`, inside `model platform_leads`, add after the `notes` line:

```prisma
  /// Bearer secret for the public /enquiry/:token status page. Not the row
  /// id — the id is used in admin URLs and must not become guessable-adjacent
  /// to a public surface. Never expires (unlike platform_lead_invitations.token,
  /// which is a 7-day single-use activation credential).
  tracking_token     String              @unique
  /// Admin-authored, deliberately owner-visible. Distinct from `notes`, which
  /// is an internal scratchpad and is never returned by a public route.
  applicant_message  String?
  /// Set only by POST /api/platform-admin/leads/[id]/reject.
  rejection_reason   String?
```

- [ ] **Step 2: Write the migration**

Create `apps/backend/prisma/migrations/20260806120000_platform_lead_tracking/migration.sql`:

```sql
-- Three-step add: the table has existing rows, so a straight
-- "ADD COLUMN NOT NULL UNIQUE" would fail. Add nullable, backfill, constrain.

ALTER TABLE "platform_leads" ADD COLUMN "tracking_token" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN "applicant_message" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN "rejection_reason" TEXT;

UPDATE "platform_leads"
SET "tracking_token" = encode(gen_random_bytes(32), 'hex')
WHERE "tracking_token" IS NULL;

ALTER TABLE "platform_leads" ALTER COLUMN "tracking_token" SET NOT NULL;
CREATE UNIQUE INDEX "platform_leads_tracking_token_key"
  ON "platform_leads"("tracking_token");
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd apps/backend && npm run prisma:generate`
Expected: completes without error; `platform_leads` gains the three fields in the generated types.

- [ ] **Step 4: Verify the schema and client agree**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors mentioning `platform_leads`. (Pre-existing unrelated errors elsewhere are acceptable — compare against `git stash` output if unsure.)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/20260806120000_platform_lead_tracking/
git commit -m "feat(leads): add tracking_token, applicant_message, rejection_reason to platform_leads"
```

---

### Task 2: Pure template registry and payload builders

**Files:**
- Create: `apps/backend/lib/services/notifications/providers/whatsapp/platform-lead-template-contracts.ts`
- Create: `apps/backend/tests/platform-lead-templates.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports from `lib/db` or any provider).
- Produces:
  - `PLATFORM_LEAD_TEMPLATES: Record<PlatformLeadTemplateKey, PlatformLeadTemplateDefinition>`
  - `platformLeadTemplateName(key): string`, `platformLeadTemplateLanguage(key): string`
  - `buildLeadReceivedPayload({ ownerName, trackingToken }): TemplatePayload`
  - `buildInvitationPayload({ ownerName, expiryDays, activationToken }): TemplatePayload`
  - `buildAccountActivatedPayload({ ownerName }): TemplatePayload`
  - `buildOnboardingCompletePayload({ ownerName, hostelName }): TemplatePayload`
  - `buildLeadRejectedPayload({ ownerName, reason }): TemplatePayload`
  - where `TemplatePayload = { bodyParameters: string[]; buttonParameters: string[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/platform-lead-templates.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  PLATFORM_LEAD_TEMPLATES,
  platformLeadTemplateName,
  buildLeadReceivedPayload,
  buildInvitationPayload,
  buildAccountActivatedPayload,
  buildOnboardingCompletePayload,
  buildLeadRejectedPayload,
} from "@/lib/services/notifications/providers/whatsapp/platform-lead-template-contracts";

describe("platform lead template registry", () => {
  it("declares the five funnel templates with their Meta names", () => {
    expect(PLATFORM_LEAD_TEMPLATES.LEAD_RECEIVED.defaultName).toBe("stayo_owner_lead_received");
    expect(PLATFORM_LEAD_TEMPLATES.INVITATION.defaultName).toBe("stayo_owner_invitation");
    expect(PLATFORM_LEAD_TEMPLATES.ACCOUNT_ACTIVATED.defaultName).toBe("stayo_owner_account_activated");
    expect(PLATFORM_LEAD_TEMPLATES.ONBOARDING_COMPLETE.defaultName).toBe("stayo_owner_onboarding_complete");
    expect(PLATFORM_LEAD_TEMPLATES.LEAD_REJECTED.defaultName).toBe("stayo_owner_lead_rejected");
  });

  it("lets an env var override a template name without a redeploy", () => {
    const previous = process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE;
    process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE = "stayo_owner_invitation_v2";
    expect(platformLeadTemplateName("INVITATION")).toBe("stayo_owner_invitation_v2");
    if (previous === undefined) delete process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE;
    else process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE = previous;
  });

  it("every declared param shape matches what its builder fills", () => {
    const cases = [
      [PLATFORM_LEAD_TEMPLATES.LEAD_RECEIVED, buildLeadReceivedPayload({ ownerName: "A", trackingToken: "t" })],
      [PLATFORM_LEAD_TEMPLATES.INVITATION, buildInvitationPayload({ ownerName: "A", expiryDays: 7, activationToken: "t" })],
      [PLATFORM_LEAD_TEMPLATES.ACCOUNT_ACTIVATED, buildAccountActivatedPayload({ ownerName: "A" })],
      [PLATFORM_LEAD_TEMPLATES.ONBOARDING_COMPLETE, buildOnboardingCompletePayload({ ownerName: "A", hostelName: "H" })],
      [PLATFORM_LEAD_TEMPLATES.LEAD_REJECTED, buildLeadRejectedPayload({ ownerName: "A", reason: "R" })],
    ] as const;

    for (const [definition, payload] of cases) {
      expect(payload.bodyParameters).toHaveLength(definition.bodyParameters.length);
      expect(payload.buttonParameters).toHaveLength(definition.buttonParameters.length);
    }
  });
});

describe("payload builders", () => {
  it("puts the tracking token in the button, not the body", () => {
    const payload = buildLeadReceivedPayload({ ownerName: "Shiva", trackingToken: "abc123" });
    expect(payload.bodyParameters).toEqual(["Shiva"]);
    expect(payload.buttonParameters).toEqual(["abc123"]);
  });

  it("sends expiry as days, matching the approved template copy", () => {
    const payload = buildInvitationPayload({ ownerName: "Shiva", expiryDays: 7, activationToken: "tok" });
    expect(payload.bodyParameters).toEqual(["Shiva", "7"]);
    expect(payload.buttonParameters).toEqual(["tok"]);
  });

  it("falls back to a neutral name when the lead has none", () => {
    expect(buildAccountActivatedPayload({ ownerName: "   " }).bodyParameters).toEqual(["there"]);
  });

  it("falls back to a neutral hostel name", () => {
    const payload = buildOnboardingCompletePayload({ ownerName: "Shiva", hostelName: "" });
    expect(payload.bodyParameters).toEqual(["Shiva", "your hostel"]);
  });

  // Meta rejects parameters containing newlines, tabs, or 4+ consecutive
  // spaces with a 132000 error. Rejection reasons are free-text from an
  // admin textarea, so this is the realistic failure.
  it("collapses whitespace in a multi-line rejection reason", () => {
    const payload = buildLeadRejectedPayload({
      ownerName: "Shiva",
      reason: "We could not verify\nthe property.\n\nPlease    reapply later.",
    });
    expect(payload.bodyParameters[1]).toBe("We could not verify the property. Please reapply later.");
    expect(payload.bodyParameters[1]).not.toMatch(/[\n\t]/);
    expect(payload.bodyParameters[1]).not.toMatch(/ {4}/);
  });

  it("gives the rejected template a reason even when the admin left it blank", () => {
    expect(buildLeadRejectedPayload({ ownerName: "Shiva", reason: "" }).bodyParameters[1])
      .toBe("Not specified");
  });

  // An empty button parameter makes Meta 400 the whole send. Failing loudly
  // at build time is better than a provider error with no context.
  it("throws rather than building an empty button parameter", () => {
    expect(() => buildLeadReceivedPayload({ ownerName: "Shiva", trackingToken: "" }))
      .toThrow(/tracking token/i);
    expect(() => buildInvitationPayload({ ownerName: "Shiva", expiryDays: 7, activationToken: "  " }))
      .toThrow(/activation token/i);
  });
});
```

- [ ] **Step 2: Register the test file in the pure-config allowlist**

In `apps/backend/vitest.pure.config.ts`, add to the `include` array (after `'tests/food-meal-swap.test.ts',`):

```typescript
      'tests/platform-lead-templates.test.ts',
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/platform-lead-templates.test.ts`
Expected: FAIL — cannot resolve the `platform-lead-template-contracts` module.

- [ ] **Step 4: Write the implementation**

Create `apps/backend/lib/services/notifications/providers/whatsapp/platform-lead-template-contracts.ts`:

```typescript
/**
 * Contracts for the five owner-acquisition funnel WhatsApp templates.
 *
 * Deliberately ONE registry module rather than the five separate
 * `*-template-contract.ts` files the older templates each have: these five
 * ship together, share an identical shape, and copying the per-file
 * assert/check machinery five times would be ~500 lines of duplication.
 * The guarantees are the same — declared parameter shape, env-var name
 * override, and a pure builder that a test pins against the declaration.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type PlatformLeadTemplateKey =
  | "LEAD_RECEIVED"
  | "INVITATION"
  | "ACCOUNT_ACTIVATED"
  | "ONBOARDING_COMPLETE"
  | "LEAD_REJECTED";

export type PlatformLeadTemplateDefinition = {
  /** Env var that overrides the Meta template name, so a rename during Meta review is config, not a redeploy. */
  envVar: string;
  languageEnvVar: string;
  defaultName: string;
  defaultLanguage: string;
  /** Documentation of BODY {{1}}, {{2}}... in order. Length is asserted against the builder in tests. */
  bodyParameters: readonly string[];
  /** Dynamic URL-button suffixes, in button order. Empty for a static button. */
  buttonParameters: readonly string[];
};

export type TemplatePayload = {
  bodyParameters: string[];
  buttonParameters: string[];
};

export const PLATFORM_LEAD_TEMPLATES: Record<PlatformLeadTemplateKey, PlatformLeadTemplateDefinition> = {
  LEAD_RECEIVED: {
    envVar: "WHATSAPP_OWNER_LEAD_RECEIVED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_LEAD_RECEIVED_LANGUAGE",
    defaultName: "stayo_owner_lead_received",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name"],
    buttonParameters: ["tracking_token"],
  },
  INVITATION: {
    envVar: "WHATSAPP_OWNER_INVITATION_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_INVITATION_LANGUAGE",
    defaultName: "stayo_owner_invitation",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "expiry_days"],
    buttonParameters: ["activation_token"],
  },
  ACCOUNT_ACTIVATED: {
    envVar: "WHATSAPP_OWNER_ACCOUNT_ACTIVATED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_ACCOUNT_ACTIVATED_LANGUAGE",
    defaultName: "stayo_owner_account_activated",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name"],
    buttonParameters: [],
  },
  ONBOARDING_COMPLETE: {
    envVar: "WHATSAPP_OWNER_ONBOARDING_COMPLETE_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_ONBOARDING_COMPLETE_LANGUAGE",
    defaultName: "stayo_owner_onboarding_complete",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "hostel_name"],
    buttonParameters: [],
  },
  LEAD_REJECTED: {
    envVar: "WHATSAPP_OWNER_LEAD_REJECTED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_LEAD_REJECTED_LANGUAGE",
    defaultName: "stayo_owner_lead_rejected",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "reason"],
    buttonParameters: [],
  },
};

export function platformLeadTemplateName(key: PlatformLeadTemplateKey): string {
  const definition = PLATFORM_LEAD_TEMPLATES[key];
  const configured = String(process.env[definition.envVar] || "").trim();
  return configured || definition.defaultName;
}

export function platformLeadTemplateLanguage(key: PlatformLeadTemplateKey): string {
  const definition = PLATFORM_LEAD_TEMPLATES[key];
  const configured = String(process.env[definition.languageEnvVar] || "").trim();
  return configured || definition.defaultLanguage;
}

/**
 * Meta rejects template parameters containing newlines, tabs, or 4+
 * consecutive spaces (error 132000). Admin-authored free text — rejection
 * reasons above all — routinely contains all three.
 */
function sanitizeParameter(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeName(value: unknown): string {
  return sanitizeParameter(value) || "there";
}

function requireToken(value: unknown, label: string): string {
  const token = sanitizeParameter(value);
  if (!token) {
    throw new Error(
      `Cannot build WhatsApp payload: ${label} is empty. Meta rejects a send with a blank URL-button parameter.`
    );
  }
  return token;
}

export function buildLeadReceivedPayload(input: { ownerName: string; trackingToken: string }): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName)],
    buttonParameters: [requireToken(input.trackingToken, "tracking token")],
  };
}

export function buildInvitationPayload(input: {
  ownerName: string;
  expiryDays: number;
  activationToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName), String(Math.max(1, Math.round(input.expiryDays)))],
    buttonParameters: [requireToken(input.activationToken, "activation token")],
  };
}

export function buildAccountActivatedPayload(input: { ownerName: string }): TemplatePayload {
  return { bodyParameters: [safeName(input.ownerName)], buttonParameters: [] };
}

export function buildOnboardingCompletePayload(input: {
  ownerName: string;
  hostelName: string;
}): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName), sanitizeParameter(input.hostelName) || "your hostel"],
    buttonParameters: [],
  };
}

export function buildLeadRejectedPayload(input: { ownerName: string; reason: string }): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName), sanitizeParameter(input.reason) || "Not specified"],
    buttonParameters: [],
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/platform-lead-templates.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Confirm the whole pure suite still passes**

Run: `cd apps/backend && npm run test:pure`
Expected: all files pass, including the 11 pre-existing ones.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/lib/services/notifications/providers/whatsapp/platform-lead-template-contracts.ts \
        apps/backend/tests/platform-lead-templates.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "feat(whatsapp): add platform-lead template registry and pure payload builders"
```

---

### Task 3: Pure stage mapper and reject guard

**Files:**
- Create: `apps/backend/src/services/platform-leads/lead-stage-mapper.ts`
- Create: `apps/backend/src/services/platform-leads/lead-transition-guards.ts`
- Create: `apps/backend/tests/platform-lead-stage-mapper.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LeadDisplayStage = { key: string; label: string; state: "done" | "current" | "pending" }`
  - `mapLeadStatusToStage(status: string): { label: string; isTerminal: boolean }`
  - `buildLeadTimeline(status: string): LeadDisplayStage[]`
  - `canRejectLead(status: string): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/platform-lead-stage-mapper.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mapLeadStatusToStage, buildLeadTimeline } from "@/src/services/platform-leads/lead-stage-mapper";
import { canRejectLead } from "@/src/services/platform-leads/lead-transition-guards";

const ALL_STATUSES = [
  "NEW", "UNDER_REVIEW", "APPROVED", "INVITE_SENT",
  "OWNER_ACTIVATED", "HOSTEL_CREATED", "LIVE", "LOST",
];

describe("mapLeadStatusToStage", () => {
  it("gives every status a label — no status can render blank", () => {
    for (const status of ALL_STATUSES) {
      expect(mapLeadStatusToStage(status).label.length).toBeGreaterThan(0);
    }
  });

  // The whole point of the mapper: internal vocabulary must not reach a
  // public page. "INVITE_SENT" means nothing to an applicant.
  it("never leaks a raw internal status string as the label", () => {
    for (const status of ALL_STATUSES) {
      expect(mapLeadStatusToStage(status).label).not.toBe(status);
    }
  });

  it("collapses APPROVED and INVITE_SENT into one applicant-facing stage", () => {
    expect(mapLeadStatusToStage("APPROVED").label).toBe(mapLeadStatusToStage("INVITE_SENT").label);
  });

  it("collapses OWNER_ACTIVATED and HOSTEL_CREATED into one applicant-facing stage", () => {
    expect(mapLeadStatusToStage("OWNER_ACTIVATED").label).toBe(mapLeadStatusToStage("HOSTEL_CREATED").label);
  });

  it("marks LIVE and LOST terminal, and everything else not", () => {
    expect(mapLeadStatusToStage("LIVE").isTerminal).toBe(true);
    expect(mapLeadStatusToStage("LOST").isTerminal).toBe(true);
    expect(mapLeadStatusToStage("NEW").isTerminal).toBe(false);
    expect(mapLeadStatusToStage("INVITE_SENT").isTerminal).toBe(false);
  });

  it("degrades safely on an unrecognised status rather than throwing", () => {
    expect(mapLeadStatusToStage("SOMETHING_NEW").label).toBe("In progress");
  });
});

describe("buildLeadTimeline", () => {
  it("marks earlier stages done, the current one current, later ones pending", () => {
    const timeline = buildLeadTimeline("INVITE_SENT");
    const byKey = Object.fromEntries(timeline.map((s) => [s.key, s.state]));
    expect(byKey.submitted).toBe("done");
    expect(byKey.under_review).toBe("done");
    expect(byKey.approved).toBe("current");
    expect(byKey.setup).toBe("pending");
    expect(byKey.live).toBe("pending");
  });

  it("shows a rejected enquiry as a single decided stage, not a half-done ladder", () => {
    const timeline = buildLeadTimeline("LOST");
    expect(timeline.some((s) => s.key === "not_proceeding" && s.state === "current")).toBe(true);
    expect(timeline.some((s) => s.key === "live")).toBe(false);
  });

  it("marks every stage done when the hostel is live", () => {
    expect(buildLeadTimeline("LIVE").every((s) => s.state === "done")).toBe(true);
  });
});

describe("canRejectLead", () => {
  it("allows rejecting a lead still under consideration", () => {
    expect(canRejectLead("NEW").ok).toBe(true);
    expect(canRejectLead("UNDER_REVIEW").ok).toBe(true);
  });

  // Once an activation link is out, "decline" is a cancellation of that
  // invitation, not a status write. Out of scope — refuse rather than
  // half-do it.
  it("refuses once an activation link has been issued", () => {
    for (const status of ["APPROVED", "INVITE_SENT", "OWNER_ACTIVATED", "HOSTEL_CREATED", "LIVE"]) {
      const result = canRejectLead(status);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/activation link/i);
    }
  });

  it("refuses to reject an already-rejected lead", () => {
    expect(canRejectLead("LOST").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Register the test in the pure-config allowlist**

In `apps/backend/vitest.pure.config.ts`, add to `include`:

```typescript
      'tests/platform-lead-stage-mapper.test.ts',
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/platform-lead-stage-mapper.test.ts`
Expected: FAIL — cannot resolve `lead-stage-mapper`.

- [ ] **Step 4: Write the stage mapper**

Create `apps/backend/src/services/platform-leads/lead-stage-mapper.ts`:

```typescript
/**
 * Translates the internal PlatformLeadStatus into what a prospective owner
 * sees on the public /enquiry/:token page.
 *
 * This exists so internal vocabulary ("INVITE_SENT", "HOSTEL_CREATED") can
 * never reach an applicant, and so several internal statuses can collapse
 * into one applicant-meaningful stage.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type LeadStageState = "done" | "current" | "pending";

export type LeadDisplayStage = {
  key: string;
  label: string;
  state: LeadStageState;
};

const STAGE_ORDER = [
  { key: "submitted", label: "Submitted", statuses: ["NEW"] },
  { key: "under_review", label: "Under review", statuses: ["UNDER_REVIEW"] },
  { key: "approved", label: "Approved — activation link sent", statuses: ["APPROVED", "INVITE_SENT"] },
  { key: "setup", label: "Setting up your hostel", statuses: ["OWNER_ACTIVATED", "HOSTEL_CREATED"] },
  { key: "live", label: "Live on Stayo", statuses: ["LIVE"] },
] as const;

const REJECTED_LABEL = "Not proceeding";
const UNKNOWN_LABEL = "In progress";

export function mapLeadStatusToStage(status: string): { label: string; isTerminal: boolean } {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "LOST") return { label: REJECTED_LABEL, isTerminal: true };
  if (normalized === "LIVE") return { label: "Live on Stayo", isTerminal: true };

  const stage = STAGE_ORDER.find((entry) => (entry.statuses as readonly string[]).includes(normalized));
  return { label: stage ? stage.label : UNKNOWN_LABEL, isTerminal: false };
}

export function buildLeadTimeline(status: string): LeadDisplayStage[] {
  const normalized = String(status || "").toUpperCase();

  // A declined enquiry is not a partially-climbed ladder — showing three
  // greyed-out future stages under "Not proceeding" reads as though the
  // process is still running.
  if (normalized === "LOST") {
    return [
      { key: "submitted", label: "Submitted", state: "done" },
      { key: "under_review", label: "Under review", state: "done" },
      { key: "not_proceeding", label: REJECTED_LABEL, state: "current" },
    ];
  }

  const currentIndex = STAGE_ORDER.findIndex((entry) =>
    (entry.statuses as readonly string[]).includes(normalized)
  );

  return STAGE_ORDER.map((entry, index) => {
    let state: LeadStageState = "pending";
    if (currentIndex === -1) {
      // Unrecognised status: show the first stage as reached and nothing more,
      // rather than guessing at progress we cannot justify.
      state = index === 0 ? "current" : "pending";
    } else if (index < currentIndex) {
      state = "done";
    } else if (index === currentIndex) {
      state = normalized === "LIVE" ? "done" : "current";
    }
    return { key: entry.key, label: entry.label, state };
  });
}
```

- [ ] **Step 5: Write the transition guard**

Create `apps/backend/src/services/platform-leads/lead-transition-guards.ts`:

```typescript
/**
 * Guards for admin-initiated lead transitions.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

const REJECTABLE_STATUSES = ["NEW", "UNDER_REVIEW"];

/**
 * A lead can only be declined while it is still under consideration. Once
 * approveLead() has issued an activation link, declining would mean
 * cancelling a live invitation — a different operation with its own
 * side effects (the token stays valid until explicitly CANCELLED), so this
 * refuses rather than doing half of it.
 */
export function canRejectLead(status: string): GuardResult {
  const normalized = String(status || "").toUpperCase();
  if (REJECTABLE_STATUSES.includes(normalized)) return { ok: true };
  if (normalized === "LOST") {
    return { ok: false, reason: "This lead has already been marked as not proceeding." };
  }
  return {
    ok: false,
    reason:
      `Cannot reject a lead at status ${normalized} — an activation link has already been issued. ` +
      "Cancel the invitation first.",
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/platform-lead-stage-mapper.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/platform-leads/lead-stage-mapper.ts \
        apps/backend/src/services/platform-leads/lead-transition-guards.ts \
        apps/backend/tests/platform-lead-stage-mapper.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "feat(leads): add pure lead stage mapper and reject transition guard"
```

---

### Task 4: Notification service + button-parameter passthrough

**Files:**
- Modify: `apps/backend/lib/services/notifications/whatsapp-template-delivery.ts:13-23` and `:77-82`
- Create: `apps/backend/src/services/platform-leads/platform-lead-notification-service.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `whatsAppTemplateDeliveryService` from `lib/services/notifications/whatsapp-template-delivery`.
- Produces: `platformLeadNotificationService` with methods
  - `sendLeadReceived(lead): Promise<void>`
  - `sendInvitation(lead, activationToken, expiryDays): Promise<{ whatsapp_sent: boolean; whatsapp_error?: string }>`
  - `sendAccountActivated(profileId, ownerName, phone): Promise<void>`
  - `sendOnboardingComplete(lead, hostelName): Promise<void>`
  - `sendLeadRejected(lead, reason): Promise<void>`
  - where `lead` is `{ id: string; name: string; phone: string; tracking_token: string }`.

- [ ] **Step 1: Add `buttonParameters` to the delivery service input type**

In `apps/backend/lib/services/notifications/whatsapp-template-delivery.ts`, add to `WhatsAppTemplateDeliveryInput` (after `bodyParameters: string[];`):

```typescript
  /**
   * Dynamic URL-button suffixes, in button order. `MetaWhatsAppProvider
   * .sendTemplate` has always supported these; this service simply never
   * passed them through, which blocked any template with a dynamic button
   * from using the idempotent delivery path.
   */
  buttonParameters?: string[];
```

- [ ] **Step 2: Pass them to the provider**

In the same file, in `send()`, change the `this.provider.sendTemplate({...})` call (~line 77) to include the new field:

```typescript
      const result = await this.provider.sendTemplate({
        to: normalizedPhone,
        templateName: input.templateName,
        bodyParameters: input.bodyParameters,
        buttonParameters: input.buttonParameters,
        language: input.languageCode ? { code: input.languageCode } : undefined,
      });
```

- [ ] **Step 3: Write the notification service**

Create `apps/backend/src/services/platform-leads/platform-lead-notification-service.ts`:

```typescript
import { getLogger } from "../../../lib/logger";
import { eventLog } from "../../../lib/services/event-log-service";
import { whatsAppTemplateDeliveryService } from "../../../lib/services/notifications/whatsapp-template-delivery";
import {
  buildAccountActivatedPayload,
  buildInvitationPayload,
  buildLeadReceivedPayload,
  buildLeadRejectedPayload,
  buildOnboardingCompletePayload,
  platformLeadTemplateLanguage,
  platformLeadTemplateName,
  type PlatformLeadTemplateKey,
  type TemplatePayload,
} from "../../../lib/services/notifications/providers/whatsapp/platform-lead-template-contracts";

const logger = getLogger("platform-lead.notifications");

export type NotifiableLead = {
  id: string;
  name: string;
  phone: string;
  tracking_token: string;
};

/**
 * Every owner-acquisition funnel WhatsApp send, in one place.
 *
 * Delivery policy, uniform across all five: route through
 * whatsAppTemplateDeliveryService so each send is idempotent (via
 * whatsapp_logs.idempotency_key) and leaves an auditable row, and — with
 * the single exception of the activation invite — never throw into the
 * caller's critical path. A WhatsApp outage must not stop a lead being
 * created, an account being activated, or a hostel going live.
 */
export class PlatformLeadNotificationService {
  private async dispatch(options: {
    key: PlatformLeadTemplateKey;
    phone: string;
    payload: TemplatePayload;
    idempotencyKey: string;
    ownerId?: string;
  }): Promise<{ sent: boolean; error?: string }> {
    const templateName = platformLeadTemplateName(options.key);
    try {
      const result = await whatsAppTemplateDeliveryService.send({
        phone: options.phone,
        templateName,
        bodyParameters: options.payload.bodyParameters,
        buttonParameters: options.payload.buttonParameters,
        idempotencyKey: options.idempotencyKey,
        ownerId: options.ownerId,
        languageCode: platformLeadTemplateLanguage(options.key),
      });
      if (result.skipped) {
        logger.info("platform_lead.notification.skipped", { template: templateName, key: options.key });
        return { sent: false };
      }
      return { sent: true };
    } catch (error: any) {
      // Loud, with the template name — templates that do not exist in Meta
      // yet are the expected failure here, and a bare provider error gives
      // no clue which one.
      const message = String(error?.message || error);
      logger.error("platform_lead.notification.failed", {
        template: templateName,
        key: options.key,
        error: message,
      });
      return { sent: false, error: message };
    }
  }

  /** Fire-and-forget acknowledgement, sent the moment an enquiry is submitted. */
  async sendLeadReceived(lead: NotifiableLead): Promise<void> {
    const result = await this.dispatch({
      key: "LEAD_RECEIVED",
      phone: lead.phone,
      payload: buildLeadReceivedPayload({ ownerName: lead.name, trackingToken: lead.tracking_token }),
      idempotencyKey: `lead_received:${lead.id}`,
    });
    await eventLog
      .log(result.sent ? "LEAD_RECEIVED_NOTIFIED" : "LEAD_RECEIVED_NOTIFY_FAILED", null, {
        lead_id: lead.id,
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }

  /**
   * The one send whose outcome the caller acts on: approveLead() holds the
   * lead at APPROVED when this fails, so an admin can retry rather than the
   * lead silently sitting with an undelivered link.
   */
  async sendInvitation(
    lead: NotifiableLead,
    activationToken: string,
    expiryDays: number
  ): Promise<{ whatsapp_sent: boolean; whatsapp_error?: string }> {
    const result = await this.dispatch({
      key: "INVITATION",
      phone: lead.phone,
      payload: buildInvitationPayload({ ownerName: lead.name, expiryDays, activationToken }),
      // Keyed on the token, not the lead — a re-approval issues a new token
      // and must be allowed to send again.
      idempotencyKey: `lead_invitation:${activationToken}`,
    });
    return { whatsapp_sent: result.sent, whatsapp_error: result.error };
  }

  /** Fire-and-forget. Fired after real owner-signup completes. */
  async sendAccountActivated(profileId: string, ownerName: string, phone: string): Promise<void> {
    const result = await this.dispatch({
      key: "ACCOUNT_ACTIVATED",
      phone,
      payload: buildAccountActivatedPayload({ ownerName }),
      idempotencyKey: `owner_account_activated:${profileId}`,
      ownerId: profileId,
    });
    await eventLog
      .log(result.sent ? "owner_account_activated_notified" : "owner_account_activated_notify_failed", profileId, {
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }

  /** Fire-and-forget. Fired when the hostel goes live. */
  async sendOnboardingComplete(lead: NotifiableLead, hostelName: string): Promise<void> {
    const result = await this.dispatch({
      key: "ONBOARDING_COMPLETE",
      phone: lead.phone,
      payload: buildOnboardingCompletePayload({ ownerName: lead.name, hostelName }),
      idempotencyKey: `lead_onboarding_complete:${lead.id}`,
    });
    await eventLog
      .log(result.sent ? "LEAD_LIVE_NOTIFIED" : "LEAD_LIVE_NOTIFY_FAILED", null, {
        lead_id: lead.id,
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }

  /** Fire-and-forget. Fired only by the explicit reject action, never by a plain LOST write. */
  async sendLeadRejected(lead: NotifiableLead, reason: string): Promise<void> {
    const result = await this.dispatch({
      key: "LEAD_REJECTED",
      phone: lead.phone,
      payload: buildLeadRejectedPayload({ ownerName: lead.name, reason }),
      idempotencyKey: `lead_rejected:${lead.id}`,
    });
    await eventLog
      .log(result.sent ? "LEAD_REJECTED_NOTIFIED" : "LEAD_REJECTED_NOTIFY_FAILED", null, {
        lead_id: lead.id,
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }
}

export const platformLeadNotificationService = new PlatformLeadNotificationService();
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "platform-lead|whatsapp-template-delivery" | head -20`
Expected: no output (no errors in the touched files).

- [ ] **Step 5: Confirm the pure suite is unaffected**

Run: `cd apps/backend && npm run test:pure`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/lib/services/notifications/whatsapp-template-delivery.ts \
        apps/backend/src/services/platform-leads/platform-lead-notification-service.ts
git commit -m "feat(leads): add platform-lead notification service, pass button params through delivery"
```

---

### Task 5: Mint tracking token, send acknowledgement, expose public status endpoint

**Files:**
- Modify: `apps/backend/app/api/leads/self-serve/route.ts`
- Create: `apps/backend/app/api/leads/track/[token]/route.ts`

**Interfaces:**
- Consumes: `platformLeadNotificationService` (Task 4), `buildLeadTimeline`/`mapLeadStatusToStage` (Task 3), `tracking_token` column (Task 1).
- Produces: `GET /api/leads/track/:token` returning
  `{ hostel_name: string; submitted_at: string; stage: string; is_terminal: boolean; timeline: LeadDisplayStage[]; applicant_message: string | null }`.

- [ ] **Step 1: Mint the token and send the acknowledgement**

In `apps/backend/app/api/leads/self-serve/route.ts`, add to the imports at the top:

```typescript
import crypto from "crypto";
import { platformLeadNotificationService } from "@/src/services/platform-leads/platform-lead-notification-service";
```

Change the `prisma.platform_leads.create` call to include the token:

```typescript
    const lead = await prisma.platform_leads.create({
      data: {
        name,
        hostel_name,
        phone: normalizedPhone,
        google_email: google_email || null,
        phone_verified: verification.phoneVerified,
        city: city || null,
        bed_count: bed_count ?? null,
        status: "NEW",
        tracking_token: crypto.randomBytes(32).toString("hex"),
      },
    });
```

Then, after the existing `await eventLog.log("LEAD_CREATED", ...)` line and before the `return`, add:

```typescript
    // Fire-and-forget: a WhatsApp outage must never cost us a captured lead.
    // The tracking link is also shown on the submission success screen, so
    // the applicant is not dependent on this message arriving.
    void platformLeadNotificationService
      .sendLeadReceived({ id: lead.id, name: lead.name, phone: lead.phone, tracking_token: lead.tracking_token })
      .catch((err) => console.error("[leads.self-serve] lead-received notify failed", err));
```

Finally, return the token so the frontend can show the tracking link:

```typescript
    return apiResponse({ id: lead.id, status: lead.status, tracking_token: lead.tracking_token }, 201);
```

- [ ] **Step 2: Write the public tracking route**

Create `apps/backend/app/api/leads/track/[token]/route.ts`:

```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildLeadTimeline, mapLeadStatusToStage } from "@/src/services/platform-leads/lead-stage-mapper";

/**
 * GET /api/leads/track/[token] — public enquiry status.
 *
 * Deliberately unauthenticated: a prospective owner has no account yet. The
 * token is a 32-byte bearer secret delivered over WhatsApp, the same trust
 * model as /api/leads/invitation/[token].
 *
 * The response is an explicit allowlist, not a spread of the row. `notes`
 * (the admin's private scratchpad), the row id, `converted_owner_id`, and
 * the raw status string must never reach this surface — see the design doc
 * D2. If you add a column to platform_leads, it does NOT appear here unless
 * someone deliberately adds it below.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const lead = await prisma.platform_leads.findUnique({
      where: { tracking_token: token },
      select: {
        hostel_name: true,
        status: true,
        created_at: true,
        applicant_message: true,
      },
    });

    if (!lead) {
      return apiError("We couldn't find that enquiry.", "NOT_FOUND", 404);
    }

    const stage = mapLeadStatusToStage(lead.status);

    return apiResponse({
      hostel_name: lead.hostel_name,
      submitted_at: lead.created_at,
      stage: stage.label,
      is_terminal: stage.isTerminal,
      timeline: buildLeadTimeline(lead.status),
      applicant_message: lead.applicant_message,
    });
  } catch (error: any) {
    console.error("Detailed API Error [leads.track]:", error);
    return apiError("Could not load your enquiry status.", "INTERNAL_ERROR", 500);
  }
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "leads/track|self-serve" | head -20`
Expected: no output.

- [ ] **Step 4: Verify the route responds**

Run in one terminal: `cd apps/backend && npm run dev`
Then: `curl -s http://localhost:3000/api/leads/track/definitely-not-a-real-token | head -5`
Expected: a 404 JSON body containing `We couldn't find that enquiry.` — **not** an unhandled 500 or an HTML error page.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/leads/self-serve/route.ts apps/backend/app/api/leads/track/
git commit -m "feat(leads): mint tracking token, send enquiry acknowledgement, add public status endpoint"
```

---

### Task 6: Admin reject action and applicant message

**Files:**
- Create: `apps/backend/app/api/platform-admin/leads/[id]/reject/route.ts`
- Modify: `apps/backend/app/api/platform-admin/leads/[id]/route.ts` (the `PATCH` handler)

**Interfaces:**
- Consumes: `canRejectLead` (Task 3), `platformLeadNotificationService` (Task 4).
- Produces: `POST /api/platform-admin/leads/:id/reject` with body `{ reason: string }` → the updated lead. `PATCH /api/platform-admin/leads/:id` additionally accepts `applicant_message`.

- [ ] **Step 1: Write the reject route**

Create `apps/backend/app/api/platform-admin/leads/[id]/reject/route.ts`:

```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { canRejectLead } from "@/src/services/platform-leads/lead-transition-guards";
import { platformLeadNotificationService } from "@/src/services/platform-leads/platform-lead-notification-service";

/**
 * POST /api/platform-admin/leads/[id]/reject — decline an enquiry and tell
 * the applicant why.
 *
 * Deliberately its own endpoint rather than a PATCH to status=LOST, which
 * stays silent. LOST carries two meanings — "we reviewed and declined" and
 * "went cold, stopped replying" — and only the first should trigger a
 * "we are unable to proceed with your application" message. Symmetric with
 * POST .../approve. See design doc D5.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;

  try {
    if (!session || session.role !== "ADMIN") {
      return apiError("Admin access only", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason || "").trim();
    if (!reason) {
      return apiError("A reason is required — it is sent to the applicant.", "VALIDATION_ERROR", 400);
    }

    const lead = await prisma.platform_leads.findUnique({ where: { id } });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);

    const guard = canRejectLead(lead.status);
    if (!guard.ok) return apiError(guard.reason, "INVALID_TRANSITION", 400);

    const updated = await prisma.platform_leads.update({
      where: { id },
      data: { status: "LOST", rejection_reason: reason, updated_at: new Date() },
    });

    await eventLog.log("LEAD_REJECTED", session.sub, { lead_id: id, reason: reason.slice(0, 500) });

    // Fire-and-forget — the decision is already recorded; a WhatsApp failure
    // must not roll it back or 500 the admin's request.
    void platformLeadNotificationService
      .sendLeadRejected(
        { id: updated.id, name: updated.name, phone: updated.phone, tracking_token: updated.tracking_token },
        reason
      )
      .catch((err) => console.error("[leads.reject] notify failed", err));

    return apiResponse(updated);
  } catch (error: any) {
    console.error("Detailed API Error [platform-admin.leads.reject]:", error);
    return apiError("Could not reject this lead.", "INTERNAL_ERROR", 500);
  }
}
```

- [ ] **Step 2: Accept `applicant_message` on PATCH**

In `apps/backend/app/api/platform-admin/leads/[id]/route.ts`, in the `PATCH` handler, change the destructure and the update:

```typescript
    const { status, notes, applicant_message } = body;
```

```typescript
    const updated = await prisma.platform_leads.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
        // Owner-visible on /enquiry/:token. Distinct from `notes`, which is
        // an internal scratchpad and is never returned by a public route.
        ...(applicant_message !== undefined ? { applicant_message: applicant_message || null } : {}),
        updated_at: new Date(),
      },
    });
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "platform-admin/leads" | head -20`
Expected: no output.

- [ ] **Step 4: Verify the route rejects unauthenticated callers**

With `npm run dev` running:
`curl -s -X POST http://localhost:3000/api/platform-admin/leads/00000000-0000-0000-0000-000000000000/reject -H 'Content-Type: application/json' -d '{"reason":"test"}'`
Expected: a 403 body containing `Admin access only`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/platform-admin/leads/
git commit -m "feat(leads): add admin reject action with reason, accept applicant_message on PATCH"
```

---

### Task 7: Wire the remaining three sends into the lifecycle

**Files:**
- Modify: `apps/backend/src/services/platform-leads/lead-invitation-service.ts` (`approveLead`, `dispatchActivationNotification`, `markLive`)
- Modify: `apps/backend/app/api/auth/owner-signup/route.ts:77`

**Interfaces:**
- Consumes: `platformLeadNotificationService` (Task 4).
- Produces: no new exports. `DEFAULT_INVITE_DAYS` (existing, `7`) becomes the value passed as template ②'s `expiry_days`.

> **Deviation from the spec, deliberate.** Design doc §6 says `dispatchActivationNotification()` "moves into" the notification service. In practice only its **WhatsApp half** moves; the **email fallback stays in `lead-invitation-service.ts`**. The fallback is coupled to `approveLead`'s retry semantics (it fires only when WhatsApp did not send, and its result feeds the `INVITE_SENT` decision), and the notification service deliberately has no email dependency — pulling `EmailService` into it would make four fire-and-forget WhatsApp senders carry an email import they never use. Net effect on behaviour: none.

- [ ] **Step 1: Replace the WhatsApp half of `dispatchActivationNotification`**

In `apps/backend/src/services/platform-leads/lead-invitation-service.ts`, change the method signature and its WhatsApp branch. Replace the whole `if (lead.phone) { ... }` block (currently lines ~78-92, which constructs `MetaWhatsAppProvider` directly) with:

```typescript
    if (lead.phone) {
      const result = await platformLeadNotificationService.sendInvitation(
        { id: leadId, name: lead.name, phone: lead.phone, tracking_token: lead.tracking_token },
        activationToken,
        DEFAULT_INVITE_DAYS
      );
      whatsappSent = result.whatsapp_sent;
      whatsappError = result.whatsapp_error;
    }
```

Update the method's signature to receive what it now needs:

```typescript
  private async dispatchActivationNotification(
    leadId: string,
    lead: { name: string; hostel_name: string; phone: string; google_email: string | null; tracking_token: string },
    activationLink: string,
    activationToken: string
  ) {
```

Add the import at the top of the file:

```typescript
import { platformLeadNotificationService } from "./platform-lead-notification-service";
```

- [ ] **Step 2: Update the call site in `approveLead`**

In the same file, change the dispatch call (currently `const delivery = await this.dispatchActivationNotification(lead, activationLink);`) to:

```typescript
    const delivery = await this.dispatchActivationNotification(leadId, lead, activationLink, token);
```

The email fallback branch below it is unchanged — it still fires only when WhatsApp did not send.

- [ ] **Step 3: Send the hostel-live confirmation from `markLive`**

In the same file, replace the body of `markLive` with:

```typescript
  async markLive(token: string) {
    const invitation = await prisma.platform_lead_invitations.findUnique({ where: { token } });
    if (!invitation) return;
    const lead = await prisma.platform_leads.findUnique({ where: { id: invitation.lead_id } });
    if (!lead || lead.status !== "HOSTEL_CREATED") return;
    await prisma.platform_leads.update({ where: { id: lead.id }, data: { status: "LIVE", updated_at: new Date() } });
    await eventLog.log("LEAD_LIVE", lead.converted_owner_id, { lead_id: lead.id });

    // Fire-and-forget — the hostel is already live; a WhatsApp failure must
    // not make it look otherwise.
    void platformLeadNotificationService
      .sendOnboardingComplete(
        { id: lead.id, name: lead.name, phone: lead.phone, tracking_token: lead.tracking_token },
        lead.hostel_name
      )
      .catch((err) => console.error("[lead-invitation-service.markLive] notify failed", err));
  }
```

- [ ] **Step 4: Repoint the post-signup welcome to template ③**

In `apps/backend/app/api/auth/owner-signup/route.ts`, replace the `sendOwnerWelcomeNotification(profile.id)` call (~line 77) with a call to the new service. Add the import:

```typescript
import { platformLeadNotificationService } from "@/src/services/platform-leads/platform-lead-notification-service";
```

and change the call to:

```typescript
      // stayo_owner_welcome is superseded by stayo_owner_account_activated
      // (design doc D4). The old handler and its approved template are left
      // in place but no longer called — see Changelog.
      void platformLeadNotificationService
        .sendAccountActivated(profile.id, profile.name, profile.phone)
        .catch((err) => {
          console.error("[owner-signup] account-activated notify failed", err);
        });
```

Remove the now-unused `sendOwnerWelcomeNotification` import from this file. **Do not delete `whatsapp-owner-welcome-handler.ts`** — leave it importable, since removing it is a separate decision.

- [ ] **Step 5: Verify it type-checks**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lead-invitation-service|owner-signup" | head -20`
Expected: no output. If it complains that `profile.phone` may be null, guard the call with `if (profile.phone)` and log a warning in the else branch.

- [ ] **Step 6: Confirm the pure suite still passes**

Run: `cd apps/backend && npm run test:pure`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/platform-leads/lead-invitation-service.ts \
        apps/backend/app/api/auth/owner-signup/route.ts
git commit -m "feat(leads): route invitation/activated/live sends through the notification service"
```

---

### Task 8: Public enquiry status page

**Files:**
- Modify: `apps/frontend/src/features/hostel-leads/api/index.ts`
- Create: `apps/frontend/src/app/pages/public/EnquiryStatusPage.tsx`
- Modify: `apps/frontend/src/app/router/PublicRoutes.tsx`

**Interfaces:**
- Consumes: `GET /api/leads/track/:token` (Task 5).
- Produces: `hostelLeadsApi.getEnquiryStatus(token)`; route `/enquiry/:token`.

- [ ] **Step 1: Add the API wrapper method**

In `apps/frontend/src/features/hostel-leads/api/index.ts`, add to the `hostelLeadsApi` object (after `submitLead`):

```typescript
  getEnquiryStatus: async (token: string) => {
    const response = await api.get(`/leads/track/${token}`);
    return response.data as {
      hostel_name: string;
      submitted_at: string;
      stage: string;
      is_terminal: boolean;
      timeline: Array<{ key: string; label: string; state: 'done' | 'current' | 'pending' }>;
      applicant_message: string | null;
    };
  },
```

Also widen `submitLead`'s return type, since Task 5 now returns the token:

```typescript
    return response.data as { success: boolean; id: string; status: string; tracking_token: string };
```

- [ ] **Step 2: Write the page**

Create `apps/frontend/src/app/pages/public/EnquiryStatusPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { hostelLeadsApi } from '@features/hostel-leads/api';

/**
 * Public enquiry-status page, reached from the "Track Status" button in the
 * stayo_owner_lead_received WhatsApp template and from the lead-submission
 * success screen. Unauthenticated by design — a prospective owner has no
 * account yet (design doc D1).
 */
export function EnquiryStatusPage() {
  const { token = '' } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['enquiry-status', token],
    queryFn: () => hostelLeadsApi.getEnquiryStatus(token),
    enabled: Boolean(token),
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#FDF8F3] px-5 py-16">
        <div className="mx-auto max-w-md animate-pulse space-y-4">
          <div className="h-6 w-2/3 rounded bg-black/10" />
          <div className="h-32 rounded-2xl bg-black/5" />
        </div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen bg-[#FDF8F3] px-5 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-black/10 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-[#2B1B12]">We couldn't find that enquiry</h1>
          <p className="mt-2 text-sm text-[#6B5B52]">
            This link may be mistyped or no longer valid. If you submitted an enquiry recently,
            check the most recent message we sent you on WhatsApp.
          </p>
          <Link to="/" className="mt-5 inline-block text-sm font-medium text-[#B45309] underline">
            Back to Stayo
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FDF8F3] px-5 py-16">
      <div className="mx-auto max-w-md space-y-5">
        <header>
          <p className="text-xs uppercase tracking-wide text-[#6B5B52]">Your enquiry</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#2B1B12]">{data.hostel_name}</h1>
          <p className="mt-1 text-sm text-[#6B5B52]">
            Submitted {new Date(data.submitted_at).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </p>
        </header>

        <section className="rounded-2xl border border-black/10 bg-white p-5">
          <ol className="space-y-4">
            {data.timeline.map((stage) => (
              <li key={stage.key} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={
                    stage.state === 'done'
                      ? 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#15803D]'
                      : stage.state === 'current'
                        ? 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#B45309] ring-4 ring-[#B45309]/20'
                        : 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-black/20 bg-transparent'
                  }
                />
                <span
                  className={
                    stage.state === 'pending'
                      ? 'text-sm text-[#9A8B82]'
                      : 'text-sm font-medium text-[#2B1B12]'
                  }
                >
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {data.applicant_message ? (
          <section className="rounded-2xl border border-[#B45309]/20 bg-[#FEF6EC] p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#B45309]">
              Message from our team
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm text-[#2B1B12]">{data.applicant_message}</p>
          </section>
        ) : null}

        {!data.is_terminal ? (
          <p className="px-1 text-center text-xs text-[#6B5B52]">
            We'll message you on WhatsApp as soon as there's an update. You can return to this page any time.
          </p>
        ) : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Register the route**

In `apps/frontend/src/app/router/PublicRoutes.tsx`, add the lazy import alongside the other public pages (after the `OwnerLeadInvitePage` line):

```tsx
const EnquiryStatusPage = lazy(() => import('@/app/pages/public/EnquiryStatusPage').then((m) => ({ default: m.EnquiryStatusPage })));
```

and the route immediately after the existing `/owner-invite/:token` route (line ~63):

```tsx
        <Route path="/enquiry/:token" element={<EnquiryStatusPage />} />
```

- [ ] **Step 4: Verify the architecture check and build pass**

Run: `cd apps/frontend && npm run check:architecture && npm run build`
Expected: both succeed. The architecture check fails loudly if the new page reached for `fetch`/`axios` directly instead of `@lib/api-client`.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/hostel-leads/api/index.ts \
        apps/frontend/src/app/pages/public/EnquiryStatusPage.tsx \
        apps/frontend/src/app/router/PublicRoutes.tsx
git commit -m "feat(leads): add public /enquiry/:token status page"
```

---

### Task 9: Scroll-depth enquiry prompt on the landing page

**Files:**
- Create: `apps/frontend/src/features/owner-onboarding/enquiryPromptPolicy.ts`
- Create: `apps/frontend/src/features/owner-onboarding/enquiryPromptPolicy.test.ts`
- Create: `apps/frontend/src/features/owner-onboarding/components/OwnerEnquiryPrompt.tsx`
- Modify: `apps/frontend/src/app/pages/public/LandingPage.tsx`

**Interfaces:**
- Consumes: `LandingPage`'s existing `openOwnerAuth()` and `session` from `useOwnerSession()`.
- Produces: `shouldShowEnquiryPrompt(input): boolean`, `ENQUIRY_PROMPT_DISMISS_KEY`, `ENQUIRY_PROMPT_COOLDOWN_MS`, `ENQUIRY_PROMPT_SCROLL_THRESHOLD`, and the `<OwnerEnquiryPrompt />` component.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/features/owner-onboarding/enquiryPromptPolicy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  shouldShowEnquiryPrompt,
  ENQUIRY_PROMPT_COOLDOWN_MS,
  ENQUIRY_PROMPT_SCROLL_THRESHOLD,
} from './enquiryPromptPolicy';

const NOW = new Date('2026-08-06T12:00:00Z').getTime();

const base = {
  scrollFraction: 0.5,
  dismissedAt: null as number | null,
  isOwnerWithHostel: false,
  alreadyShownThisSession: false,
  now: NOW,
};

describe('shouldShowEnquiryPrompt', () => {
  it('shows once the visitor has scrolled past the threshold', () => {
    expect(shouldShowEnquiryPrompt(base)).toBe(true);
  });

  it('stays hidden above the fold', () => {
    expect(shouldShowEnquiryPrompt({ ...base, scrollFraction: ENQUIRY_PROMPT_SCROLL_THRESHOLD - 0.01 })).toBe(false);
  });

  // An owner who already has a hostel is not a lead. The landing CTA already
  // sends them to the dashboard; the prompt must not contradict it.
  it('never interrupts an owner who already has a hostel', () => {
    expect(shouldShowEnquiryPrompt({ ...base, isOwnerWithHostel: true })).toBe(false);
  });

  it('respects a recent dismissal', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: NOW - 1000 })).toBe(false);
  });

  it('shows again once the cooldown has elapsed', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: NOW - ENQUIRY_PROMPT_COOLDOWN_MS - 1 })).toBe(true);
  });

  it('does not reappear after being shown once in the same session', () => {
    expect(shouldShowEnquiryPrompt({ ...base, alreadyShownThisSession: true })).toBe(false);
  });

  // A corrupt localStorage value must not wedge the prompt permanently off.
  it('ignores an unparseable dismissal timestamp', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: Number.NaN })).toBe(true);
  });

  it('ignores a dismissal timestamp from the future', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: NOW + 60_000 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-onboarding/enquiryPromptPolicy.test.ts`
Expected: FAIL — cannot resolve `./enquiryPromptPolicy`.

- [ ] **Step 3: Write the policy module**

Create `apps/frontend/src/features/owner-onboarding/enquiryPromptPolicy.ts`:

```typescript
/**
 * Decides whether the "Are you a hostel owner?" prompt should appear.
 *
 * Pure and separated from the component so the rules — which are the part
 * that is easy to get wrong and annoying when wrong — are testable in the
 * node-only test environment (`apps/frontend` has no jsdom).
 */

/** Fires once the visitor is past the hero, which is genuine interest rather than a bounce. */
export const ENQUIRY_PROMPT_SCROLL_THRESHOLD = 0.4;

/** A dismissal is respected for 7 days. */
export const ENQUIRY_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const ENQUIRY_PROMPT_DISMISS_KEY = 'stayo.enquiryPrompt.dismissedAt';

export type EnquiryPromptInput = {
  scrollFraction: number;
  /** Epoch ms from localStorage, or null if never dismissed. May be NaN if the stored value was corrupt. */
  dismissedAt: number | null;
  /** An authenticated owner who already has a hostel is not a lead. */
  isOwnerWithHostel: boolean;
  alreadyShownThisSession: boolean;
  now: number;
};

export function shouldShowEnquiryPrompt(input: EnquiryPromptInput): boolean {
  if (input.isOwnerWithHostel) return false;
  if (input.alreadyShownThisSession) return false;
  if (input.scrollFraction < ENQUIRY_PROMPT_SCROLL_THRESHOLD) return false;

  const dismissedAt = input.dismissedAt;
  if (dismissedAt !== null && Number.isFinite(dismissedAt)) {
    const elapsed = input.now - dismissedAt;
    // A future timestamp means a corrupt or clock-skewed value — treat it as
    // no dismissal rather than suppressing the prompt indefinitely.
    if (elapsed >= 0 && elapsed <= ENQUIRY_PROMPT_COOLDOWN_MS) return false;
  }

  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/owner-onboarding/enquiryPromptPolicy.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the component**

Create `apps/frontend/src/features/owner-onboarding/components/OwnerEnquiryPrompt.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  ENQUIRY_PROMPT_DISMISS_KEY,
  shouldShowEnquiryPrompt,
} from '../enquiryPromptPolicy';

type OwnerEnquiryPromptProps = {
  isOwnerWithHostel: boolean;
  onAccept: () => void;
};

function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(ENQUIRY_PROMPT_DISMISS_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    // Private-mode or blocked storage — treat as never dismissed rather than crashing.
    return null;
  }
}

/**
 * "Are you a hostel owner?" — appears once the visitor scrolls past the hero.
 *
 * Accepting calls straight into the landing page's existing owner entry
 * point, so there is exactly one lead-capture flow (Google → details → phone
 * OTP), not a second one duplicated here. All show/hide rules live in the
 * tested `enquiryPromptPolicy` module.
 */
export function OwnerEnquiryPrompt({ isOwnerWithHostel, onAccept }: OwnerEnquiryPromptProps) {
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const scrollFraction = scrollable > 0 ? window.scrollY / scrollable : 0;

      if (
        shouldShowEnquiryPrompt({
          scrollFraction,
          dismissedAt: readDismissedAt(),
          isOwnerWithHostel,
          alreadyShownThisSession: shownRef.current,
          now: Date.now(),
        })
      ) {
        shownRef.current = true;
        setVisible(true);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isOwnerWithHostel]);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(ENQUIRY_PROMPT_DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — the session-level guard still stops it reappearing on this page view.
    }
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Are you a hostel owner?"
      className="fixed inset-x-4 bottom-4 z-[120] mx-auto max-w-sm rounded-2xl border border-black/10 bg-white p-5 shadow-xl sm:right-6 sm:left-auto"
    >
      <h2 className="text-base font-semibold text-[#2B1B12]">Are you a hostel owner?</h2>
      <p className="mt-1.5 text-sm text-[#6B5B52]">
        Tell us about your property and we'll get you set up on Stayo.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => {
            dismiss();
            onAccept();
          }}
          className="flex-1 rounded-xl bg-[#2B1B12] px-4 py-2.5 text-sm font-medium text-white"
        >
          Yes, I am
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-medium text-[#6B5B52]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Mount it on the landing page**

In `apps/frontend/src/app/pages/public/LandingPage.tsx`, add the import near the other feature imports:

```tsx
import { OwnerEnquiryPrompt } from '@features/owner-onboarding/components/OwnerEnquiryPrompt';
```

and render it immediately after the existing `<GoogleSignInModal ... />` line (~line 151):

```tsx
      <OwnerEnquiryPrompt
        isOwnerWithHostel={session.isAuthenticated && session.hostels.length > 0}
        onAccept={openOwnerAuth}
      />
```

- [ ] **Step 7: Verify the full frontend suite and build**

Run: `cd apps/frontend && npm test && npm run build`
Expected: all tests pass; build succeeds (architecture + branding checks included).

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/features/owner-onboarding/enquiryPromptPolicy.ts \
        apps/frontend/src/features/owner-onboarding/enquiryPromptPolicy.test.ts \
        apps/frontend/src/features/owner-onboarding/components/OwnerEnquiryPrompt.tsx \
        apps/frontend/src/app/pages/public/LandingPage.tsx
git commit -m "feat(landing): add scroll-depth hostel-owner enquiry prompt"
```

---

### Task 10: Admin reject UI, applicant message, and the tracking link on submission

**Files:**
- Modify: `apps/frontend/src/platforms/admin/pages/AdminLeadsPage.tsx`
- Modify: `apps/frontend/src/features/owner-onboarding/components/HostelLeadModal.tsx`
- Modify: `apps/frontend/src/features/hostel-leads/api/index.ts`

**Interfaces:**
- Consumes: `POST /api/platform-admin/leads/:id/reject` and `PATCH .../:id` with `applicant_message` (Task 6); `submitLead`'s `tracking_token` (Task 5).
- Produces: `platformAdminService.rejectLead(id, reason)`, `platformAdminService.updateLeadApplicantMessage(id, message)`.

> **Read this before starting.** `AdminLeadsPage.tsx` **already has a "Reject" button** (lines 329-338) — it fires `statusMutation.mutate({ status: 'LOST' })`, i.e. exactly the silent path design doc D5 replaces. This task **rewires the existing button**, it does not add a new one. Two further facts that contradict the obvious guesses: the page calls `platformAdminService` from `@features/platform-admin/api` (not `hostelLeadsApi`), and there is **no `notes` editor** on this page at all — `notes` is rendered read-only in the Details card at line 297. So the applicant-message field is a new editor with no existing sibling to sit beside.

- [ ] **Step 1: Add the two API wrappers**

In `apps/frontend/src/features/platform-admin/api/index.ts`, add immediately after `approveLead` (~line 47), matching the surrounding `unwrap(response)` style:

```typescript
  rejectLead: async (id: string, reason: string) => {
    const response = await api.post(`/platform-admin/leads/${id}/reject`, { reason });
    return unwrap(response);
  },
  updateLeadApplicantMessage: async (id: string, applicant_message: string) => {
    const response = await api.patch(`/platform-admin/leads/${id}`, { applicant_message });
    return unwrap(response);
  },
```

- [ ] **Step 2: Add the reject mutation and its state**

In `AdminLeadsPage.tsx`, add to the constants near the top (after `APPROVABLE_STATUSES`, line 26):

```typescript
// Mirrors canRejectLead() in lead-transition-guards.ts. Once an activation
// link has been issued, declining is a cancellation of that invitation, not
// a status write — so the button must not be offered for APPROVED onward,
// which the old silent `status: LOST` button wrongly allowed.
const REJECTABLE_STATUSES = ['NEW', 'UNDER_REVIEW'];
```

Add state alongside the existing `useState` calls in the component (after `const [openId, setOpenId] = useState<string | null>(null);`, line 87):

```typescript
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [applicantMessage, setApplicantMessage] = useState('');
```

Add the mutation after `approveMutation` (line 119), mirroring its invalidation exactly:

```typescript
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => platformAdminService.rejectLead(id, reason),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead-detail', variables.id] });
      stayoToast.success('Lead rejected — the applicant has been notified');
      setRejectOpen(false);
      setRejectReason('');
      setOpenId(null);
    },
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not reject lead'),
  });

  const applicantMessageMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      platformAdminService.updateLeadApplicantMessage(id, message),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead-detail', variables.id] });
      stayoToast.success('Message saved — the applicant can see it now');
    },
    onError: () => stayoToast.error('Could not save the message'),
  });
```

- [ ] **Step 3: Seed the applicant-message field when the drawer opens**

Add this effect after the `leadDetailQuery` declaration (line 125). Without it, the textarea stays empty when reopening a lead that already has a message, and saving would silently wipe it.

```typescript
  useEffect(() => {
    setApplicantMessage(leadDetailQuery.data?.applicant_message ?? '');
    setRejectOpen(false);
    setRejectReason('');
  }, [leadDetailQuery.data?.applicant_message, openId]);
```

Add `useEffect` to the React import on line 1:

```typescript
import { useEffect, useState } from 'react';
```

- [ ] **Step 4: Add the applicant-message editor to the drawer**

In `AdminLeadsPage.tsx`, insert this block immediately **before** the `Timeline` heading (line 300, the `<div className="mb-3 mt-6 ...">Timeline</div>`):

```tsx
              <div className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-[0.05em] text-[#9C9186]">
                Message to applicant
              </div>
              <div className="rounded-[13px] border border-[#EFE6DA] bg-white p-4">
                <p className="mb-2 text-[11.5px] leading-relaxed text-[#8A7F75]">
                  Shown to them on their enquiry status page. Internal notes above are never shown.
                </p>
                <textarea
                  value={applicantMessage}
                  onChange={(e) => setApplicantMessage(e.target.value)}
                  rows={3}
                  placeholder="e.g. Thanks — we're verifying your property details and will be back by Friday."
                  className="w-full resize-none rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2.5 text-[12.5px] text-foreground outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={applicantMessageMutation.isPending}
                  onClick={() => applicantMessageMutation.mutate({ id: openLead.id, message: applicantMessage })}
                  className="mt-2 h-9 w-full rounded-[10px] border border-[#E7DDD1] bg-white text-[12px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary disabled:opacity-60"
                >
                  {applicantMessageMutation.isPending ? 'Saving…' : 'Save message'}
                </button>
              </div>
```

Then label the read-only `notes` row (line 297) so the two cannot be confused — change `Notes` to `Internal notes`:

```tsx
                {openLead.notes && <div className="flex justify-between gap-3"><span className="flex-none text-[12.5px] text-[#8A7F75]">Internal notes</span><span className="text-right text-[12.5px] text-foreground">{openLead.notes}</span></div>}
```

- [ ] **Step 5: Rewire the existing Reject button**

Replace the entire footer block (lines 318-341, from `{APPROVABLE_STATUSES.includes(openLead.status) && (` through its closing `)}`) with:

```tsx
            {(APPROVABLE_STATUSES.includes(openLead.status) || REJECTABLE_STATUSES.includes(openLead.status)) && (
              <div className="flex-none border-t border-[#EFE6DA] bg-white px-[22px] py-4">
                {rejectOpen ? (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9C9186]">
                      Reason for rejection
                    </label>
                    <p className="mb-2 text-[11.5px] leading-relaxed text-[#8A7F75]">
                      This is sent to the applicant on WhatsApp, so write it for them to read.
                    </p>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="e.g. We're not onboarding properties in this city yet."
                      className="w-full resize-none rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2.5 text-[12.5px] text-foreground outline-none focus:border-primary"
                    />
                    <div className="mt-2.5 flex gap-2.5">
                      <button
                        type="button"
                        disabled={!rejectReason.trim() || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate({ id: openLead.id, reason: rejectReason.trim() })}
                        className="h-10 flex-1 rounded-[10px] bg-[#C0503A] text-[12.5px] font-bold text-white disabled:opacity-50"
                      >
                        {rejectMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRejectOpen(false); setRejectReason(''); }}
                        className="h-10 flex-1 rounded-[10px] border border-[#E7DDD1] bg-white text-[12.5px] font-bold text-[#8A7F75]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2.5">
                    {APPROVABLE_STATUSES.includes(openLead.status) && (
                      <button
                        type="button"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(openLead.id)}
                        className="h-10 flex-1 rounded-[10px] bg-success text-[12.5px] font-bold text-white disabled:opacity-60"
                      >
                        {approveMutation.isPending ? 'Sending…' : openLead.status === 'APPROVED' ? 'Retry Send' : 'Approve Lead'}
                      </button>
                    )}
                    {REJECTABLE_STATUSES.includes(openLead.status) && (
                      <button
                        type="button"
                        onClick={() => setRejectOpen(true)}
                        className="h-10 flex-1 rounded-[10px] border border-[#EAD0C9] bg-white text-[12.5px] font-bold text-[#C0503A]"
                      >
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
```

Note what changed and why: the old button set `status: LOST` with no reason and no message to the applicant, and was shown for `APPROVED` leads too — both now fixed. A lead that has gone cold can still be marked `LOST` silently via the existing **Status** dropdown at line 260, which is exactly the distinction D5 draws.

- [ ] **Step 6: Show the tracking link on submission success**

In `HostelLeadModal.tsx`, capture the returned token. Add state next to the other `useState` calls (after `const [error, setError] = useState('');`, line 39):

```typescript
  const [trackingToken, setTrackingToken] = useState('');
```

Reset it in the existing `useEffect` that clears the form on open (after `setError('');`, line 48):

```typescript
      setTrackingToken('');
```

Change `submitLead` (lines 57-63) to keep the token:

```typescript
  const submitLead = async () => {
    const result = await hostelLeadsApi.submitLead({
      name: ownerName.trim(),
      hostel_name: hostelName.trim(),
      phone: phone.trim(),
      google_email: googleEmail,
    });
    setTrackingToken(result.tracking_token);
    return result;
  };
```

Then, in the `step === 'done'` block, insert the tracking link between the paragraph and the "Got it" button (after the `</p>` on line 253):

```tsx
              {trackingToken && (
                <a
                  href={`/enquiry/${trackingToken}`}
                  className="mb-4 block text-sm font-bold text-primary underline"
                >
                  Track your enquiry
                </a>
              )}
```

This link matters more than it looks: until the Meta templates are approved, it is the applicant's **only** copy of their tracking URL, because the WhatsApp carrying it will not deliver.

- [ ] **Step 7: Verify build and tests**

Run: `cd apps/frontend && npm test && npm run build`
Expected: all pass.

- [ ] **Step 8: Verify the admin flow against a real lead**

With the backend running and logged in as an admin, open `/admin/leads`, pick a lead at `NEW`, and confirm:
- "Message to applicant" saves and then appears at `/enquiry/<that lead's token>`;
- "Internal notes" does **not** appear on that page;
- Reject requires a reason, moves the lead to `LOST`, and the reject button is unavailable on an already-approved lead.

Record what you observed. If any of these does not hold, fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/platforms/admin/pages/AdminLeadsPage.tsx \
        apps/frontend/src/features/owner-onboarding/components/HostelLeadModal.tsx \
        apps/frontend/src/features/platform-admin/api/index.ts
git commit -m "feat(admin): rewire lead reject to the notifying endpoint, add applicant message and tracking link"
```

---

### Task 11: Documentation and environment variables

**Files:**
- Modify: `docs/obsidian/Features.md`, `APIs.md`, `Database.md`, `Business-Rules.md`, `Decisions.md`, `Changelog.md`
- Modify: `.env.example` (repo root, if present — check first with `ls -a /home/sp/Desktop/stayo/.env*`)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Document the new env vars**

If `.env.example` exists at the repo root, add:

```bash
# Owner-acquisition funnel WhatsApp templates. Defaults are the stayo_owner_*
# names; override only if Meta forces a rename during template review.
WHATSAPP_OWNER_LEAD_RECEIVED_TEMPLATE=stayo_owner_lead_received
WHATSAPP_OWNER_INVITATION_TEMPLATE=stayo_owner_invitation
WHATSAPP_OWNER_ACCOUNT_ACTIVATED_TEMPLATE=stayo_owner_account_activated
WHATSAPP_OWNER_ONBOARDING_COMPLETE_TEMPLATE=stayo_owner_onboarding_complete
WHATSAPP_OWNER_LEAD_REJECTED_TEMPLATE=stayo_owner_lead_rejected
```

- [ ] **Step 2: Update `docs/obsidian/Database.md`**

Add the three `platform_leads` columns with their purpose, and state explicitly that `notes` is admin-private while `applicant_message` is owner-visible. Link to [[Business-Rules]].

- [ ] **Step 3: Update `docs/obsidian/APIs.md`**

Add `GET /api/leads/track/[token]` (public, unauthenticated, allowlisted response) and `POST /api/platform-admin/leads/[id]/reject` (admin, requires reason). Note that `PATCH /api/platform-admin/leads/[id]` now also accepts `applicant_message`. Link to [[Business-Rules]] and [[Features]].

- [ ] **Step 4: Update `docs/obsidian/Business-Rules.md`**

Add a "Owner-acquisition funnel notifications" section covering: the five templates and their triggers; that four of five are fire-and-forget while the invitation send is load-bearing (holds the lead at `APPROVED` on failure); and the **reject-vs-cold-lead rule** — a plain PATCH to `LOST` is silent, only `POST .../reject` notifies. Link to [[Features]] and [[Decisions]].

- [ ] **Step 5: Update `docs/obsidian/Features.md`**

Extend the existing "StayO owner-acquisition funnel" entry (~line 261) rather than adding a competing one. Record the new touchpoints, the `/enquiry/:token` surface, the scroll-depth prompt, and — honestly — that templates ①②④⑤ are not yet approved in Meta so those sends do not deliver yet.

- [ ] **Step 6: Add ADRs to `docs/obsidian/Decisions.md`**

Two entries, numbered after the highest existing ADR:
- **Tokenized public enquiry tracking** — why a bearer token rather than OTP or Google re-auth, and the accepted trade-off that the link is shareable.
- **Explicit reject action** — why declining is its own endpoint and not a status write, and why `APPROVED`-and-beyond is refused.

Also note the deliberate departure from one-file-per-template in favour of the registry module, and that `stayo_owner_welcome` is now orphaned.

- [ ] **Step 7: Add a `docs/obsidian/Changelog.md` entry**

One entry covering the feature, the schema change, the two ADRs, and the orphaned template.

- [ ] **Step 8: Verify no vault page contradicts the code**

Run: `grep -rn "owner_lead_activation_v1\|stayo_owner_welcome" docs/obsidian/`
Expected: any hit is now either removed or explicitly marked historical. Fix any that still describe them as current.

- [ ] **Step 9: Commit**

```bash
git add docs/obsidian/ .env.example
git commit -m "docs: record owner lead funnel notifications, tracking surface, and two ADRs"
```

---

## Final Verification

- [ ] `cd apps/backend && npm run test:pure` — all pass, including the two new files
- [ ] `cd apps/backend && npm run lint` — clean
- [ ] `cd apps/frontend && npm test` — all pass
- [ ] `cd apps/frontend && npm run build` — succeeds (runs `check:architecture` and the branding check)
- [ ] `git log --oneline dev..HEAD` — 11 commits, one per task
- [ ] Manual: submit an enquiry end to end, confirm the lead row has a `tracking_token`, open `/enquiry/<token>`, confirm the timeline renders and `notes` is absent from the network response

**Do not merge to `dev` before:** `git fetch origin && git merge origin/main` into this branch, per the repo's workflow — `origin/main` moves fast and has previously gained 20+ commits between two same-day branches.
