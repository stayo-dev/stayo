# Web Push Notifications — Design

**Date:** 2026-08-30
**Status:** Awaiting review
**Related:** [[Decisions]], [[APIs]], [[Database]], [[Features]]

## Problem

Stayo has three notification channels — WhatsApp, Email, In-app — and no push. In-app
notifications are only seen by someone who has already opened the app, which makes them
useless for the things that need reaching a person who is *not* looking: rent falling
overdue, a new enquiry landing, a complaint being resolved.

WhatsApp partly fills this, but every new message type is gated on Meta template approval.
Web push has no approval gate, costs nothing per message, and is the same delivery
mechanism on Android phones and on laptops.

## What already exists (and what this changes)

This is **a fourth channel on an existing event stream**, not a new notification system.

- ~15 notification types are already written to the `notifications` table by 22 call sites,
  all funnelling through one method: `notificationService.createNotification(profileId,
  title, message, type, metadata?)`.
- `reminder-service.ts` already models delivery as `{ in_app, email, whatsapp }`.
- `POST /api/announcements` already fans an owner's announcement out to every live tenant
  as an in-app notification. Owner-authored push needs **no new authoring surface** — that
  message simply needs to leave the building.
- `NOTIFICATION_CHANNELS` in the frontend is `whatsapp | email | in_app`; push becomes a
  fourth key and the existing settings page picks it up almost for free.

### A bug this design has to fix on the way past

`reminder-service.ts` **never writes an in-app notification.** It imports `EmailService` and
`whatsappReminderDeliveryService`; `notificationService` appears zero times in the file. Its
`in_app` block sets `attempted = true; sent = true` and creates nothing. A tenant with only
"In-app" enabled receives nothing for rent reminders while the system logs a successful
delivery.

This is load-bearing here: rent reminders are the highest-value push event, and they do not
currently flow through the one place push would otherwise hook. Fixing it both repairs a
live defect and brings rent reminders into the same pipe as everything else.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Service worker scope | **Push-only.** No `fetch` handler, no caching, no offline | A SW with no `fetch` listener cannot cause stale-asset or cache-invalidation bugs. The SPA's update behaviour is unchanged. Offline stays open as a separate, deliberate project |
| Permission ask | **Soft prompt, contextually timed** | Browser permission is one-shot; a `Block` is permanent and only reversible in browser settings. A soft card is re-askable, so it protects the real prompt |
| Channel policy | **Additive** — every enabled channel fires | Matches how the existing three behave. Needs no delivery-state tracking. Tighten later with real data |
| Integration seam | **Inside `createNotification`**, plus a truthful `push` member on `NotificationDeliveryResult` | One seam covers all 22 call sites; the `type` argument is already the key the policy is indexed by |
| Quiet hours | **Scheduled sends only.** Real-time events bypass | See "Most arguable call" below |

## Which events push

Unknown types default to **no**. A notification type added later must not silently start
pushing — that is asserted by a test.

### Tenant

| Event | Type | Push |
|---|---|---|
| Rent due / overdue | `rent-reminders` cron | Yes |
| Payment recorded | `payment` | Yes |
| Owner announcement | `announcement` | Yes |
| Complaint status changed | `service_request` | Yes |
| Agreement to sign / expiring | `agreement_lifecycle` | Yes |
| Renewal offer | renewal | Yes |
| Move-out settlement / refund | `move_out_dispute`, payout | Yes |
| Invite / claim link expiring | `tenancy_claim`, `invitation-expiry-reminders` | Yes |
| Food poll / voting opened | `food_poll_opened`, `food_voting_opened` | Yes |
| Document rejected | doc routes | Yes |
| Weekly menu published | `food_schedule_published` | No — in-app |
| Document verified | doc routes | No — routine |

### Owner

| Event | Type | Push |
|---|---|---|
| New enquiry / lead | `lead` | Yes — highest value |
| Payment received | `payment` | Yes |
| Tenant raised a complaint | `service_request` | Yes |
| Move-out request / dispute | `move_out_dispute` | Yes |
| Payout / settlement | payout-notifications | Yes |
| Agreement signed | `agreement_lifecycle` | Yes |
| Marketing review outcome | `marketing` | Yes |
| Invite not activated | `invitation-expiry-reminders` | Yes |
| Daily briefing | `daily-briefings` cron | Yes — one digest, never per-event |
| Stayo platform broadcast | `PLATFORM_BROADCAST` | No by default |
| Analytics, invariants, reconciliation, retention | crons | No — internal |

**The "No" rows are load-bearing.** A channel that fires on weekly menus and verified
documents trains people to swipe everything away, and then the rent reminder gets swiped too.

## Design

### 1. Data model

New table, plus a relation field on `profile`:

```prisma
model push_subscriptions {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  profile_id    String    @db.Uuid
  endpoint      String    @unique
  p256dh        String
  auth          String
  user_agent    String?
  created_at    DateTime  @default(now()) @db.Timestamptz(6)
  last_used_at  DateTime?
  failure_count Int       @default(0)
  profiles      profile   @relation(fields: [profile_id], references: [id], onDelete: Cascade)

  @@index([profile_id])
}
```

- **A subscription is per device, not per user.** One owner with a phone and a laptop is two
  rows. Sending means iterating every row for that profile.
- `endpoint` is the natural unique key — one per browser install.
- Subscriptions expire and rotate silently. A `404`/`410` from the push service means *gone*,
  and the row must be deleted, not retried.

Migration: `migrations/078_push_subscriptions.sql`, plus `prisma/schema.prisma`.

> **Rollout order matters.** This repo has already taken production down by deploying a
> `schema.prisma` change before its migration — Prisma then selects a column that does not
> exist and every query on that model fails. The relation field added to `profile` is a
> relation, not a scalar, so it is not selected by default; but the new model must exist
> before any code touches it. **Apply the migration first, then deploy.**

### 2. Service worker

`apps/frontend/public/sw.js` — plain JS in `public/`, so Vite does not hash it and it keeps a
stable path with root scope.

Handles exactly two events:

- `push` → `showNotification(title, { body, icon, badge, tag, data: { url } })`
- `notificationclick` → focus an existing client if one is open, else open `data.url`

**It deliberately has no `fetch` handler.** That single omission is what makes this a
push-only worker: with no `fetch` listener the SW cannot intercept requests, cannot cache,
and cannot serve a stale asset. Adding one later is how this becomes a caching project, and
that should be a deliberate decision rather than a drift.

`tag` is set per notification type so a second rent reminder replaces the first rather than
stacking.

### 3. Client subscribe flow

- `pushSupport.ts` (**pure**) — `isPushSupported()`, `permissionState()`.
- `pushPrompt.ts` (**pure**) — `shouldOfferPush({ supported, permission, dismissedAt, now })`.
  Never when `permission !== 'default'` (already granted, or blocked and unaskable); never
  when unsupported; re-askable after a 14-day cooldown following a soft dismissal.
- `usePushSubscription()` — registers the SW, calls
  `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, POSTs the result.
- Dismissal state in guarded `localStorage`, **keyed per profile**, returning no key when
  there is no profile — the same rule as the tenant guide, for the same ADR-139 reason.

VAPID public key ships as `VITE_VAPID_PUBLIC_KEY`; the private key is backend-only.

### 4. The soft prompt

`PushPromptCard` — Stayo-styled, "Enable" and "Not now", stating plainly what will be sent.
Only "Enable" triggers the real browser prompt.

Value moments (never on load):
- **Owner** — opening a lead, or landing on Home after a payment arrives.
- **Tenant** — viewing a rent-due card, or immediately after paying.

### 5. Send path

- `lib/services/notifications/push/push-policy.ts` (**pure**) — `shouldPush(type)` and
  `pushPayloadFor(type, title, message, metadata)`, which supplies the deep-link URL.
- `push-sender.ts` — `web-push` with VAPID; iterates the profile's subscriptions; deletes
  rows on `404`/`410`; increments `failure_count` otherwise.
- Hook in `notificationService.createNotification`: after the row is written,
  `if (shouldPush(type)) void pushService.sendToProfile(...).catch(() => undefined)`.
  **Fire-and-forget.** A push failure must never fail or delay the notification write.
- `reminder-service.ts`: replace the fake `in_app.sent = true` with a real
  `createNotification(...)`, and add `push` to `NotificationDeliveryResult` so the delivery
  report stays truthful about all four channels.

### 6. Quiet hours

Pure `withinSendWindow(now, tz)` — default 08:00–21:00 IST — applied to **scheduled** sends
only: rent reminders, daily briefings, expiry nudges.

**Real-time events bypass it.** A lead, a payment, or a complaint is a reaction to something
that just happened, and delaying a lead to the morning destroys the speed-to-lead advantage
that made it the highest-value event on the list.

> **Most arguable call in this spec.** An owner may not want a 2am lead buzz. The counter is
> that suppressing it costs the conversion the notification exists to win. If this proves
> wrong in practice the fix is a per-owner quiet-hours preference, not a global gate.

### 7. Settings

`push` becomes a fourth `NOTIFICATION_CHANNELS` key. The settings row must reflect the
browser-level state honestly: when `permission === 'denied'` it shows "Blocked in your
browser" with instructions, **not** a toggle that silently does nothing.

## Testing

The two apps have different test conventions and these modules split across both.

**Backend** (`apps/backend/tests/**/*.test.ts`, vitest, single-worker):

- `pushPolicy.test.ts` — every Yes/No row above, and that an **unknown type defaults to no**.
  This is the most important test in the feature: it is what stops a notification type added
  next month from silently acquiring a push.
- `sendWindow.test.ts` — quiet-hours boundaries including timezone edges.
- Sender — subscription row pruned on `404`/`410` rather than retried; a push failure does
  not fail or delay `createNotification`; the existing three channels behave identically.

**Frontend** (`apps/frontend/src/**/*.test.ts`, node environment, **no jsdom** — so pure
modules only, never a rendered component):

- `pushPrompt.test.ts` — never re-asks after `granted` or `denied`; cooldown after a soft
  dismissal; per-profile key isolation, and no key at all without a profile.
- `pushSupport.test.ts` — reports unsupported rather than throwing where the APIs are absent.

**Not automatable here:** the service worker, real push delivery, and the permission prompt
itself. These need a manual pass on a real Android handset and a desktop browser — there is
no headless path to any of them.

**Backend pure tests DO run here**, via `npm run test:pure` (`vitest.pure.config.ts`), which
runs 89 files / 1250 tests without a database. A new pure test must be **added to that
config's `include` list explicitly** — it is an allowlist, not a glob, so a test file left out
of it silently never runs. Both new backend modules are pure and belong there.

Only DB-touching tests need `DATABASE_URL_TEST`, which is unconfigured (pre-existing). The
sender's pruning behaviour is therefore tested against a faked Prisma client, in the pure
suite, rather than a real database.

**Baseline:** `tests/agreement-requirement.test.ts` has 2 failing tests from concurrent
in-flight work. Not caused by this feature; do not treat them as a regression.

## Rollout

1. Apply `078_push_subscriptions.sql`.
2. Deploy backend — sender and policy. Inert until subscriptions exist.
3. Deploy frontend — SW, subscribe flow, soft prompt.
4. Verify on a real Android handset and a desktop browser.

## Known limitations

- **No push on iOS unless installed to the Home Screen.** Safari supports Web Push from iOS
  16.4+ only for a site added to the Home Screen; in a browser tab there is nothing. iPhone
  owners in a tab get no push at all. Coaching them through Add-to-Home-Screen is explicitly
  out of scope for v1, but it means push can never be the sole carrier of a message.
- Push delivery is best-effort — subscriptions expire silently, browsers evict them, phones
  stay offline. This is why the channel policy is additive rather than push-replaces-WhatsApp.

## Out of scope for v1

Offline caching · escalation/unread-fallback between channels · iOS install coaching · rich
notifications (images, action buttons) · notification read tracking · per-owner quiet hours.
