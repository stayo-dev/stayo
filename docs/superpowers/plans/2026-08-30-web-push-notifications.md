# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add web push as a fourth notification channel, so Stayo can reach owners and tenants who do not currently have the app open.

**Architecture:** Push is a channel on an existing event stream, not a new system. All 22 in-app notification call sites already funnel through `notificationService.createNotification(profileId, title, message, type)`, and that `type` is exactly the key the push policy is indexed by — so one hook there covers the whole catalogue. A push-only service worker (no `fetch` handler, therefore no caching and no change to SPA update behaviour) receives the messages. Rent reminders currently bypass `createNotification` entirely and must be fixed to use it.

**Tech Stack:** Next.js 14 App Router + Prisma + Postgres (backend), Vite + React 19 (frontend), `web-push` (new dependency), VAPID, Web Push API, Service Worker API.

**Spec:** `docs/superpowers/specs/2026-08-30-web-push-notifications-design.md` — read it first; this plan argues from it.

## Global Constraints

- **Migrate before deploy.** Apply `078_push_subscriptions.sql` BEFORE deploying any code that references the new model. This repo has already taken production down by doing this in the wrong order.
- **Nothing in the push path may throw or block.** Every send is fire-and-forget with a swallowed rejection. A push failure must never fail, delay, or roll back the notification write — that write runs on paths that record money.
- **Unknown notification types default to NO push.** A type added later must not silently acquire a push channel.
- **Backend pure tests must be added to `apps/backend/vitest.pure.config.ts`'s `include` array.** It is an allowlist, not a glob — a file left out silently never runs.
- **Frontend tests are node-environment only, matching `src/**/*.test.ts`.** No jsdom, no component rendering, no `.test.tsx`. Put decision logic in pure `.ts` modules and test those.
- **Backend env vars load from the repo root `../.env`**, not `apps/backend/.env`.
- **Baseline:** `apps/backend/tests/agreement-requirement.test.ts` has 2 pre-existing failures from concurrent work. Not a regression; do not fix as part of this plan.
- **Frontend baseline:** `npm run typecheck` has pre-existing errors in `portal/`, `onboarding/`, `tenants/` and `QuickCollectModal.tsx`. Only new errors in touched files count.

## File Structure

**Backend — new**
- `apps/backend/src/services/notifications/push/push-policy.ts` — pure: which types push, and each one's deep link.
- `apps/backend/src/services/notifications/push/send-window.ts` — pure: quiet hours.
- `apps/backend/src/services/notifications/push/push-sender.ts` — impure: web-push delivery, subscription pruning.
- `apps/backend/app/api/push/subscriptions/route.ts` — POST/DELETE.
- `migrations/078_push_subscriptions.sql`

**Backend — modified**
- `apps/backend/prisma/schema.prisma` — new `push_subscriptions` model + relation on `profile`.
- `apps/backend/lib/services/notification-service.ts` — the one hook.
- `apps/backend/src/services/payments/reminder-service.ts` — fix the fake `in_app`, add `push` channel.
- `apps/backend/vitest.pure.config.ts` — register new pure tests.

**Frontend — new**
- `apps/frontend/public/sw.js` — push-only service worker.
- `apps/frontend/src/features/push/pushSupport.ts` — pure: capability + permission state.
- `apps/frontend/src/features/push/pushPrompt.ts` — pure: soft-prompt gating.
- `apps/frontend/src/features/push/usePushSubscription.ts` — impure: register, subscribe, POST.
- `apps/frontend/src/features/push/PushPromptCard.tsx` — the soft prompt UI.
- `apps/frontend/src/features/push/api/pushApi.ts` — API wrapper (required: only this layer may know endpoint shapes).

**Frontend — modified**
- `apps/frontend/src/features/owner-more/config/deriveNotificationSections.ts` — `push` as a fourth channel.

---

### Task 1: Push policy (pure, backend)

**Files:**
- Create: `apps/backend/src/services/notifications/push/push-policy.ts`
- Test: `apps/backend/tests/push-policy.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the test to `include`)

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldPush(type: string): boolean`, `pushLinkFor(type: string): string`, `PUSH_TYPES: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/push-policy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { shouldPush, pushLinkFor } from "@/src/services/notifications/push/push-policy";

describe("shouldPush", () => {
  it("pushes the money and commitment events", () => {
    for (const t of ["rent_reminder", "payment", "announcement", "service_request",
                     "agreement_lifecycle", "renewal_offer", "move_out_dispute",
                     "tenancy_claim", "food_poll_opened", "food_voting_opened",
                     "lead", "marketing", "document_rejected",
                     "payout_collected", "payout_sent", "payout_paid", "payout_failed"]) {
      expect(shouldPush(t), t).toBe(true);
    }
  });

  it("does not push routine good news or internal plumbing", () => {
    for (const t of ["food_schedule_published", "info",
                     "platform_broadcast", "tenant_analytics",
                     // Briefings are WhatsApp-only and never reach createNotification.
                     "daily_briefing"]) {
      expect(shouldPush(t), t).toBe(false);
    }
  });

  it("defaults an unknown type to NO push, so a new type cannot silently acquire one", () => {
    expect(shouldPush("some_type_invented_next_month")).toBe(false);
  });

  it("matches case-insensitively, because createNotification lowercases the type", () => {
    expect(shouldPush("ANNOUNCEMENT")).toBe(true);
  });
});

describe("pushLinkFor", () => {
  it("deep-links a tenant rent reminder to the money tab", () => {
    expect(pushLinkFor("rent_reminder")).toBe("/tenant/money");
  });

  it("deep-links an owner lead to the alerts screen", () => {
    expect(pushLinkFor("lead")).toBe("/owner/alerts");
  });

  it("deep-links every payout stage to the money screen", () => {
    for (const t of ["payout_collected", "payout_sent", "payout_paid", "payout_failed"]) {
      expect(pushLinkFor(t), t).toBe("/owner/money");
    }
  });

  it("falls back to the notifications list for a type with no specific home", () => {
    expect(pushLinkFor("unmapped_type")).toBe("/tenant/notifications");
  });
});
```

- [ ] **Step 2: Verify every type string against what the code actually writes**

`notifications.type` is a plain string, not an enum, so a typo here produces a policy that
silently never matches. For each type in the test above, confirm a writer exists:

Run:
```bash
cd apps/backend
for t in rent_reminder payment announcement service_request agreement_lifecycle \
         renewal_offer move_out_dispute tenancy_claim food_poll_opened \
         food_voting_opened document_rejected lead marketing \
         payout_collected payout_sent payout_paid payout_failed; do
  printf "%-22s " "$t"; grep -rl "\"$t\"" --include=*.ts lib/ src/ app/ 2>/dev/null | head -1 || echo "MISSING"
done
```
Expected: every one resolves to a file **except `rent_reminder`**, which Task 7 introduces.
Anything else reporting MISSING is a typo — fix the policy, not the test.

- [ ] **Step 3: Register the test in the pure config**

In `apps/backend/vitest.pure.config.ts`, add to the `include` array:
```ts
      'tests/push-policy.test.ts',
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/push-policy.test.ts`
Expected: FAIL — `Cannot find module '@/src/services/notifications/push/push-policy'`

- [ ] **Step 5: Write minimal implementation**

`apps/backend/src/services/notifications/push/push-policy.ts`:
```ts
/**
 * Which notification types earn a push, and where tapping one lands.
 *
 * The "no" list is load-bearing. A channel that fires on weekly menus and
 * verified documents teaches people to swipe everything away, and then the
 * rent reminder gets swiped too.
 *
 * PURE — no Prisma, no network. Runs in the pure suite.
 */

/** Everything that pushes. Anything absent does not — see `shouldPush`. */
export const PUSH_TYPES: ReadonlySet<string> = new Set([
  // Tenant
  "rent_reminder",
  "payment",
  "announcement",
  "service_request",
  "agreement_lifecycle",
  "renewal_offer",
  "move_out_dispute",
  "move_out",
  "tenancy_claim",
  "tenancy_claim_dispute",
  "food_poll_opened",
  "food_voting_opened",
  "document_rejected",
  // Owner
  "lead",
  "marketing",
  "payout_collected",
  "payout_sent",
  "payout_paid",
  "payout_failed",
]);

/*
 * Deliberately absent: `daily_briefing`. The briefing cron sends a WhatsApp
 * template directly and never calls `createNotification`, so listing it here
 * would be dead config — a push that could never fire. Pushing briefings needs
 * its own integration in that cron and is out of scope for v1.
 */

/**
 * An unknown type is **not** pushed.
 *
 * This default is the whole safety property: someone adding a notification
 * type next month gets in-app delivery and has to opt into push deliberately,
 * rather than discovering they have been buzzing every tenant since Tuesday.
 */
export function shouldPush(type: string): boolean {
  return PUSH_TYPES.has(type.toLowerCase());
}

/** Where tapping the notification should land. */
const LINKS: Record<string, string> = {
  rent_reminder: "/tenant/money",
  payment: "/tenant/money",
  announcement: "/tenant/home",
  service_request: "/tenant/room",
  agreement_lifecycle: "/tenant/home",
  renewal_offer: "/tenant/home",
  move_out_dispute: "/tenant/home",
  move_out: "/tenant/home",
  tenancy_claim: "/tenant/home",
  tenancy_claim_dispute: "/tenant/home",
  food_poll_opened: "/tenant/food",
  food_voting_opened: "/tenant/food",
  document_rejected: "/tenant/profile/details",
  lead: "/owner/alerts",
  marketing: "/owner/more",
  payout_collected: "/owner/money",
  payout_sent: "/owner/money",
  payout_paid: "/owner/money",
  payout_failed: "/owner/money",
};

export function pushLinkFor(type: string): string {
  return LINKS[type.toLowerCase()] ?? "/tenant/notifications";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/push-policy.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/notifications/push/push-policy.ts apps/backend/tests/push-policy.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(push): the policy for which notifications earn a push"
```

---

### Task 2: Quiet hours (pure, backend)

**Files:**
- Create: `apps/backend/src/services/notifications/push/send-window.ts`
- Test: `apps/backend/tests/push-send-window.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `withinSendWindow(now: Date): boolean`, `SEND_WINDOW_START_HOUR_IST = 8`, `SEND_WINDOW_END_HOUR_IST = 21`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/push-send-window.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { withinSendWindow } from "@/src/services/notifications/push/send-window";

/** IST is UTC+5:30, so 08:00 IST is 02:30 UTC and 21:00 IST is 15:30 UTC. */
describe("withinSendWindow", () => {
  it("allows a mid-morning IST send", () => {
    expect(withinSendWindow(new Date("2026-08-30T05:00:00.000Z"))).toBe(true); // 10:30 IST
  });

  it("blocks the middle of the night in IST", () => {
    expect(withinSendWindow(new Date("2026-08-30T21:00:00.000Z"))).toBe(false); // 02:30 IST
  });

  it("allows exactly the opening boundary", () => {
    expect(withinSendWindow(new Date("2026-08-30T02:30:00.000Z"))).toBe(true); // 08:00 IST
  });

  it("blocks one minute before opening", () => {
    expect(withinSendWindow(new Date("2026-08-30T02:29:00.000Z"))).toBe(false); // 07:59 IST
  });

  it("blocks exactly the closing boundary, so 21:00 IST is already quiet", () => {
    expect(withinSendWindow(new Date("2026-08-30T15:30:00.000Z"))).toBe(false); // 21:00 IST
  });

  it("allows one minute before closing", () => {
    expect(withinSendWindow(new Date("2026-08-30T15:29:00.000Z"))).toBe(true); // 20:59 IST
  });

  it("handles a UTC evening that is already the next IST morning", () => {
    expect(withinSendWindow(new Date("2026-08-30T19:00:00.000Z"))).toBe(false); // 00:30 IST
  });
});
```

- [ ] **Step 2: Register the test**

Add to `apps/backend/vitest.pure.config.ts`'s `include`:
```ts
      'tests/push-send-window.test.ts',
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/push-send-window.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write minimal implementation**

`apps/backend/src/services/notifications/push/send-window.ts`:
```ts
/**
 * Quiet hours for **scheduled** pushes only — rent reminders, daily briefings,
 * expiry nudges.
 *
 * Real-time events deliberately bypass this. A lead, a payment or a complaint
 * is a reaction to something that just happened, and holding a lead until
 * morning destroys the speed-to-lead advantage that makes it worth pushing at
 * all. That is the most arguable call in this feature; if it proves wrong the
 * fix is a per-owner preference, not a global gate.
 *
 * PURE — computed by UTC offset rather than `Intl`, so it is deterministic and
 * needs no timezone database. India has no daylight saving, so a fixed +5:30
 * is correct year-round.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export const SEND_WINDOW_START_HOUR_IST = 8;
export const SEND_WINDOW_END_HOUR_IST = 21;

export function withinSendWindow(now: Date): boolean {
  const istMinutes = (now.getTime() / 60000 + IST_OFFSET_MINUTES) % 1440;
  const minutes = ((istMinutes % 1440) + 1440) % 1440;
  return (
    minutes >= SEND_WINDOW_START_HOUR_IST * 60 &&
    minutes < SEND_WINDOW_END_HOUR_IST * 60
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/push-send-window.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/notifications/push/send-window.ts apps/backend/tests/push-send-window.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(push): quiet hours for scheduled sends"
```

---

### Task 3: Migration and Prisma model

**Files:**
- Create: `migrations/078_push_subscriptions.sql`
- Modify: `apps/backend/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma model `push_subscriptions` with fields `id, profile_id, endpoint, p256dh, auth, user_agent, created_at, last_used_at, failure_count`.

- [ ] **Step 1: Write the migration**

`migrations/078_push_subscriptions.sql`:
```sql
-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 078: Web push subscriptions
--
-- One row per browser install, NOT per user: an owner with a phone and a laptop
-- has two. Sending means iterating every row for a profile.
--
-- `endpoint` is the push service's URL for that install and is globally unique,
-- so it is the natural key — re-subscribing the same browser must update rather
-- than duplicate.
--
-- Subscriptions expire and rotate silently. A 404/410 from the push service
-- means gone forever, and the row is deleted rather than retried; `failure_count`
-- tracks the softer failures.
--
-- ON DELETE CASCADE: a deleted profile must not leave push endpoints behind that
-- would keep receiving messages about an account that no longer exists.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT REFERENCES IT.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  failure_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subscriptions_profile_id_idx
  ON push_subscriptions (profile_id);
```

- [ ] **Step 2: Confirm the real profiles table name**

Run: `grep -n "model profile" apps/backend/prisma/schema.prisma`
Then run: `grep -n '@@map' apps/backend/prisma/schema.prisma | grep -i profile`
Expected: confirms whether the SQL table is `profiles`. If the model maps to a different table name, correct the `REFERENCES` clause in the migration before applying.

- [ ] **Step 3: Add the Prisma model**

In `apps/backend/prisma/schema.prisma`, add:
```prisma
model push_subscriptions {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  profile_id    String    @db.Uuid
  endpoint      String    @unique
  p256dh        String
  auth          String
  user_agent    String?
  created_at    DateTime  @default(now()) @db.Timestamptz(6)
  last_used_at  DateTime? @db.Timestamptz(6)
  failure_count Int       @default(0)
  profiles      profile   @relation(fields: [profile_id], references: [id], onDelete: Cascade)

  @@index([profile_id])
}
```

And add this line to the `profile` model's field list:
```prisma
  push_subscriptions push_subscriptions[]
```

> This is a **relation** field, not a scalar, so Prisma does not select it by default and it cannot break existing `profile` queries the way a scalar column would.

- [ ] **Step 4: Regenerate the client and typecheck**

Run: `cd apps/backend && npm run prisma:generate`
Expected: "Generated Prisma Client"

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "push_subscriptions"`
Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add migrations/078_push_subscriptions.sql apps/backend/prisma/schema.prisma
git commit -m "feat(push): push_subscriptions table"
```

---

### Task 4: Push sender

**Files:**
- Create: `apps/backend/src/services/notifications/push/push-sender.ts`
- Test: `apps/backend/tests/push-sender.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`, `apps/backend/package.json`

**Interfaces:**
- Consumes: `shouldPush`, `pushLinkFor` (Task 1).
- Produces: `sendToProfile(profileId: string, payload: { title: string; body: string; url: string }): Promise<void>` and the testable core `deliver(deps, subscriptions, payload): Promise<{ sent: number; pruned: string[] }>`.

- [ ] **Step 1: Install the dependency**

Run: `cd apps/backend && npm install web-push && npm install --save-dev @types/web-push`

- [ ] **Step 2: Write the failing test**

`apps/backend/tests/push-sender.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { deliver } from "@/src/services/notifications/push/push-sender";

const sub = (endpoint: string) => ({ endpoint, p256dh: "k", auth: "a" });
const payload = { title: "Rent due", body: "₹8,000 due today", url: "/tenant/money" };

describe("deliver", () => {
  it("sends to every subscription a profile has, because one person has many devices", async () => {
    const send = vi.fn(async () => undefined);
    const result = await deliver({ send }, [sub("a"), sub("b"), sub("c")], payload);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.sent).toBe(3);
  });

  it("prunes a subscription the push service reports as gone (410)", async () => {
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === "dead") throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const result = await deliver({ send }, [sub("live"), sub("dead")], payload);
    expect(result.pruned).toEqual(["dead"]);
    expect(result.sent).toBe(1);
  });

  it("prunes on 404 as well", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    });
    const result = await deliver({ send }, [sub("x")], payload);
    expect(result.pruned).toEqual(["x"]);
  });

  it("does NOT prune on a transient failure, which would lose a live device", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("service unavailable"), { statusCode: 503 });
    });
    const result = await deliver({ send }, [sub("x")], payload);
    expect(result.pruned).toEqual([]);
    expect(result.sent).toBe(0);
  });

  it("one dead device does not stop the others being reached", async () => {
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === "dead") throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const result = await deliver({ send }, [sub("dead"), sub("live1"), sub("live2")], payload);
    expect(result.sent).toBe(2);
  });

  it("resolves rather than rejecting when every send fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("total outage");
    });
    await expect(deliver({ send }, [sub("x")], payload)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 3: Register the test**

Add to `apps/backend/vitest.pure.config.ts`'s `include`:
```ts
      'tests/push-sender.test.ts',
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/push-sender.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Write minimal implementation**

`apps/backend/src/services/notifications/push/push-sender.ts`:
```ts
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const logger = getLogger();

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Injected so the delivery rules can be tested without a network or a database. */
export interface DeliverDeps {
  send(subscription: StoredSubscription, payload: PushPayload): Promise<void>;
}

/**
 * Fan a payload out to every device a profile has.
 *
 * A 404/410 means the push service has permanently forgotten this endpoint —
 * the browser was uninstalled, storage cleared, subscription rotated. Those
 * rows are dead and are reported for deletion. Anything else (a 5xx, a
 * timeout) is transient: pruning on those would quietly delete live devices
 * during an outage, and the owner would simply stop receiving notifications
 * with nothing to show why.
 *
 * Never rejects. Callers are fire-and-forget on paths that record money.
 */
export async function deliver(
  deps: DeliverDeps,
  subscriptions: StoredSubscription[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: string[] }> {
  let sent = 0;
  const pruned: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await deps.send(subscription, payload);
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) pruned.push(subscription.endpoint);
      }
    }),
  );

  return { sent, pruned };
}

function configured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * The real send. Fire-and-forget — a push failure must never fail or delay the
 * notification write it hangs off, which runs on paths that record payments.
 */
export async function sendToProfile(profileId: string, payload: PushPayload): Promise<void> {
  if (!configured()) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@yourstayo.com",
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );

  const subscriptions = await prisma.push_subscriptions.findMany({
    where: { profile_id: profileId },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return;

  const { sent, pruned } = await deliver(
    {
      send: async (subscription, body) => {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(body),
        );
      },
    },
    subscriptions,
    payload,
  );

  if (pruned.length > 0) {
    await prisma.push_subscriptions
      .deleteMany({ where: { endpoint: { in: pruned } } })
      .catch(() => undefined);
  }

  logger.info("push.delivered", { profileId, sent, pruned: pruned.length });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/push-sender.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/notifications/push/push-sender.ts apps/backend/tests/push-sender.test.ts apps/backend/vitest.pure.config.ts apps/backend/package.json apps/backend/package-lock.json
git commit -m "feat(push): web-push sender with dead-subscription pruning"
```

---

### Task 5: Subscription API routes

**Files:**
- Create: `apps/backend/app/api/push/subscriptions/route.ts`

**Interfaces:**
- Consumes: `getSession` from `@/lib/auth`, Prisma `push_subscriptions`.
- Produces: `POST /api/push/subscriptions` (upsert by endpoint), `DELETE /api/push/subscriptions` (by endpoint).

- [ ] **Step 1: Read an existing route to match this repo's session and response conventions**

Run: `sed -n '1,40p' apps/backend/app/api/announcements/route.ts`
Note how the session is read and how errors are shaped. Match it exactly rather than inventing a new style.

- [ ] **Step 2: Write the route**

`apps/backend/app/api/push/subscriptions/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * A subscription belongs to a browser install, not a person, so `endpoint` is
 * the key and re-subscribing the same browser updates rather than duplicates.
 * A person signing in on a new device simply adds a row.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session?.profile_id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : null;
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : null;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "INVALID_SUBSCRIPTION" }, { status: 400 });
  }

  await prisma.push_subscriptions.upsert({
    where: { endpoint },
    // Re-subscribing can hand the same endpoint to a *different* profile on a
    // shared device, so the owner is reassigned rather than left stale.
    update: {
      profile_id: session.profile_id,
      p256dh,
      auth,
      failure_count: 0,
      last_used_at: new Date(),
    },
    create: {
      profile_id: session.profile_id,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session?.profile_id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) {
    return NextResponse.json({ error: "INVALID_SUBSCRIPTION" }, { status: 400 });
  }

  // Scoped to the session's own profile so one account cannot unsubscribe another.
  await prisma.push_subscriptions.deleteMany({
    where: { endpoint, profile_id: session.profile_id },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify the session field name**

Run: `grep -n "profile_id\|profileId" apps/backend/lib/auth.ts | head -10`
Expected: confirms whether the session exposes `profile_id` or `profileId`. **Correct the route to match** — do not assume.

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "app/api/push"`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/push/subscriptions/route.ts
git commit -m "feat(push): subscribe and unsubscribe endpoints"
```

---

### Task 6: Hook push into createNotification

**Files:**
- Modify: `apps/backend/lib/services/notification-service.ts`

**Interfaces:**
- Consumes: `shouldPush`, `pushLinkFor` (Task 1), `sendToProfile` (Task 4).
- Produces: no signature change — `createNotification` keeps its exact arguments and return value.

- [ ] **Step 1: Add the imports**

At the top of `apps/backend/lib/services/notification-service.ts`, after the existing imports:
```ts
import { shouldPush, pushLinkFor } from "@/src/services/notifications/push/push-policy";
import { sendToProfile } from "@/src/services/notifications/push/push-sender";
```

- [ ] **Step 2: Replace `createNotification` with the hooked version**

Replace the whole existing method with:
```ts
  async createNotification(userId: string, title: string, message: string, type: string, metadata?: Record<string, unknown>) {
    const normalisedType = type.toLowerCase();

    const notification = await prisma.notifications.create({
      data: {
        profile_id: userId,
        title,
        message,
        type: normalisedType,
        ...(metadata !== undefined ? { metadata } : {})
      }
    });

    /*
     * Push is a *fourth channel on this same event*, which is why it hangs
     * here rather than at 22 call sites: the `type` argument is already the
     * key the policy is indexed by, so one hook covers the whole catalogue and
     * "which events push" stays one reviewable file.
     *
     * Deliberately not awaited and never allowed to reject. This runs on paths
     * that record payments — a push service outage must cost a notification,
     * never the write it belongs to.
     */
    if (shouldPush(normalisedType)) {
      void sendToProfile(userId, {
        title,
        body: message,
        url: pushLinkFor(normalisedType),
      }).catch(() => undefined);
    }

    return notification;
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "notification-service"`
Expected: no output

- [ ] **Step 4: Confirm the pure suite still passes**

Run: `cd apps/backend && npm run test:pure`
Expected: 89+ files pass; only the 2 pre-existing `agreement-requirement.test.ts` failures

- [ ] **Step 5: Commit**

```bash
git add apps/backend/lib/services/notification-service.ts
git commit -m "feat(push): send a push wherever an in-app notification is created"
```

---

### Task 7: Fix the rent-reminder in-app channel and add push to its report

**Files:**
- Modify: `apps/backend/src/services/payments/reminder-service.ts:33-35, 428-438`

**Interfaces:**
- Consumes: `notificationService.createNotification` (Task 6).
- Produces: `NotificationDeliveryResult` gains a `push: ChannelDeliveryStatus` member.

> **This is the riskiest edit in the plan** — it touches the rent path. It is also a bug fix that is owed regardless: the `in_app` block currently reports `sent = true` and writes nothing, so a tenant with only in-app enabled receives nothing while the system logs success.

- [ ] **Step 1: Add the import**

Add to the imports in `apps/backend/src/services/payments/reminder-service.ts`:
```ts
import { notificationService } from "@/lib/services/notification-service";
```

- [ ] **Step 2: Add `push` to the result type**

At line ~33, change:
```ts
  in_app: ChannelDeliveryStatus;
  email: ChannelDeliveryStatus;
  whatsapp: ChannelDeliveryStatus;
```
to:
```ts
  in_app: ChannelDeliveryStatus;
  email: ChannelDeliveryStatus;
  whatsapp: ChannelDeliveryStatus;
  /** Sent as a side effect of the in-app write — see the in_app block below. */
  push: ChannelDeliveryStatus;
```

- [ ] **Step 3: Initialise it alongside the others**

At line ~420, in the block that builds the empty result, add:
```ts
      push: emptyChannel(),
```

- [ ] **Step 4: Make the in_app block actually deliver**

Replace the in-app block (around line 430):
```ts
    // 1️⃣ In-App Notification
    if (isOwnerManaged) {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
    } else if (canInApp) {
      result.in_app.attempted = true;
      result.in_app.sent = true;
    } else {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "IN_APP_DISABLED" };
    }
```
with:
```ts
    // 1️⃣ In-App Notification
    //
    // This block used to set `sent = true` and write nothing at all — the
    // service never imported `notificationService`. A tenant with only in-app
    // enabled therefore received nothing for rent reminders while the delivery
    // report claimed success. Writing the row also emits the push, since
    // `createNotification` is where the push channel hangs.
    if (isOwnerManaged) {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
      result.push = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
    } else if (canInApp && tenant.profile_id) {
      result.in_app.attempted = true;
      result.push.attempted = true;
      try {
        await notificationService.createNotification(
          tenant.profile_id,
          "Rent due",
          reminderMessage,
          "rent_reminder",
        );
        result.in_app.sent = true;
        result.push.sent = true;
      } catch (error) {
        // A failed in-app write must not abort the email and WhatsApp sends
        // that follow — those are the channels that actually reach someone.
        result.in_app = { attempted: true, sent: false, skipped: false, reason: "WRITE_FAILED" };
        result.push = { attempted: true, sent: false, skipped: false, reason: "WRITE_FAILED" };
      }
    } else if (!canInApp) {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "IN_APP_DISABLED" };
      result.push = { attempted: false, sent: false, skipped: true, reason: "IN_APP_DISABLED" };
    } else {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
      result.push = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
    }
```

- [ ] **Step 5: Resolve the two names this block assumes**

Run: `grep -n "reminderMessage\|profile_id" apps/backend/src/services/payments/reminder-service.ts | sed -n '1,20p'`

The block above assumes a `reminderMessage` string and `tenant.profile_id` are in scope at that point. **If either is named differently, use the real name.** If no message string exists yet, build one from the same values the email body uses — find it with:
`grep -n "mailData" apps/backend/src/services/payments/reminder-service.ts`

- [ ] **Step 6: Apply quiet hours to this scheduled send**

`withinSendWindow` (Task 2) exists precisely for this path and is otherwise dead code. Rent
reminders run from a cron, so they are exactly the "scheduled send" the window governs.

Add the import:
```ts
import { withinSendWindow } from "@/src/services/notifications/push/send-window";
```

Then gate the in-app write introduced in Step 4 — replace its condition:
```ts
    } else if (canInApp && tenant.profile_id) {
```
with:
```ts
    } else if (canInApp && tenant.profile_id && !withinSendWindow(new Date())) {
      // Outside 08:00-21:00 IST the row is still written, but the push that
      // hangs off it would buzz someone at 3am. The notification is created
      // via Prisma directly so the tray stays silent; the tenant sees it on
      // their next visit, and email/WhatsApp below are unaffected.
      result.in_app.attempted = true;
      await prisma.notifications.create({
        data: {
          profile_id: tenant.profile_id,
          title: "Rent due",
          message: reminderMessage,
          type: "rent_reminder",
        },
      });
      result.in_app.sent = true;
      result.push = { attempted: false, sent: false, skipped: true, reason: "QUIET_HOURS" };
    } else if (canInApp && tenant.profile_id) {
```

> Note the precedent: `app/api/cron/daily-briefings/route.ts:126` already enforces its own
> 07:30-22:00 send window. This is the same idea, and the two should not be allowed to drift
> apart silently — if you change one, look at the other.

- [ ] **Step 7: Update the `sent` roll-up**

At line ~402, add push to the disjunction:
```ts
    const sent = channels.in_app.sent ||
      channels.email.sent ||
      channels.whatsapp.sent ||
      channels.push.sent ||
      channels.whatsapp.reason === "DUPLICATE_REMINDER";
```

- [ ] **Step 8: Typecheck and run the pure suite**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "reminder-service"`
Expected: no output

Run: `cd apps/backend && npm run test:pure`
Expected: only the 2 pre-existing `agreement-requirement.test.ts` failures

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/services/payments/reminder-service.ts
git commit -m "fix(reminders): the in-app channel reported success and delivered nothing"
```

---

### Task 8: Push-only service worker

**Files:**
- Create: `apps/frontend/public/sw.js`

**Interfaces:**
- Consumes: the JSON payload shape from Task 4 — `{ title, body, url }`.
- Produces: a service worker at the root scope `/sw.js`.

- [ ] **Step 1: Write the service worker**

`apps/frontend/public/sw.js`:
```js
/*
 * Stayo push-only service worker.
 *
 * ── The most important thing about this file is what is NOT in it ──────────
 *
 * There is deliberately **no `fetch` handler**. A service worker without one
 * cannot intercept requests, cannot cache, and cannot serve a stale asset —
 * so adding push costs nothing in cache-invalidation or deploy-rollout risk,
 * and the SPA's update behaviour is exactly what it was before.
 *
 * Adding a `fetch` listener turns this into an offline/caching project. That
 * is a deliberate decision to take separately, not something to drift into.
 *
 * Lives in `public/` as plain JS so Vite does not hash its filename — a
 * service worker needs a stable path and root scope.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload should still surface something rather than nothing.
  }

  const title = payload.title || "Stayo";
  const options = {
    body: payload.body || "",
    icon: "/android-chrome-192x192.png",
    badge: "/favicon-32x32.png",
    // Same type replaces rather than stacks — three rent reminders should be
    // one line in the tray, not three.
    tag: payload.tag || payload.url || "stayo",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus a tab that is already open rather than opening a second one.
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
```

- [ ] **Step 2: Verify it ships in the build**

Run: `cd apps/frontend && npx vite build && ls -la dist/sw.js`
Expected: `dist/sw.js` exists and is unhashed

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/public/sw.js
git commit -m "feat(push): push-only service worker, deliberately with no fetch handler"
```

---

### Task 9: Frontend pure modules

**Files:**
- Create: `apps/frontend/src/features/push/pushSupport.ts`
- Create: `apps/frontend/src/features/push/pushPrompt.ts`
- Test: `apps/frontend/src/features/push/pushPrompt.test.ts`

**Interfaces:**
- Produces: `isPushSupported(): boolean`, `permissionState(): 'default' | 'granted' | 'denied' | 'unsupported'`, `shouldOfferPush(input): boolean`, `promptKey(profileId): string | null`, `PROMPT_COOLDOWN_DAYS = 14`.

- [ ] **Step 1: Write the failing test**

`apps/frontend/src/features/push/pushPrompt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shouldOfferPush, promptKey, PROMPT_COOLDOWN_DAYS } from './pushPrompt';

const now = new Date('2026-08-30T10:00:00.000Z');
const base = { supported: true, permission: 'default' as const, dismissedAt: null, now };

describe('shouldOfferPush', () => {
  it('offers to someone who has never been asked', () => {
    expect(shouldOfferPush(base)).toBe(true);
  });

  it('never offers where push is unsupported, such as an iPhone in a browser tab', () => {
    expect(shouldOfferPush({ ...base, supported: false })).toBe(false);
  });

  it('never re-asks once granted', () => {
    expect(shouldOfferPush({ ...base, permission: 'granted' })).toBe(false);
  });

  it('never re-asks once blocked, because the browser prompt is spent', () => {
    expect(shouldOfferPush({ ...base, permission: 'denied' })).toBe(false);
  });

  it('stays quiet during the cooldown after a soft dismissal', () => {
    const dismissedAt = new Date('2026-08-28T10:00:00.000Z'); // 2 days ago
    expect(shouldOfferPush({ ...base, dismissedAt })).toBe(false);
  });

  it('offers again once the cooldown has elapsed', () => {
    const dismissedAt = new Date('2026-08-01T10:00:00.000Z'); // 29 days ago
    expect(shouldOfferPush({ ...base, dismissedAt })).toBe(true);
  });

  it('offers exactly at the cooldown boundary', () => {
    const dismissedAt = new Date(now.getTime() - PROMPT_COOLDOWN_DAYS * 86400_000);
    expect(shouldOfferPush({ ...base, dismissedAt })).toBe(true);
  });
});

describe('promptKey', () => {
  it('scopes the dismissal to one profile', () => {
    expect(promptKey('profile-a')).not.toBe(promptKey('profile-b'));
  });

  it('refuses a key with no profile, rather than sharing one across accounts', () => {
    expect(promptKey(null)).toBeNull();
    expect(promptKey('  ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/push/pushPrompt.test.ts`
Expected: FAIL — `Cannot find module './pushPrompt'`

- [ ] **Step 3: Write both modules**

`apps/frontend/src/features/push/pushSupport.ts`:
```ts
/**
 * What this browser can actually do.
 *
 * **iOS is the case that matters.** Safari implements the Push API only for a
 * site added to the Home Screen; in an ordinary browser tab `PushManager` is
 * absent and there is no workaround. `isPushSupported()` reports false there,
 * and every caller must treat that as an ordinary state rather than an error.
 *
 * PURE enough for the node suite: every access is guarded, so importing this
 * where `window` does not exist is safe.
 */
export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function isPushSupported(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      typeof Notification !== 'undefined'
    );
  } catch {
    return false;
  }
}

export function permissionState(): PermissionState {
  if (!isPushSupported()) return 'unsupported';
  try {
    return Notification.permission as PermissionState;
  } catch {
    return 'unsupported';
  }
}
```

`apps/frontend/src/features/push/pushPrompt.ts`:
```ts
/**
 * Whether to show the soft prompt.
 *
 * The browser's own permission dialog is **one-shot**: a "Block" is permanent
 * and reversible only in browser settings, which nobody does. So Stayo asks
 * first, in its own card, at a moment that has already demonstrated the value
 * — and only escalates to the real dialog if the person says yes. A "not now"
 * on our card costs nothing and can be asked again; a "Block" cannot.
 *
 * PURE — no storage, no DOM. Runs under vitest's node environment.
 */
export const PROMPT_COOLDOWN_DAYS = 14;

const KEY_PREFIX = 'stayo_push_prompt_dismissed';

/**
 * Scoped per profile, returning `null` rather than an "anonymous" fallback.
 * A shared key would let one person's dismissal silence the prompt for the
 * next person signing in on the same phone — the ADR-139 failure, which this
 * codebase has already paid for once.
 */
export function promptKey(profileId: string | null | undefined): string | null {
  const id = profileId?.trim();
  return id ? `${KEY_PREFIX}:${id}` : null;
}

export interface OfferInput {
  supported: boolean;
  permission: 'default' | 'granted' | 'denied' | 'unsupported';
  /** When they last said "not now". Null if never. */
  dismissedAt: Date | null;
  now: Date;
}

export function shouldOfferPush({ supported, permission, dismissedAt, now }: OfferInput): boolean {
  if (!supported || permission !== 'default') return false;
  if (!dismissedAt) return true;
  const elapsedDays = (now.getTime() - dismissedAt.getTime()) / 86400_000;
  return elapsedDays >= PROMPT_COOLDOWN_DAYS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/push/pushPrompt.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/push/
git commit -m "feat(push): support detection and soft-prompt gating"
```

---

### Task 10: Subscribe hook, API wrapper and prompt card

**Files:**
- Create: `apps/frontend/src/features/push/api/pushApi.ts`
- Create: `apps/frontend/src/features/push/usePushSubscription.ts`
- Create: `apps/frontend/src/features/push/PushPromptCard.tsx`

**Interfaces:**
- Consumes: `isPushSupported`, `permissionState`, `shouldOfferPush`, `promptKey` (Task 9); `POST/DELETE /api/push/subscriptions` (Task 5).
- Produces: `usePushSubscription(profileId: string | null)` returning `{ offer: boolean; enable: () => Promise<void>; dismiss: () => void; }`.

> **Architecture rule:** raw `fetch`/`axios` is banned in `features/` by `scripts/check-architecture.mjs`. Everything must go through `@lib/api-client`. The API wrapper below is the only layer allowed to know the endpoint shape.

- [ ] **Step 1: Write the API wrapper**

`apps/frontend/src/features/push/api/pushApi.ts`:
```ts
import { apiClient } from '@lib/api-client';

export interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const pushApi = {
  subscribe: (body: SubscriptionBody) => apiClient.post('/push/subscriptions', body),
  unsubscribe: (endpoint: string) =>
    apiClient.delete('/push/subscriptions', { data: { endpoint } }),
};
```

- [ ] **Step 2: Confirm the api-client's export name and base path**

Run: `grep -n "export const\|export default\|baseURL" apps/frontend/src/lib/api-client.ts | head -10`
**Correct the import and the leading path segment to match** — do not assume `apiClient` or a `/api` base.

- [ ] **Step 3: Write the hook**

`apps/frontend/src/features/push/usePushSubscription.ts`:
```ts
import { useCallback, useMemo, useState } from 'react';
import { isPushSupported, permissionState } from './pushSupport';
import { shouldOfferPush, promptKey } from './pushPrompt';
import { pushApi } from './api/pushApi';

function readDismissedAt(key: string | null): Date | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? new Date(Number(raw)) : null;
  } catch {
    return null;
  }
}

function writeDismissedAt(key: string | null) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* A prompt that cannot remember a dismissal is a small problem; a crash is not. */
  }
}

/** The VAPID public key must be sent as bytes, not base64url text. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = window.atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushSubscription(profileId: string | null) {
  const key = promptKey(profileId);
  const [dismissedNow, setDismissedNow] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const offer = useMemo(() => {
    if (dismissedNow || enabled) return false;
    return shouldOfferPush({
      supported: isPushSupported(),
      permission: permissionState(),
      dismissedAt: readDismissedAt(key),
      now: new Date(),
    });
  }, [key, dismissedNow, enabled]);

  const enable = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        // A block is permanent; stop offering rather than nagging.
        setDismissedNow(true);
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY as string),
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
      await pushApi.subscribe({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setEnabled(true);
    } catch {
      // Never surface this. The app works fine without push.
      setDismissedNow(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    writeDismissedAt(key);
    setDismissedNow(true);
  }, [key]);

  return { offer, enable, dismiss };
}
```

- [ ] **Step 4: Write the prompt card**

`apps/frontend/src/features/push/PushPromptCard.tsx`:
```tsx
import { Bell } from 'lucide-react';

/**
 * Stayo's own ask, shown before the browser's.
 *
 * It states what will be sent, because "stayo.com wants to send you
 * notifications" tells someone nothing and gets blocked. Only "Turn on"
 * escalates to the real permission dialog.
 */
export function PushPromptCard({
  headline,
  detail,
  onEnable,
  onDismiss,
}: {
  headline: string;
  detail: string;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-primary/20 bg-secondary/45 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-px flex h-7 w-7 flex-none items-center justify-center rounded-[9px] bg-primary/12 text-primary">
          <Bell className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-foreground">{headline}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[36px] rounded-xl px-3 font-display text-[12.5px] font-bold text-muted-foreground"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onEnable}
          className="min-h-[36px] rounded-xl bg-primary px-3.5 font-display text-[12.5px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
        >
          Turn on
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Mount it at the tenant value moment**

In `apps/frontend/src/platforms/tenant/pages/TenantHomePage.tsx`, add the import:
```tsx
import { usePushSubscription } from '@features/push/usePushSubscription';
import { PushPromptCard } from '@features/push/PushPromptCard';
```

Add the hook beside the existing `useTenantGuide` call:
```tsx
  const push = usePushSubscription(home.profileId ?? null);
```

> Run `grep -n "profileId\|tenantId" apps/frontend/src/features/tenant-home/hooks/useTenantHome.ts` first. If `useTenantHome` does not expose a profile id, use `useTenantSession()`'s `tenantId` instead and pass that — the key only needs to be stable and per-person.

Render it directly **below** the rent card block (so it appears after the thing that proves the value, not before it):
```tsx
      {push.offer && fin.amountDue > 0 && (
        <PushPromptCard
          headline="Get told when rent is due"
          detail="A reminder before the due date, and a confirmation the moment your payment is recorded. No other notifications."
          onEnable={push.enable}
          onDismiss={push.dismiss}
        />
      )}
```

- [ ] **Step 6: Add the env var**

Add to `apps/frontend/.env` (and the deployment environment):
```
VITE_VAPID_PUBLIC_KEY=<the public half of the VAPID pair>
```
Generate the pair with: `cd apps/backend && npx web-push generate-vapid-keys`
Put the private half in the repo-root `.env` as `VAPID_PRIVATE_KEY`, the public half in both places, and set `VAPID_SUBJECT=mailto:support@yourstayo.com`.

- [ ] **Step 7: Verify the architecture check and build**

Run: `cd apps/frontend && npm run check:architecture`
Expected: "Architecture boundary check passed"

Run: `cd apps/frontend && npx vitest run && npx vite build`
Expected: all tests pass; build succeeds

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/features/push/ apps/frontend/src/platforms/tenant/pages/TenantHomePage.tsx
git commit -m "feat(push): soft prompt and subscribe flow on the tenant rent moment"
```

---

### Task 11: Owner value moment and the settings channel

**Files:**
- Modify: `apps/frontend/src/features/owner-more/config/deriveNotificationSections.ts:39-43`
- Modify: `apps/frontend/src/features/owner-more/pages/MoreConfigNotificationsPage.tsx`

**Interfaces:**
- Consumes: `usePushSubscription`, `PushPromptCard` (Task 10); `permissionState` (Task 9).
- Produces: `NOTIFICATION_CHANNELS` gains `{ key: 'push', label: 'Push' }`.

- [ ] **Step 1: Add push as a fourth channel**

In `apps/frontend/src/features/owner-more/config/deriveNotificationSections.ts`, change:
```ts
export const NOTIFICATION_CHANNELS: Array<{ key: NotificationChannelKey; label: string }> = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
];
```
to:
```ts
export const NOTIFICATION_CHANNELS: Array<{ key: NotificationChannelKey; label: string }> = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
  { key: 'push', label: 'Push' },
];
```

- [ ] **Step 2: Widen the channel key type**

Run: `grep -n "NotificationChannelKey" apps/frontend/src/features/owner-more/config/deriveNotificationSections.ts`
Add `'push'` to that union.

- [ ] **Step 3: Show the browser-blocked state honestly**

In `MoreConfigNotificationsPage.tsx`, add the import:
```tsx
import { permissionState } from '@features/push/pushSupport';
```

In the channel-rendering block (around line 75), render the push row differently when the browser has blocked it — a toggle that silently does nothing is worse than no toggle:
```tsx
              {channel.key === 'push' && permissionState() === 'denied' ? (
                <span className="text-[11.5px] font-semibold text-muted-foreground">
                  Blocked in your browser — turn it on in site settings
                </span>
              ) : channel.key === 'push' && permissionState() === 'unsupported' ? (
                <span className="text-[11.5px] font-semibold text-muted-foreground">
                  Not available in this browser
                </span>
              ) : null}
```

> Read the surrounding JSX before inserting — match the existing row structure rather than pasting this verbatim into the wrong nesting level.

- [ ] **Step 4: Mount the owner prompt on the lead moment**

Find the owner alerts/lead screen: `grep -rln "LeadDetailSheet" apps/frontend/src/features/owner-alerts/`
Add the same `usePushSubscription` + `PushPromptCard` pair used in Task 10, with owner copy:
```tsx
        <PushPromptCard
          headline="Get told the moment an enquiry arrives"
          detail="New enquiries, payments received, and complaints raised — sent straight to this device so you can respond first."
          onEnable={push.enable}
          onDismiss={push.dismiss}
        />
```

- [ ] **Step 5: Verify**

Run: `cd apps/frontend && npm run check:architecture && npx vitest run && npx vite build`
Expected: check passes, tests pass, build succeeds

Run: `cd apps/frontend && npm run typecheck 2>&1 | grep -E "push/|deriveNotificationSections|MoreConfigNotifications"`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/owner-more/ apps/frontend/src/features/owner-alerts/
git commit -m "feat(push): owner lead prompt, and push as a fourth delivery channel"
```

---

### Task 12: Documentation

**Files:**
- Modify: `docs/obsidian/Decisions.md`, `docs/obsidian/Features.md`, `docs/obsidian/Changelog.md`, `docs/obsidian/APIs.md`, `docs/obsidian/Database.md`

> CLAUDE.md requires these in the **same change**, not as follow-up. A change in these categories shipping without them is incomplete work.

- [ ] **Step 1: Check the next free ADR number**

Run: `grep -oP "^### ADR-\K\d+" docs/obsidian/Decisions.md | sort -n | tail -1`
Use the next number after that. **Do not assume 158** — concurrent work has been claiming numbers, and there is already a duplicate ADR-121 in this file.

- [ ] **Step 2: Write the ADR**

Append to `docs/obsidian/Decisions.md`, covering: push as a fourth channel on an existing event stream rather than a new system; the push-only service worker with no `fetch` handler and why; the soft prompt protecting a one-shot browser permission; additive channel policy for v1; unknown types defaulting to no push; quiet hours on scheduled sends only with real-time events bypassing; and the iOS Home-Screen limitation. Link `[[Features]]`, `[[Bugs]]`, `[[APIs]]`, `[[Database]]`.

- [ ] **Step 3: Add a Bugs entry for the rent-reminder defect**

Append to `docs/obsidian/Bugs.md`: `reminder-service.ts` reported `in_app.sent = true` while never importing `notificationService`, so a tenant with only in-app enabled received nothing while delivery was logged as successful. Fixed in Task 7.

- [ ] **Step 4: Update APIs and Database**

`docs/obsidian/APIs.md` — add `POST /api/push/subscriptions` and `DELETE /api/push/subscriptions`.
`docs/obsidian/Database.md` — add the `push_subscriptions` table, noting one row per browser install and the 404/410 pruning rule.

- [ ] **Step 5: Update Features and Changelog**

Add a Features entry and a dated `[Unreleased]` Changelog entry. State the verification status honestly, including what was **not** verified on a real device.

- [ ] **Step 6: Commit**

```bash
git add docs/obsidian/
git commit -m "docs(push): ADR, API, schema, feature and changelog entries"
```

---

## Rollout (after all tasks)

1. Generate the VAPID pair and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (repo-root `.env`) and `VITE_VAPID_PUBLIC_KEY` (frontend env + deployment).
2. **Apply `migrations/078_push_subscriptions.sql` FIRST.**
3. Deploy backend. Inert until subscriptions exist.
4. Deploy frontend.
5. **Manual verification — the part no test covers:** on a real Android handset, subscribe, then trigger a rent reminder and confirm the notification arrives, shows the right copy, and deep-links to `/tenant/money` on tap. Repeat on a desktop browser. Confirm an iPhone in a browser tab shows no prompt and does not error.

## Out of scope

Offline caching · escalation/unread fallback between channels · iOS Add-to-Home-Screen coaching · rich notifications (images, action buttons) · notification read tracking · per-owner quiet hours.
