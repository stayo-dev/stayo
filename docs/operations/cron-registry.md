# Stayo Cron Registry

This is the canonical registry for every `/api/cron/*` route. A route must appear
here before it is scheduled, even if it is Dormant, Frozen, or Deprecated.

**Trimmed to the MVP set on 2026-09-06 (ADR-177).** Nine jobs were scheduled;
six are now. The other routes still exist and are still `CRON_SECRET`-gated —
they are simply unscheduled, which is this repo's standard "keep the plumbing,
drop the trigger" posture.

## Where crons actually run

**One scheduler, since 2026-09-08 (ADR-179):** all six jobs are `crons` entries
in `apps/backend/vercel.json`. `.github/workflows/backend-cron.yml` is deleted.

Vercel's Hobby plan allows **100 cron jobs per project**, each **once per day**,
with **per-hour (±59 min) scheduling precision**, and rejects a sub-daily
schedule *at deploy time* rather than degrading. The repo previously split the
schedule across two runners to work around a **2-cron** Hobby cap that no longer
exists.

**Scheduling on Hobby — the one rule that matters.** A job scheduled at `H:00`
fires anywhere in `[H:00, H:59]`. So two jobs that must not overlap need a
**two-hour** slot gap, which guarantees at least 61 minutes of separation in the
worst case. A one-hour gap guarantees nothing.

`.github/workflows/keep-warm.yml` pings `/api/health` every 5 minutes to avoid
cold starts. It is **the only GitHub Actions schedule left in the repo** and it
cannot move to Vercel while the account is on Hobby, because a 5-minute cron
fails deployment. It is infrastructure, not a business job, and its
auto-disable-after-60-days risk now costs only latency, not a missed job.
`.github/workflows/db-backup.yml` is `workflow_dispatch` only.

On upgrading to Pro (per-minute precision and frequency), the two-hour gaps can
be tightened and `keep-warm.yml` folded in as well. The two most business-
critical jobs therefore live on Vercel Cron; the rest run from GitHub Actions,
which calls the same `CRON_SECRET`-gated endpoints with the same
`Authorization: Bearer` header Vercel Cron uses. On upgrading to Pro, fold the
GitHub Actions four back into `vercel.json` and delete that workflow — keeping
the ordering constraint below intact.

## Ordering constraint — retired 2026-09-08, gap kept as defence-in-depth

**This is no longer load-bearing.** ADR-178 made `generate-rent` correct on its
own: it filters on `tenants.exit_date`, which is the field a future-dated
move-out actually writes, so the order these two run in no longer changes any
billing outcome. The 30-minute gap stays because nothing depends on removing it.

The history, because it explains the filter: `generate-rent` bills every
allocation whose tenant is `ACTIVE`. Its allocation query has always carried an
exit clause — `end_date: null OR end_date >= rentMonth` — but `move-out-service.ts`
`vacate()` takes an explicit `if (!isFutureExit)` branch that leaves a
**future-dated** exit's allocation open (`is_active: true`, `end_date: null`)
and the tenant `ACTIVE`, writing only `tenants.exit_date`; `move-out-releases`
is the only thing that later closes it, and `tenant-service.ts` hard-blocks
setting `FORMER_TENANT` directly. So the departed tenant satisfied every
condition in the query, and whichever cron won the race decided whether they
were billed for another month. Earlier versions of this page, ADR-177 and
[[Bugs]] all describe this as `generate-rent` having *no* exit filter; it had
one, aimed at a column the future-exit path never populates.

**If you ever co-locate ordering-sensitive jobs on Vercel Hobby cron, a
30-minute gap is not enough** — Hobby scheduling precision is per-hour (±59 min),
so a job scheduled at `H:00` may fire as late as `H:59`. Two hours between slots
guarantees at least 61 minutes of separation in the worst case.

## Active jobs — the MVP set

All six run on Vercel Cron. IST times are the **earliest** a job can fire; Hobby
may delay any of them by up to 59 minutes.

| Job | Route | Schedule (UTC / IST) | Criticality | Owner |
|---|---|---|---|---|
| Move-out releases | `/api/cron/move-out-releases` | `0 16 * * *` / 21:30 | P0 Business Critical | Move-outs |
| Rent generation | `/api/cron/generate-rent` | `30 18 * * *` / 00:00 | P0 Business Critical | Billing |
| Rent reminders & late fees | `/api/cron/rent-reminders` | `0 2 * * *` / 07:30 | P0 Business Critical | Collections |
| Invitation expiry reminders | `/api/cron/invitation-expiry-reminders` | `0 3 * * *` / 08:30 | P1 Important Operations | Tenant Onboarding |
| Payment reconciliation | `/api/cron/reconcile-payments` | `30 3 * * *` / 09:00 | P0 Business Critical | Payments |
| Unaccepted tenancy expiry | `/api/cron/expire-unaccepted-tenancies` | `0 5 * * *` / 10:30 | P0 Business Critical | Tenant Onboarding |

**Two slots moved in the consolidation, both non-billing.** `move-out-releases`
`0 18` → `0 16` (a 91-minute worst-case lead on rent generation instead of 30),
and `expire-unaccepted-tenancies` `0 4` → `0 5` (so the expiry warning at `0 3`
cannot land in the same window as the sweep that acts on it). **Rent generation
and rent reminders were deliberately left untouched** — `generate-rent` derives
its `rentMonth` from the UTC calendar month, so moving it across a UTC day
boundary changes which month gets billed.

Why each one is in the MVP set — i.e. what is *wrong in the product* if it never runs:

- **`generate-rent`** — the only writer of `rent_obligations`. No obligations
  means no dues, no reminders, and nothing for a payment to settle against.
- **`rent-reminders`** — the **sole writer of late fees**. `reminder-service.ts`
  is the only non-test importer of `lib/billing/engine.ts`, so without this cron
  every late-fee rule an owner configures is decorative. Also sends the
  before-due, due-day, and overdue nudges.
- **`move-out-releases`** — the only completion path for a future-dated
  move-out. Without it the room never frees, the tenant stays `ACTIVE`, and
  `generate-rent` keeps billing them. See the ordering constraint above.
- **`invitation-expiry-reminders`** — the 24h-before-expiry nudge. Kept because
  it is the only warning an invitee gets before `expire-unaccepted-tenancies`
  closes their tenancy; expiring someone silently is a bad first impression.
  Lowest-criticality member of the set — a pure notification, and a no-op while
  its Meta template is unapproved.
- **`reconcile-payments`** — repairs Razorpay attempts stuck `pending` when a
  webhook is missed or dropped. Without it money is taken and never credited.
- **`expire-unaccepted-tenancies`** — under ADR-165 an invited tenancy goes
  operationally live immediately (`status = ACTIVE`, `acceptance_status =
  PENDING`). This is the only sweep that frees the room and voids future
  obligations when the tenant never personally accepts. Without it, ghost
  tenancies hold beds and accrue rent indefinitely.

## Descheduled 2026-09-06 (ADR-177)

Routes retained, triggers removed. Re-scheduling any of these means updating
this table first.

| Job | Route | Why it left the MVP set |
|---|---|---|
| Admissions reservation expiry | `/api/cron/admissions` | **Redundant.** Every availability read already filters `tenant_invitation_reservations` on `expires_at > now()`, so an expired reservation stops blocking a room the moment it lapses, with or without the cron. The sweep only tidies a status column nothing reads. |
| Owner daily briefings | `/api/cron/daily-briefings` | Pure WhatsApp convenience, gated on an unapproved Meta template. No correctness impact. Deferred, not deleted. |
| Agreement lifecycle | `/api/cron/agreement-lifecycle` | Renewal reminders and expiry transitions. Nothing to remind about until the first cohort of agreements approaches renewal. |
| Food expiry | `/api/cron/food-expiry` | Closes voting periods and polls past their deadline. Cosmetic — a stale `OPEN` status on an expired poll. Better handled as a read-time check if it starts to matter. |
| Hostel invariants | `/api/cron/hostel-invariants` | Migration-era diagnostics. Writes findings to tables nothing surfaces, with no alerting attached, so a violation is discovered only if someone queries for it. Run manually, or weekly, when useful. |
| Migration audit | `/api/cron/migration-audit` | Same as above — `migration_audit_runs` rows nobody reads. Both stay one `workflow_dispatch` away. |

A dead seventh entry was also removed: the workflow had been calling
`/api/cron/food-carry-forward` daily since that route was renamed to
`food-expiry` on 2026-08-25 (ADR-114), 404ing and failing the job every night
for twelve days. See [[Bugs]].

## Dormant jobs

| Job | Route | Status | Owner |
|---|---|---|---|
| Tenant analytics repair | `/api/cron/tenant-analytics` | Dormant, never scheduled | Tenant Intelligence |

Not business critical. Payment writes and tenant score reads already perform
targeted self-healing recalculation. `POST`-only. Better future fit for
event-driven tenant intelligence than for a cron.

## Frozen jobs

| Job | Route | Status | Owner |
|---|---|---|---|
| Data retention cleanup | `/api/cron/data-retention` | Frozen, never scheduled | Platform Governance |

Permanently deletes records with no archive path. Must stay unscheduled until
Stayo has a documented retention policy, backup policy, archive strategy, and a
cron auth review. Note it currently guards with `if (cronSecret && ...)`, so an
unset `CRON_SECRET` would leave a destructive endpoint fully public — that is
part of the auth review, and a reason not to schedule it.

## Deprecated jobs

All four return `410 Gone` unconditionally; retained so stale monitors and
manual calls fail loudly rather than 404.

| Job | Route |
|---|---|
| Overflow billing | `/api/cron/process-overflow` |
| Owner onboarding nudges | `/api/cron/onboarding-nudges` |
| Add-on reconciliation | `/api/cron/reconcile-addons` |
| Autopay retries | `/api/cron/process-autopay-retries` |

## Auth

Every cron route is bearer-gated on `CRON_SECRET`. `middleware.ts` excludes
`/api/cron` so each route owns its own check.

Eleven routes **fail closed** — a missing `CRON_SECRET` returns `500`.
`reconcile-payments` joined them on 2026-09-08 (ADR-178); it is the only member
of the MVP set that had ever failed open.

Two still **fail open** — `admissions` and `data-retention` use
`if (cronSecret && ...)`, so an unset secret makes them public. `data-retention`
is destructive, which is why the auth review remains a precondition for ever
scheduling it. `tenant-analytics` has a milder variant: it compares against
`` `Bearer ${process.env.CRON_SECRET}` ``, so with the var unset the literal
string `Bearer undefined` is a valid credential. All three tracked in [[TODO]].

## Governance rule

No new cron ships without updating this registry. Every new cron requires:

- Business purpose, stated as *what is wrong in the product if it never runs*
- Owner domain
- Criticality
- Schedule with UTC and IST equivalents, and which runner it lives on
- Recovery procedure
- An entry in the Active table above

If you add a job to `apps/backend/vercel.json`, confirm
`apps/backend/app/api/cron/<name>/route.ts` exists and exports `GET`. The
`food-carry-forward` incident above was exactly this check going unmade — and
Vercel will not catch it for you: a cron pointing at a non-existent path
deploys fine and simply 404s every day.

Check the two-hour rule before choosing a slot, and note that `generate-rent`
and `rent-reminders` are pinned to their current UTC times by month-boundary
arithmetic — do not move them without re-reading `rentMonth` in
`rent-generation-service.ts`.

## Recovery procedures

Every job is idempotent and safe to re-run by hand with the `CRON_SECRET`
bearer. Since 2026-09-08 all six are Vercel crons, so the supported manual
trigger is `vercel crons run /api/cron/<name>` (the job must already be deployed
to production — the CLI reads cron definitions from the deployed project, not
from your local `vercel.json`). `vercel crons ls` lists what is actually
scheduled, which is the fastest way to diff reality against this registry.

| Job | Recovery procedure |
|---|---|
| Rent generation | Re-run with `CRON_SECRET`; per-hostel `system_locks`, `rent_generation_ledgers`, and unique constraints on `rent_obligations` prevent duplicates. If the response carries `has_more: true`, re-run with `?cursor=<next_cursor>` — the 240 s soft budget truncates rather than failing, and **nothing drains the remainder automatically**. |
| Rent reminders | Re-run with `CRON_SECRET`; check reminder logs and late-fee output before repeating a failed production run. |
| Move-out releases | Re-run with `CRON_SECRET`; unreleased `COMPLETED`/`VACATED` move-outs stay eligible while `room_release_date` is null. Run this **before** re-running rent generation. |
| Invitation expiry reminders | Re-run with `CRON_SECRET`; de-duplicated per invitation via `system_event_logs`. |
| Payment reconciliation | Re-run with `CRON_SECRET`; inspect payment reconciliation runs and provider snapshots for unresolved attempts. |
| Unaccepted tenancy expiry | Re-run with `CRON_SECRET`; idempotent, and the grace window (`UNACCEPTED_TENANCY_GRACE_DAYS`, default 7) means a one-day miss changes nothing. |

## Known gaps

- **`generate-rent` can silently truncate.** It stops at `SOFT_TIMEOUT_MS`
  (240 s) and returns `has_more` / `next_cursor` for a follow-up call that
  **nothing in the repo makes**. A partial billing run is not alerted on. Fine
  at current scale; needs a chained follow-up or an alert before it isn't.
- **No alerting on cron failure.** A failed GitHub Actions run is a red mark in
  the Actions tab; a failed Vercel Cron is a log line. Neither notifies anyone.
- **GitHub scheduled workflows auto-disable** after 60 days without repo
  activity, taking four of the six jobs with them.

Related: [[Decisions#ADR-177|ADR-177]] · [[Architecture]] · [[APIs]] · [[Business-Rules]] · [[Bugs]]
