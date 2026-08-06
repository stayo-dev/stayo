# Known Issues

## Canonical UI ambiguity

`apps/frontend/` is documented as canonical by request.
`README.md` previously described `frontend/` as active UI.

**How this works:**
1. Two UI trees contain overlapping behavior.
2. Deployment may still point at the older UI.
3. A rebuild must choose one UI before launch.

## Hardcoded production API URL

`apps/frontend/src/lib/api-client.ts` uses `https://api.sriadithyahostels.in/api` for non-local hosts.

**How this works:**
1. Localhost uses `/api`.
2. Non-local browser hosts ignore environment API config.
3. New clients must replace or parameterize this URL.

## Hardcoded brand and legal content

Sri Adithya names, domains, emails, legal text, and receipt text appear across frontend and backend files.

**How this works:**
1. Public pages set SEO and legal identity.
2. App screens repeat brand names in navigation and payment copy.
3. Receipts and emails repeat brand trust text.

## Stale environment validation — RESOLVED 2026-08-06

`scripts/validate_env.sh` previously referenced `PHONEPE_*` variables.
The only payment provider actually implemented in code is **Razorpay**
(`src/services/payments/providers/razorpay.ts`, `RAZORPAY_KEY_ID`/
`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`) — no `phonepe.ts`
provider file exists anywhere in the repo. This claim had the vendor
names backwards (it previously said the opposite: that the script
referenced Razorpay while code used PhonePe). The script, CLAUDE.md,
and `docs/build-guide/environment-variables.md` have been corrected to
match.

## String statuses

Many database statuses are plain strings instead of Prisma enums.

**How this works:**
1. Services can write inconsistent status spelling.
2. UI badges may miss unknown values.
3. A rebuild should centralize high-risk statuses.

## Split service directories

Backend services exist in both `apps/backend/lib/services` and `apps/backend/src/services`.

**How this works:**
1. Older and newer domain code live side by side.
2. Route handlers may import either tree.
3. Refactoring needs import tracing before deletion.

## Some v2 services reference unconfirmed endpoints

Examples include selected document nested routes, payment export, payment waive, and bulk generation.

**How this works:**
1. Service wrappers can outpace backend route implementation.
2. UI code may compile while runtime calls fail.
3. Endpoint verification is required before production handoff.

## Remaining dashboard bundle hotspots

The hostel detail route now loads as feature islands.
The chart vendor chunk remains about 101 kB gzip after splitting.
The owner dashboard and hostel finance first paint now use shell endpoints instead of full aggregate waterfalls.
The tenant route loads its academic mix chart after idle time, but Recharts still remains the largest async visual vendor.

**How this works:**
1. The route shell downloads first.
2. Owner users download only the active hostel tab.
3. Payment, tenant, rent obligation, and expense lists now use virtualization.
4. Portfolio risk uses a four-row overdue preview for mobile first paint.
5. Hostel finance KPIs use `/api/dashboard/stats-shell`; activity and analytics load through deferred endpoints.
6. Tenant dashboard secondary widgets and expense intelligence now wait behind idle render boundaries.
7. Further gains require replacing or shrinking the chart vendor chunk.

## Frontend runtime work still needs field tracing

The latest pass removes full-screen auth gating and reduces above-the-fold mount work.
Real device traces are still needed after deployment.

**How this works:**
1. Local builds confirm chunk isolation and type safety.
2. Chrome field traces confirm whether LCP render delay moved.
3. INP traces identify remaining event-handler or layout hot paths.

## Redis queue adoption is partial

Redis queue primitives exist for reminders, emails, receipts, rent generation, and late-fee work.
Existing business services still execute most jobs directly.

**How this works:**
1. The queue layer can enqueue, claim, retry, and dead-letter jobs.
2. Current cron services still own business correctness.
3. Move one job type at a time after idempotency tests exist.

## Session hardening rollout requires migration

Session lifecycle fields now extend `refresh_tokens`.
Production must apply the migration before deploying the auth routes.

**How this works:**
1. New logins write `session_id`, `last_activity_at`, `absolute_expires_at`, and revocation metadata.
2. Old refresh-token rows remain readable because new fields are nullable.
3. Full protection applies after users rotate into new sessions.
