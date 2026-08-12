# Stayo Admin — owner-first information architecture

**Date:** 2026-08-12
**Status:** approved, implementing
**Related:** `docs/obsidian/Features.md`, `docs/obsidian/APIs.md`, `docs/obsidian/Decisions.md`

## Problem

The admin app is built around the wrong primary entity. Stayo's hierarchy is
**Stayo → Owner → Hostels → Tenants/Money/Operations**, but the admin UI is
**Stayo → Hostels → everything**, which makes it read as a property-management
dashboard rather than a platform control centre. There is no owner screen at
all: an admin cannot see one owner's business in one place, which is the single
most common thing they need when hundreds of owners are on the platform.

Two structural consequences visible in the current screens:

- The **Hostels** list is the primary surface, so an owner with three hostels
  appears as three unrelated rows with no way to see them as one business.
- **Nothing ends in a decision.** The dashboard shows nine static counters; the
  admin still has to go hunting for what needs them.

## Ideology

Three rules, in priority order.

**1. A screen earns its place only if it ends in a decision.** With hundreds of
owners the admin's day is a queue of interventions — approve this hostel,
verify this document, chase this lead, rescue this stalled onboarding. Queues
are the product; the dashboard is a router into them. A number that does not
change the next action moves somewhere else or is dropped.

This is also the grammar the owner-facing app already speaks (Action Center,
the getting-started checklist) — so admin becomes the same product, not a
second one.

**2. Derive, don't fabricate.** Only signals that exist get scored, and the UI
says "not tracked" where one doesn't. This codebase has repeatedly shipped
plausible-looking numbers that were not real and paid for it.

**3. Observability and intervention, never a second copy of the owner app.**
Admin acts on *platform* concerns — approve, verify, suspend, bill. Operational
work stays in the owner's own app, reached via "open owner".

## Owner health — built only from what exists

| Dimension | Source | Available |
|---|---|---|
| Activation | hostel created → rooms configured → tenants added → first collection | yes, derivable |
| Verification | `owner_documents` AADHAAR + PAN status | yes |
| Listing | any hostel at `listing_status: LIVE` | yes |
| Collections use | payments in the last 30 days against tenant count | yes, derivable |
| Subscription | status / renewal / past due | yes, after the billing migration |
| **Engagement** | last login, active days | **no — not tracked anywhere.** Rendered as absent, not guessed. Adding login tracking is a separate, explicit prerequisite. |
| **Support** | open issues | **no — no ticketing backend exists.** |

Four solid dimensions is enough for a genuine at-risk signal. The two missing
ones are shown as untracked rather than silently scored as healthy.

## Information architecture

Navigation becomes `Dashboard · Owners · Leads · Billing · Documents · More`.

**Dashboard** — capped at four sections, in this order:
1. *Needs you* — queue counts, each deep-linked to the queue that clears it
2. *Platform snapshot* — owners, active, MRR, trial
3. *At risk* — owners with a real reason, and the reason stated
4. *Recent activity* — from `activity_logs`

**Owners** — replaces Hostels as the primary list. Filters:
`Needs attention · New · Trial · Active · Past due · Suspended`. Each card
shows hostels, tenants, MRR and the one reason it needs attention.

**Owner profile** — the screen that does not exist today and is the real
workhorse. Tabs: `Overview · Hostels · Billing · Documents · Activity`.

**Approval queue** — hostels awaiting `LIVE`. Reuses the owner side's
`WorkQueue` component rather than a new list.

**Billing** — subscription health, upcoming renewals, past due.

Hostels stop being a top-level destination and become a section inside an
owner, which is what they actually are.

## Billing

Subscriptions move from per-hostel to per-owner (decided):

```
subscription_plans      name · price · cycle · max_hostels · max_tenants
      ↑
owner_subscriptions     profile_id @unique · plan_id · status · cycle
   (new)                amount · trial_ends_at · next_renewal_at
      ↑
platform_invoices       owner_subscription_id  (hostel_id kept nullable for
                        any historical row)
```

`hostel_subscriptions` is retired rather than edited, so anything already
written to it survives read-only. MRR moves to "sum over ACTIVE owner
subscriptions" in the one shared composition both `/platform-admin/dashboard`
and `/platform-admin/revenue` already use.

**Plans are price tiers only** (decided). `max_hostels` / `max_tenants` are
stored and displayed but deliberately unenforced, so adding enforcement later
needs no second migration. Nothing blocks an owner from exceeding them.

This is the cheapest possible moment for the migration: MRR is ₹0 and no
subscription has been created, so there is no live billing data to collapse.

## Deliberately not built

- **A second copy of the owner app.** No admin-side tenant editing, rent
  collection or food management. Admin observes and intervenes at the platform
  level; everything else is a link into the owner's own context.
- **Fabricated engagement metrics.** No "last active 18 days ago" until login
  tracking exists.
- **Enforced plan limits.** Stored, shown, not enforced.
- **A support module.** No ticketing backend exists.
- **A visual rebrand.** The warm background, subtle grid, white cards, rounded
  corners, restrained terracotta accent, bottom nav and compact mobile-first
  type all stay. This is an information-architecture change, not a re-skin.
- **Bulk approval tooling.** The current 1056-item pending count is dominated
  by test-suite fixtures; building mass-action tooling would be building for a
  data artefact rather than a real workload.

## Sequencing

1. Owner-scoped aggregation endpoints (owners list, owner detail), composing
   the existing per-hostel aggregations rather than reimplementing them.
2. Owner health + needs-attention as pure, tested logic.
3. Owners list — the IA shift.
4. Owner profile.
5. Dashboard restructured as a needs-you router.
6. Approval queue and documents workflow.
7. Owner-level subscription migration and Billing.

## Testing

Pure, node-environment logic with colocated tests (this frontend has no jsdom):
owner health derivation, at-risk reasons, needs-attention bucketing, activation
stage, and the "untracked" dimensions rendering as absent rather than passing.
