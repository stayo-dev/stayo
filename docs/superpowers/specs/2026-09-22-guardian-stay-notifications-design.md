# Guardian stay notifications — design

**Date:** 2026-09-22 · **Status:** approved, not yet built · **Branch:** `feat/guardian-stay-notifications`
**ADR:** ADR-233 (claimed against `origin/main` at 152d29e3, where ADR-232 is the high-water mark — **re-check at merge time**, per the ADR-193 collision recorded in [[Decisions#ADR-194|ADR-194]])
**Builds on:** [Stay Status Phase 1](2026-09-14-stay-status-design.md) (ADR-194) · [Guardian verification policy](2026-09-16-guardian-verification-policy-design.md) (ADR-212/213)

## 1. What this is

A guardian is told when their ward leaves the hostel and when they get back — and nothing else.

Stay Status Phase 1 named "guardian notifications" as a Phase 3 follow-up, to be built the way
every Stay follow-up is built: **a new read model over the same event stream, not a change to the
core.** This is that slice.

The tenant is asked once, the first time they ever leave. If they say no, they are not asked again.

## 2. The rules this design is checked against

Inherited from ADR-194 and treated as binding:

> **`stay_events` is the permanent truth. Every UI is a projection of it.**

1. **Reduce decisions, don't display options.** One primary action per screen; everything else
   behind **More**.
2. **The two-second rule.** Going home is two taps in the common case — and *stays* two taps after
   this ships.
3. Future modules are new read models and new event types. `applyStayEvent` does not change.

One more, inherited from `guardian-reminder-policy.ts` and the history it documents:

4. **A guardian's inbox must not become a complaint box.** Guardians were once contacted only when
   rent was three days late, so every message they had ever received was bad news. The same trap is
   available here — see §4.

## 3. Scope

**In:**

- consent: asked once on the first `Going home`, stored, revocable
- a guardian message on `LEAVE_STARTED` and on `RETURNED`
- two Meta templates
- `STOP` from the guardian's side, scoped to stay updates only
- an inline send plus a cron sweep that re-attempts what the inline send lost

**Out, deliberately:**

- `RETURN_DATE_CHANGED`, `LEAVE_CANCELLED` and `LATE` are **silent** (§4)
- **per-trip suppression** ("don't tell them this time") — §7, D5
- guardian logins. `schema.prisma` still says *"parent/guardian logins are explicitly out of scope
  — there is no second account here"*, and ADR-127 upholds it. A guardian remains a messaging
  identity resolved from `tenants.guardian_phone`. **Do not let this slice quietly turn it into an
  account.**
- notifying on move-in / move-out (residency boundaries). A separate, one-time-per-tenancy concern;
  if it is wanted it is its own slice, reusing this consent record.

## 4. Why `LATE` is silent

It is the one event a parent would most want, and the one most likely to be wrong.

Silence = Present is **trust-based and self-reported**. A resident who came back at 2am and never
tapped *I'm back* is indistinguishable, to this system, from one who did not come back at all. A
`LATE` template turns that ambiguity into "your child is not where they said they would be,"
delivered to a parent, at scale, on the strength of a missed tap.

As of this writing **no phone has ever scanned the Stay QR in production**, so the real-world
missed-tap rate is not merely unmeasured — it is unobserved. Late returns stay on the owner's
board, where a human reads them in context and can pick up a phone.

`RETURN_DATE_CHANGED` and `LEAVE_CANCELLED` are silent for a smaller reason: they are amendments to
a plan, and forwarding every amendment is how a reassuring channel becomes a noisy one.

## 5. Consent

### 5.1 A new table, not a column on `tenants`

```prisma
model stay_guardian_consent {
  tenant_id      String    @id @db.Uuid
  hostel_id      String    @db.Uuid
  granted        Boolean
  guardian_phone String
  decided_at     DateTime  @default(now()) @db.Timestamptz(6)
  revoked_at     DateTime? @db.Timestamptz(6)
  stopped_at     DateTime? @db.Timestamptz(6)
  source         String    // "APP" | "QR" — where the tenant was standing when asked
  updated_at     DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([hostel_id], map: "stay_guardian_consent_hostel_idx")
}
```

**Why not two columns on `tenants`.** `getSession()` calls `getActiveTenancy` → `tenants.findMany`
with no explicit `select`, on **every authenticated request, for every role**. Prisma therefore
selects the full column set, so a column that exists in `schema.prisma` but not yet in the database
500s the entire authenticated API — not just the screen that uses it. That is the 2026-08-14
production outage, recorded in [[Bugs]], and adding a `tenants` column is the exact shape of it. A
new table is not reached by that query at all.

### 5.2 Four properties of this row

| Property | Why |
|---|---|
| **A declined row still exists** (`granted = false`) | The row is the memory of *having asked*. Without it there is no way to distinguish "said no" from "not asked yet", and the sheet reappears on every trip — which breaks rule 2 permanently, for exactly the tenants who least want it. |
| **`guardian_phone` is snapshotted, normalised** | Consent was given to tell *a person*, not to tell *a field*. If the number changes, consent lapses and the tenant is asked again — the same rule `guardian_activation` already applies when deciding whether a new number has been told anything. |
| **`stopped_at` is separate from `revoked_at`** | `revoked_at` is the tenant switching it off; `stopped_at` is the guardian replying STOP. If the tenant later re-grants, a guardian who asked to be left alone must **not** be silently re-subscribed. Collapsing these into one column loses that, silently, and in the direction that generates complaints. |
| **No `granted_by`** | There is only one person who can grant this. If that ever stops being true, this row needs revisiting before the new grantor is added. |

### 5.3 The flow

Only the **first** `Going home` or `Vacation` differs from today:

```
tap Going home  →  return-date sheet  →  [first time only: consent sheet]  →  LEAVE_STARTED
```

The consent sheet posts to `POST /api/tenant/stay/guardian-consent` **before** the stay event is
recorded, as a separate call. Folding the decision into the event body would mean a declined
consent is lost whenever the leave itself then fails — and the tenant would be asked again next
time, having already said no.

Every subsequent trip is unchanged: two taps.

## 6. The notifier

### 6.1 The decision is pure; the send is not

Mirrors the existing split (`guardian-reminder-policy.ts` pure, `guardian-activation.ts` I/O):

- **`lib/services/notifications/command-center/stay-guardian-policy.ts`** — pure.
  `decideStayGuardianNotice(input) → { notify, reason }`.
- **`lib/services/notifications/command-center/stay-guardian-updates.ts`** — I/O. Loads the tenant,
  the consent row and the verification state, calls the policy, calls
  `whatsAppTemplateDeliveryService.send`. **Never throws.**
- **`lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts.ts`** — pure.
  Template names, languages, parameter vectors and a copy of each approved body.

**This split is load-bearing, not stylistic.** The test Supabase project is gone, so the DB-backed
vitest suite cannot run anywhere ([[stayo-test-db-dead]]). Whatever is pure runs under
`vitest.pure.config.ts` and is genuinely verified before this ships; whatever is not, is not. So the
decision table, the copy and the parameter vectors all live in pure modules, and the I/O module is
kept as thin as it can be.

### 6.2 The decision table

`reason` is carried into logs so "why did / didn't they get this" is answerable without a re-run.

| `reason` | `notify` | Meaning |
|---|---|---|
| `LEAVE` | yes | `LEAVE_STARTED`, everything satisfied |
| `RETURN` | yes | `RETURNED`, everything satisfied |
| `NOT_NOTIFIABLE` | no | any other event type |
| `NO_CONSENT` | no | never asked |
| `DECLINED` | no | asked, said no |
| `REVOKED` | no | tenant switched it off |
| `STOPPED_BY_GUARDIAN` | no | guardian replied STOP — outranks a later re-grant |
| `PHONE_CHANGED_SINCE_CONSENT` | no | `guardian_phone` ≠ the snapshot; a different person |
| `GUARDIAN_UNVERIFIED` | no | §6.3 |
| `NO_GUARDIAN_PHONE` | no | field empty |
| `SAME_AS_RESIDENT` | no | one handset in both fields (compared on normalised digits) |

### 6.3 Unverified guardians get nothing

`sendPaymentConfirmation` already skips an unverified guardian (`GUARDIAN_UNVERIFIED`), and a
resident's movements are more sensitive than a rent balance, not less. Verification is the existing
90-day window over `phone_verification_otps`, accepting both `GUARDIAN_ACCESS` and the onboarding
`ParentVerify` purpose — `isGuardianVerified` already encodes this.

This matters more than it looks: ADR-212's deferral path means a tenant can activate with a guardian
number that was **never OTP-proved**. `guardian_phone` is typed by hand, often at speed; one
transposed digit and a stranger's handset receives a running account of a named student's movements
at a named address. Those tenants get silence.

### 6.4 Trigger: inline, plus a sweep

**Inline.** After `recordStayEvent`'s transaction commits and only for `LEAVE_STARTED` / `RETURNED`,
fire-and-forget. This is a call site added *after* the write path, not a change to `applyStayEvent`
or to the reducer's semantics — rule 3 holds.

**Sweep.** `GET /api/cron/stay-guardian-sweep`, **daily**, re-attempting the last **48 hours** of
those two event types. Dedupe is already solved: `whatsAppTemplateDeliveryService` reserves on
`whatsapp_logs.idempotency_key`, so with

```
idempotency_key = stay_guardian:{stay_events.id}
```

whichever path arrives first sends and the other returns `{ skipped: true }`. No cursor table, no
new dedupe machinery, no event stream mutation.

**Why a sweep at all.** `sendGuardianActivation`'s swallow-everything pattern is right for
onboarding — a lost activation notice is recoverable, and onboarding must not fail for WhatsApp. It
is *not* sufficient here. A parent who has been promised "we'll message you when they're back", and
is not messaged because the provider was down at 11pm, has been failed in the exact way this feature
exists to prevent — and with inline-only, nothing would remember it was owed.

### 6.5 Why the sweep is daily, and what that costs

**It cannot be anything else.** This account is on **Vercel Hobby**, where a sub-daily cron *fails
the deployment outright rather than degrading* — stated in the header of
`app/api/cron/partner-lead-fallback/route.ts` and again in `.github/workflows/keep-warm.yml`, which
is why all eight crons in `vercel.json` are daily. A `*/30` schedule would not have run late; it
would have broken the deploy.

The alternative — a GitHub Actions schedule, as `keep-warm.yml` still uses — is rejected. ADR-179
deliberately moved all six business crons *out* of GitHub Actions and into `vercel.json`, leaving
keep-warm as the last one standing; reintroducing a business cron there to save a backstop reverses
that decision for a secondary path.

So the backstop is up to ~24 hours behind, and two consequences follow:

1. **The inline send is the real delivery path.** The sweep recovers messages that would otherwise
   be lost forever; it is not a substitute for prompt delivery, and it should not be reasoned about
   as one.
2. **Both templates are self-dating, which is what makes a late send survivable.** "checked in at
   7:40 PM, 27 Sep" arriving on the morning of the 29th is still true and still legible — it reads
   as a record rather than a stale alert. Any future template in this family must carry its own
   date for the same reason; one that says "just now" cannot be swept.

**Staleness guard.** The sweep skips an event whose message is no longer true:

- `LEAVE_STARTED` — skip if the leave is no longer `ACTIVE` (already returned or cancelled), or if
  its `expected_return_date` has passed. "has left and is expected back on Sunday" must not arrive
  on Monday, to a parent who has already seen their child.
- `RETURNED` — no guard. A return is a completed fact and does not expire.

The 48-hour window is slack around a daily run, not a delivery promise; the guard above is what
actually decides.

**Efficiency.** The sweep's query joins `stay_guardian_consent` on `granted = true` with no
`revoked_at` / `stopped_at`, so events belonging to tenants who never consented are never loaded —
otherwise every run would re-evaluate the policy for every leave in the system to reach the same
`NO_CONSENT` it reached yesterday.

## 7. Product decisions

| # | Decision | Why |
|---|---|---|
| D1 | Ask **once**, on the first leave — not per trip, not in onboarding | Per-trip breaks the two-tap rule. Onboarding asks months early, in the abstract, on a screen already dense with guardian setup — an answer given there is not an informed one. |
| D2 | Consent is **opt-in**, never default-on | Telling a third party where an adult resident is, is not implied by renting a bed. Default-on is not consent, and it is the reading most likely to produce a complaint that is entirely justified. |
| D3 | `LATE` is silent | §4 |
| D4 | `STOP` is scoped to stay updates only | §8.3 |
| D5 | **No per-trip suppression in v1** | Floated during design and dropped. It puts a decision back onto the path deliberately designed to have none, and "tell them, except when I don't want to" is a preference whose real use is concealment — which is not a thing to build a consent feature around. Revocation is permanent and lives in Profile and under **More**. |
| D6 | The tenant is told what happened | On a successful grant, and on each subsequent leave, the toast names it: "Dad will be told." A channel that reports on you should never be invisible to you. |

## 8. The Meta templates

Category **UTILITY**, language **en**, no buttons, 12-hour validity period. Third person about the ward, per `voice.ts`.
`{{2}}` is a **bare name, never a possessive** — `tenantDisplayName()` strips one if a caller passes
it, exactly as `guardian-activation-template-contract.ts` documents.

### 8.1 `stayo_guardian_stay_departure` — on `LEAVE_STARTED`

**As submitted to Meta on 2026-09-22** — this differs from the design below it, and Meta's copy is
authoritative:

```
Header:  Left the hostel
Body:    Hello {{1}},
         {{2}} has left {{3}} for {{4}} and is expected back on {{5}}.

         _We'll message you again {{6}} when returns._
Footer:  Stayo Property Management
```

| # | Parameter | Example |
|---|---|---|
| 1 | `guardian_name` | Ramesh |
| 2 | `tenant_name` | Aarav |
| 3 | `hostel_name` | Sunrise PG |
| 4 | `leave_type` | `home` (GOING_HOME) · `a trip` (VACATION) |
| 5 | `return_date` | Sunday, 27 September |
| 6 | `tenant_name_repeat` | Aarav — **the same value as `{{2}}`, always** |

**Why six parameters and not five.** The design reused `{{2}}` for the second mention of the
tenant. **Meta refuses a body that uses the same variable twice**, so the second mention became its
own variable carrying an identical value. `buildStayDeparturePayload` computes the name once and
emits it at both positions, so they cannot drift into naming two different people.

⚠️ **The submitted wording of that last line is wrong and reads as broken English:** "We'll message
you again Aarav when returns." The variable sits before the verb instead of after it. The correct
line is `_We'll message you again when {{6}} returns._` — same six parameters, same order, so
**fixing it changes no code beyond the stored `body` string**. Not yet corrected at Meta.

`{{4}}` is the only reason both leave types share one template — the single preposition "for"
carries `for home` and `for a trip` alike. Meta rejects a blank parameter, so the mapper falls back
to `a trip` for an unrecognised leave type rather than emitting an empty string.

### 8.2 `stayo_guardian_stay_return` — on `RETURNED`

```
Header:  Back at the hostel
Body:    Hello {{1}}, {{2}} has returned to {{3}} and checked in at {{4}}.
         Nothing is needed from you — this is just so you know.
Footer:  Stayo Property Management
```

| # | Parameter | Example |
|---|---|---|
| 1 | `guardian_name` | Ramesh |
| 2 | `tenant_name` | Aarav |
| 3 | `hostel_name` | Sunrise PG |
| 4 | `check_in_time` | 7:40 PM, 27 Sep (IST) |

Submitted exactly as designed. Note it kept `Hello {{1}}, {{2}} has returned` — two variables with
only a comma between them — and Meta accepted it, so adjacency was never the constraint. The
repeated variable in 8.1 was.

> Hello Ramesh, Aarav has returned to Sunrise PG and checked in at 7:40 PM, 27 Sep. Nothing is
> needed from you — this is just so you know.

**IST is explicit**, not the hostel's timezone: production `hostels.timezone` is `UTC`, and the rest
of the Stay module already works in IST for this reason.

### 8.3 `STOP`

New entry in `VOCABULARY` (`commands.ts`). Deliberately **absent from `PUBLISHED_COMMANDS`** — the
HELP menu is about rent, and advertising an opt-out there invites a parent to switch off the
payment channel while trying to switch off location updates.

⚠️ **Both templates went to Meta with the house footer `Stayo Property Management`, not the
designed `Stayo · Reply STOP to pause stay updates`.** STOP still works, and is still scoped, but
**no approved template tells a guardian it exists.** In practice a parent who wants these to stop
will block the number instead of replying to it — and that degrades the same WhatsApp number that
delivers rent reminders to paying customers. Restoring the disclosure means editing an approved
template, which re-triggers Meta review (ADR-230), so it is an open item rather than a quick fix.

`STOP` sets `stopped_at` and replies naming precisely what stopped and what did not:

> Done — you won't get updates about Aarav leaving or returning. Rent reminders and payment
> receipts are unaffected. Reply HELP for what else this number can do.

**Why scoped rather than global.** A blanket STOP is the more conventional reading, and it is the
wrong one here: a parent who wanted less surveillance would silently lose the payment link, and
nobody — not the parent, not the owner, not the tenant — would find out until rent was late. The
reply states the scope in the same breath, so the narrower behaviour is disclosed rather than
assumed.

### 8.4 Parameter order is the contract

Per `rent-reminder-template-contract.ts`: a vector of the right length in the wrong order produces a
plausible message about the wrong thing, and Meta cannot catch it. Names and languages are
**hard-coded**, with no environment-variable fallback — ADR-196 records that the fallback mechanism
cost weeks of silent `132001` failures, because the fallback names had never been registered at all.

## 9. API surface

| Route | Change |
|---|---|
| `GET /api/tenant/stay` | Gains a `guardian` block on the existing `MyStay` payload |
| `POST /api/tenant/stay/guardian-consent` | **New.** `{ granted: boolean }` → the consent row |
| `GET /api/cron/stay-guardian-sweep` | **New.** Cron-authenticated, matching the sibling cron routes |

```ts
guardian: {
  eligible: boolean;   // has a guardian phone, verified, not the resident's own number
  name: string | null;
  consent: 'UNASKED' | 'GRANTED' | 'DECLINED' | 'REVOKED' | 'STOPPED';
} | null               // null when there is no guardian to speak of
```

`eligible` is computed server-side so the frontend never re-derives a rule the policy already owns —
the "compose, don't reimplement" pattern CLAUDE.md sets out for financial read models applies here
for the same reason.

## 10. Frontend

`apps/frontend/src/features/stay/`:

- `stayState.ts` — `consentSheetFor(stay)` and the More-menu entries. **Pure**, tested in
  `stayState.test.ts`.
- `components/GuardianConsentSheet.tsx` — a thin renderer over that decision.
- `StayActionPanel.tsx` — sequences date sheet → consent sheet → event.

The suite is **node-only, no jsdom, `src/**/*.test.ts` not `.tsx`**: decision logic goes in the pure
module, the component renders and decides nothing. No `.test.tsx`.

Copy for the sheet:

```
Keep Ramesh in the loop?

We'll tell him when you leave and when
you're back. That's all — never where
you are, and never anything else.

        [ Yes, tell Ramesh ]
        [ No thanks ]
```

The guardian is named, not labelled "your guardian" — the tenant is consenting to a person. "Never
where you are" is a true statement about what these two templates contain, and it is the sentence
that makes the difference between this feature and a tracker; if a future event type makes it false,
the copy changes in the same commit.

## 11. Testing

Pure suites only, for the reason in §6.1:

- `stay-guardian-policy.test.ts` — every row of the §6.2 table, including `STOPPED_BY_GUARDIAN`
  outranking a later re-grant, and `PHONE_CHANGED_SINCE_CONSENT` on a re-formatted but identical
  number (must **not** fire — the schema stores phones inconsistently, so the comparison is on
  normalised digits).
- `stay-guardian-template-contracts.test.ts` — placeholder count asserted against each parameter
  vector; `tenantDisplayName` strips `Aarav's` and `Anders'`, both apostrophe forms; the leave-type
  mapper never returns an empty string.
- `stayState.test.ts` — the consent sheet shows on the first leave, and on no other.

⚠️ **`vitest.pure.config.ts` is an explicit allowlist, not a glob.** Each new backend test file must
be added to its `include` array in the same commit, or it silently never runs — and since the main
suite cannot reach a database, "never runs" means "is never verified anywhere". The frontend suite
globs `src/**/*.test.ts`, so `stayState.test.ts` needs no registration.

**Not verifiable before merge, and to be stated plainly in the PR:** the send path, the sweep, the
`STOP` round trip, and both templates end to end. There is no test database, no server-side staging
(the backend Preview build fails by design on a missing `FRONTEND_URL`), and no phone has ever
scanned the Stay QR in production.

## 12. Rollout

1. Submit both templates to Meta. **Approval is the long pole** — nothing below can be exercised
   until they are `APPROVED` in `en`.
2. Merge and deploy the code. It is inert: with no `stay_guardian_consent` table, no consent row can
   exist, so the policy returns `NO_CONSENT` and nothing sends.
3. **Then** hand-apply the migration to `qgfyfbdccjnibdhhvnsr`, verified object by object with a raw
   `pg` client over the 6543 pooler — `prisma db execute` fails from this machine because it dials
   `DIRECT_URL`.
4. Add the sweep to `vercel.json` on a **daily** schedule at an hour no other cron occupies
   (`0 6 * * *` is free). A sub-daily schedule fails the deploy — see §6.5.

Steps 2 and 3 are in that order and not the other. Deploy-before-migrate is the rule this repo
learned on 2026-08-14; here it is also free, because the feature is inert without the table.

**RLS:** the new table must ship with RLS enabled and zero policies, matching `stay_events` and
`stay_leaves`. The anon key is in the client bundle, and five tables were recently found reachable
with it ([[Bugs]]) — a table holding "which residents are being reported on, and to which phone
number" must not become the sixth.

## 13. Documentation

In the same change, per CLAUDE.md: [[Features]], [[APIs]], [[Database]], [[Business-Rules]]
(a guardian-stay-updates section alongside the guardian reminder escalation rules), [[Decisions]]
(ADR-233), [[Changelog]].

## 14. Open questions

- **Should the owner see consent state?** An owner fielding "why wasn't I told?" from a parent
  currently has no way to answer. Against: it is the tenant's decision about their own family, and
  putting it on an owner screen invites pressure to change it. Not built; not resolved.
- **Multi-ward guardians.** One handset can be guardian to two residents. The policy is per-tenant,
  so consent and STOP are both per-ward — correct, but it means a STOP from a parent of two stops
  one ward and not the other, which may surprise them. The interactive picker that would
  disambiguate exists but has never been exercised in production.
