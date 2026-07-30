# HMS Cron Registry

This is the canonical registry for every HMS cron route. Any `/api/cron/*` route must appear here before it is scheduled, even if it is Dormant, Frozen, or Deprecated.

## Inventory Validation

| Route | Schedule | Purpose | Status |
|---|---|---|---|
| `/api/cron/generate-rent` | `30 18 * * *` UTC / 00:00 IST | Generate rent and maintenance obligations for eligible active tenants. | Active |
| `/api/cron/rent-reminders` | `0 2 * * *` UTC / 07:30 IST | Process rent reminders and eligible late fees. | Active |
| `/api/cron/reconcile-payments` | `30 3 * * *` UTC / 09:00 IST | Reconcile pending and stuck payment attempts with provider state. | Active |
| `/api/cron/hostel-invariants` | `0 1 * * *` UTC / 06:30 IST | Run hostel and financial invariant validation. | Active |
| `/api/cron/migration-audit` | `15 1 * * *` UTC / 06:45 IST | Run migration audit and financial integrity checks. | Active |
| `/api/cron/move-out-releases` | `30 18 * * *` UTC / 00:00 IST | Release rooms and close tenant state for completed or vacated move-outs whose exit date has passed. | Active |
| `/api/cron/admissions` | `45 18 * * *` UTC / 00:15 IST | Expire stale admissions room reservations. | Active |
| `/api/cron/agreement-lifecycle` | `30 1 * * *` UTC / 07:00 IST | Process agreement expiry reminders and lifecycle status transitions. | Active |
| `/api/cron/daily-briefings` | `0 2 * * *` UTC / 07:30 IST | Send owner daily WhatsApp briefing using `owner_daily_briefing_v1`. | Active |
| `/api/cron/tenant-analytics` | Not scheduled | Recalculate tenant behavior scores as analytics repair. | Dormant |
| `/api/cron/data-retention` | Not scheduled | Delete old activity, system event, and reminder logs when retention is configured. | Frozen |
| `/api/cron/process-overflow` | Not scheduled | Former overflow billing job removed in single-business migration. | Deprecated |
| `/api/cron/onboarding-nudges` | Not scheduled | Former owner onboarding nudge job removed in single-business migration. | Deprecated |
| `/api/cron/reconcile-addons` | Not scheduled | Former add-on credit reconciliation removed in single-business migration. | Deprecated |
| `/api/cron/process-autopay-retries` | Not scheduled | Former autopay retry job removed in single-business migration. | Deprecated |

Validation notes:
- `apps/backend/vercel.json` is the only Vercel config with cron definitions.
- `frontend/vercel.json` and `apps/frontend/vercel.json` do not define crons.
- `.github/workflows/db-backup.yml` is manual `workflow_dispatch`; its schedule entries are commented out. Timestamped `.bak` workflow files are repo artifacts, not active scheduled workflows.
- Redis queue primitives exist, but current business correctness remains owned by cron routes and synchronous service paths.

## Active Jobs

| Job | Route | Criticality | Schedule | Status | Owner |
|---|---|---|---|---|---|
| Rent generation | `/api/cron/generate-rent` | P0 Business Critical | `30 18 * * *` UTC / 00:00 IST | Active | Billing |
| Rent reminders | `/api/cron/rent-reminders` | P1 Important Operations | `0 2 * * *` UTC / 07:30 IST | Active | Collections |
| Payment reconciliation | `/api/cron/reconcile-payments` | P0 Business Critical | `30 3 * * *` UTC / 09:00 IST | Active | Payments |
| Move-out releases | `/api/cron/move-out-releases` | P1 Important Operations | `30 18 * * *` UTC / 00:00 IST | Active | Move-outs |
| Admissions reservation expiry | `/api/cron/admissions` | P1 Important Operations | `45 18 * * *` UTC / 00:15 IST | Active | Admissions |
| Agreement lifecycle | `/api/cron/agreement-lifecycle` | P1 Important Operations | `30 1 * * *` UTC / 07:00 IST | Active | Agreement Lifecycle |
| Owner daily briefings | `/api/cron/daily-briefings` | P1 Important Operations | `0 2 * * *` UTC / 07:30 IST | Active | WhatsApp Assistant |

## Platform Maintenance Jobs

| Job | Route | Criticality | Schedule | Status | Owner |
|---|---|---|---|---|---|
| Hostel invariants | `/api/cron/hostel-invariants` | P2 Platform Maintenance | `0 1 * * *` UTC / 06:30 IST | Active | Platform Integrity |
| Migration audit | `/api/cron/migration-audit` | P2 Platform Maintenance | `15 1 * * *` UTC / 06:45 IST | Active | Platform Integrity |

## Dormant Jobs

| Job | Route | Criticality | Schedule | Status | Owner |
|---|---|---|---|---|---|
| Tenant analytics repair | `/api/cron/tenant-analytics` | P2 Analytics Repair | Not scheduled | Dormant | Tenant Intelligence |

Dormant note: `tenant-analytics` is not business critical. Payment recording and tenant score reads already perform targeted score recalculation. Future ownership candidates are event-driven updates and the action intelligence engine.

## Frozen Jobs

| Job | Route | Criticality | Schedule | Status | Owner |
|---|---|---|---|---|---|
| Data retention cleanup | `/api/cron/data-retention` | P3 Risk-Gated Maintenance | Not scheduled | Frozen | Platform Governance |

Frozen note: `data-retention` permanently deletes records and has no archive path. It must remain unscheduled until HMS has a documented retention policy, backup policy, archive strategy, and cron auth review.

## Deprecated Jobs

| Job | Route | Criticality | Schedule | Status | Owner |
|---|---|---|---|---|---|
| Overflow billing | `/api/cron/process-overflow` | P3 Deprecated | Not scheduled | Deprecated | Billing |
| Owner onboarding nudges | `/api/cron/onboarding-nudges` | P3 Deprecated | Not scheduled | Deprecated | Onboarding |
| Add-on reconciliation | `/api/cron/reconcile-addons` | P3 Deprecated | Not scheduled | Deprecated | Billing |
| Autopay retries | `/api/cron/process-autopay-retries` | P3 Deprecated | Not scheduled | Deprecated | Payments |

## Governance Rule

No new cron should be merged without updating this registry.

Every new cron requires:
- Business purpose
- Owner domain
- Criticality
- Schedule with UTC and IST equivalents
- Recovery procedure
- Cron registry entry

Do not introduce GitHub Actions, queues, or merged mega-crons as part of routine cron additions. Architecture changes require a separate design review.

## Dead Cron Removal Report

Removed from `apps/backend/vercel.json`:
- `/api/cron/process-overflow`: route exists only as a 410 Gone deprecated endpoint.
- `/api/cron/onboarding-nudges`: route exists only as a 410 Gone deprecated endpoint.

Routes retained in code with explicit deprecation comments so old monitors and manual calls fail clearly.

## Daily Briefing Enablement Report

Enabled `/api/cron/daily-briefings` in `apps/backend/vercel.json`.

Schedule:
- Target local time: 07:30 IST daily.
- Vercel cron expression: `0 2 * * *` UTC.

Verification:
- Route exists and is protected by `CRON_SECRET`.
- Route calls `briefingEngine.generateBriefingForOwner`.
- Briefing engine writes `owner_daily_briefing_v1`.
- Route sends through `MetaWhatsAppProvider.sendTemplate`.
- Route writes delivery attempts to `whatsapp_logs`.
- Delivered owner/date records are skipped on repeat runs.

## Active Job Classification Report

| Job | Purpose | Criticality | Schedule | Owner Domain |
|---|---|---|---|---|
| Rent generation | Generate rent and maintenance obligations. | P0 | `30 18 * * *` UTC / 00:00 IST | Billing |
| Rent reminders | Send reminders and apply eligible late fees. | P1 | `0 2 * * *` UTC / 07:30 IST | Collections |
| Payment reconciliation | Repair stuck payment attempts and sync provider status. | P0 | `30 3 * * *` UTC / 09:00 IST | Payments |
| Move-out releases | Release rooms and close tenant state after exit date. | P1 | `30 18 * * *` UTC / 00:00 IST | Move-outs |
| Admissions reservation expiry | Expire stale room reservations. | P1 | `45 18 * * *` UTC / 00:15 IST | Admissions |
| Agreement lifecycle | Transition expiring/expired agreements and create renewal reminders. | P1 | `30 1 * * *` UTC / 07:00 IST | Agreement Lifecycle |
| Owner daily briefings | Send morning WhatsApp focus briefing. | P1 | `0 2 * * *` UTC / 07:30 IST | WhatsApp Assistant |

## Dormant Job Report

`/api/cron/tenant-analytics` remains unscheduled and undeleted.

Reason:
- Not business critical.
- Payment writes and tenant score reads already perform targeted self-healing recalculation.
- Better future fit for event-driven tenant intelligence or the action intelligence engine.

## Frozen Job Report

`/api/cron/data-retention` remains unscheduled and undeleted.

Reason:
- Current implementation permanently deletes records.
- No archive path exists.
- Retention policy is undecided.
- Cron auth needs review before this endpoint can become scheduled.

Required before scheduling:
- Retention policy
- Backup policy
- Archive strategy
- Auth review

## Recovery Procedures

| Job | Recovery procedure |
|---|---|
| Rent generation | Re-run the route with `CRON_SECRET`; idempotency locks and rent-generation ledgers prevent duplicate obligations. |
| Rent reminders | Re-run the route with `CRON_SECRET`; verify reminder logs and late-fee output before repeating a failed production run. |
| Payment reconciliation | Re-run the route with `CRON_SECRET`; inspect payment reconciliation runs and provider snapshots for unresolved attempts. |
| Move-out releases | Re-run the route with `CRON_SECRET`; unreleased completed/vacated move-outs remain eligible until `room_release_date` is set. |
| Admissions reservation expiry | Re-run the route with `CRON_SECRET`; active expired reservations are updated in bulk. |
| Agreement lifecycle | Re-run the route with `CRON_SECRET`; agreement reminder timestamps and status checks prevent duplicate lifecycle notifications. |
| Owner daily briefings | Re-run the route with `CRON_SECRET`; delivered owner/date records are skipped, failed records may retry. |
| Hostel invariants | Re-run the route with `CRON_SECRET`; inspect persisted invariant failures before remediation. |
| Migration audit | Re-run the route with `CRON_SECRET`; inspect the latest `migrationAuditRun` row and its database-backed `artifact` JSON. |
