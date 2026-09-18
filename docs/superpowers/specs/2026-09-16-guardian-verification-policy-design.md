# Guardian verification becomes a hostel policy, and a deferral is a dated promise

**Date:** 2026-09-16
**Status:** Approved, ready for planning
**ADR:** ADR-212 (confirm against `origin/main`'s `Decisions.md` at merge time)

## The problem

Guardian phone verification is an unconditional hard gate on tenant onboarding, in two
places:

- `activation-workflow-service.saveProfile()` refuses to save the Identity step unless a
  `ParentVerify` OTP is supplied and verifies.
- `activation-workflow-service.activate()` re-checks independently and throws
  `Parent/Guardian phone number must be verified via OTP` for any STUDENT, or anyone who
  entered a guardian number at all.

So a tenant standing at a reception desk, whose parent is asleep, travelling, or simply not
picking up, cannot finish onboarding. The hostel's real-world remedy is to abandon the
onboarding and try again later, which is exactly the friction this spec removes.

The requirement is *not* to stop caring about verification. It is to stop letting an
unreachable third party block a tenant who is standing right there, while keeping the
verification itself inevitable.

## What changes, in one paragraph

An owner decides per hostel whether guardian verification is **chased** or merely
**recorded**. In both modes the number is collected and onboarding asks for verification
prominently. In both modes the tenant may defer and enter the dashboard. In a MANDATORY
hostel the deferral starts a 7-day clock, after which a skippable wall appears on dashboard
entry until it is done; in an OPTIONAL hostel the deferral is simply a state, shown as a
neutral "Not verified" badge, and nothing chases it. The relay friction itself — tenant
reads a code off a parent's handset — is removed by letting the guardian confirm with one
WhatsApp button instead.

## 1. The policy

`preferences_config.tenant_rules.guardian_verification: 'MANDATORY' | 'OPTIONAL'`,
defaulting to `'MANDATORY'`.

The default matters: every existing hostel keeps exactly today's intent without an owner
touching anything, and nothing silently relaxes. It is read and written through
`hostelPolicyService`, the one chokepoint `PATCH /api/hostels/[id]/preferences` funnels
through, which means the config change log (`recordPolicyChanges`) describes this change in
the owner's audit trail for free.

Placed in `tenant_rules` alongside `agreement_required` and `emergency_contact_required`
because it answers the same question they do: *what does this hostel demand of a tenant
before they are activated?*

### Write surfaces

**Add Hostel builder.** The existing `AgreementDecisionStep` is renamed to
**Onboarding rules** and gains a second card. It already asks "does this hostel use a
tenant agreement?"; it now also asks "must a guardian's number be verified?". Two questions
of one kind in one place, rather than a sixth step in a five-step builder. The step's
existing blocker logic (`agreementStepBlocker`) is extended so the guardian choice must also
be made explicitly — there is no silent default at creation time, which is the same gap the
agreement step was built to close.

**Configuration › Onboarding › Guardian verification.** A near-clone of
`MoreConfigAgreementRequirementPage`, including its `CONSEQUENCES` structure: the screen
states what changes *for a tenant* under each choice, rather than describing the toggle.

## 2. What the toggle actually controls

|                                   | MANDATORY (default) | OPTIONAL |
|---|---|---|
| Guardian name + number collected  | Yes | Yes |
| Onboarding asks to verify         | Yes, prominently | Yes, prominently |
| Tenant may defer into the dashboard | Yes | Yes |
| Deadline and wall                 | Yes, 7 days | No |
| Nudges after onboarding           | Yes, backed off | No |
| Badge while unverified            | Amber, with an action | Grey, factual, no action pressure |
| Owner can request confirmation    | Yes | Yes |

The toggle is only *"do we chase this"*. Both modes still collect the number, so the
emergency contact and the guardian WhatsApp channel survive in both.

## 3. State

### Proof stays in the OTP audit trail

`guardian-access.ts` deliberately derives verification from the `phone_verification_otps`
trail rather than a status column, "so there is exactly one record of what happened and no
second thing to keep in sync with it". That stance is kept. No `guardian_verified` boolean
is introduced.

### The scoping defect this change must fix

The onboarding check is:

```
phoneVerificationOtp.findFirst({ where: { phone, purpose: 'ParentVerify', status: 'VERIFIED' } })
```

It is **scoped to a phone number globally, with no tenant link and no time window**. Any
number ever verified for any tenant therefore reads as verified for every tenant, forever.
`guardian-access.isGuardianVerified()` at least bounds its equivalent lookup to
`VERIFICATION_VALID_DAYS` (90); the onboarding path does not.

This is tolerable while verification is an unconditional gate that everyone passes on the
spot. It is not tolerable once the product renders a **"Verified" badge** and an owner makes
decisions from it. A badge that can be wrong is worse than no badge.

Fix: add a nullable `tenant_id` to `phone_verification_otps`, populated when the OTP is
issued from an activation or guardian-request flow, and scope the onboarding check to it.
Rows with `tenant_id IS NULL` are accepted as legacy for a transition window, so no existing
verified guardian regresses to unverified. `guardian-access.ts` keeps its phone-wide 90-day
lookup unchanged — it asks a genuinely different question ("is this handset a verified
guardian at all?") and answering it per-tenant would be wrong.

### Deferral state is new and cannot live in the OTP trail

Three columns on `tenants`:

| Column | Purpose |
|---|---|
| `guardian_verification_deferred_at` (timestamptz, null) | Starts the 7-day clock. Null means never deferred. |
| `guardian_verification_deferred_reason` (text, null) | One of a fixed set, captured at deferral. |
| `guardian_verification_prompt_count` (int, default 0) | Lets the wall back off instead of escalating in volume. |

### Migration ordering is load-bearing

Declaring a field on a Prisma model makes Prisma request that column on every read of the
model that passes no explicit `select`. On 2026-08-22, declaring `hostels.navigation` and
deploying ahead of its migration 500'd every public listing page in production. Both tables
here are read via `include:`-only queries.

**Therefore: the migration is applied first, the code deploys second.** Not the reverse. The
migration is written with `IF NOT EXISTS` so re-running is safe, verified against
`information_schema`, and applied by hand via psql — `prisma migrate deploy` is unusable
against this project, whose `_prisma_migrations` history was never populated.

## 4. One pure state module

`guardianVerification.ts`, with no I/O and no DOM, mirrored on both sides so the screen and
the validation that accepts it cannot drift apart — the same reasoning
`resolveGenderRequirement` already follows.

States:

- `NOT_APPLICABLE` — no guardian number on file and the tenant is not a STUDENT.
- `VERIFIED` — a tenant-scoped `ParentVerify` row exists.
- `PENDING_UNCHASED` — unverified in an OPTIONAL hostel. Terminal unless someone acts.
- `PENDING_GRACE` — deferred in a MANDATORY hostel, within 7 days.
- `PENDING_OVERDUE` — deferred in a MANDATORY hostel, past the deadline. The wall shows.

The deadline is a fixed 7 days from `guardian_verification_deferred_at`, deliberately not
owner-configurable. One knob is a decision; two knobs is a settings screen nobody reads.

## 5. Removing the relay: guardian-side one-tap confirmation

The friction is not the OTP. It is that the *tenant* must obtain a code from someone else's
handset. So the guardian confirms directly.

A new template `stayo_guardian_verify_request` names the tenant and hostel and carries one
quick reply, **[Yes, that's my ward]**. Tapping it delivers an inbound webhook of type
`button`, which `extractMessageEvents` already handles — that path was opened when
`stayo_guardian_whatsapp_activated` shipped its `[Help]` button, and its payload resolves
through the ordinary command vocabulary rather than `decodePayload`.

Mechanically this reuses everything rather than adding a parallel concept: "send request"
writes a `phone_verification_otps` row with `purpose: 'ParentVerify'`, `status: 'PENDING'`,
`tenant_id` set, a 24-hour expiry, and a random hash the tenant never sees. The button tap
flips that row to `VERIFIED`. Same proof, same audit trail, no new table, and
`sendGuardianActivation` fires afterwards exactly as it does today — so confirming gives the
guardian something immediately rather than producing a database row and silence.

If the number is on file for more than one tenant, the handler replies with a list picker
rather than guessing which ward is meant.

**Meta approval is the lead time.** The template must be approved before it can be sent to a
handset that has not messaged us. So the feature ships behind a fallback: if the template
env var is unset or the send fails, the "send to guardian" action degrades to the existing
OTP relay, and everything else in this spec still works. A template's name and parameter
vector are code, not configuration (ADR-196), so it gets a contract module and a contract
test like every other template here.

## 6. Tenant experience

The design principle: **make the good path the easy path, make the skip honest, and never
make the skip feel like defeat.**

- **The skip is available but subordinate.** Primary button: *"Send confirmation to
  {guardian_name}"*, using the name they typed a moment ago. Secondary: *"I have the code"*.
  Tertiary, a plain text link: *"My guardian can't confirm right now"*. Progressive
  disclosure — discoverable without being the path of least resistance.
- **Skipping costs one honest question.** *"What's in the way?"* — travelling / no WhatsApp /
  not reachable right now / prefer not to. Naming an obstacle creates ownership of it, and it
  hands the owner a real reason instead of a blank.
- **Say the date out loud, immediately.** *"No problem — we'll ask again on 23 Sep."* An
  open-ended nag is more aversive than a scheduled one. This converts vague dread into a
  diary entry, and it is simply true.
- **Frame it as completion, not compliance.** The dashboard card joins the existing
  `ProfileCompletionNudge` family, presenting verification as the last item in an
  almost-finished set. People finish what looks nearly finished.
- **The wall leads with what the guardian gains** — rent reminders, paying on their ward's
  behalf, being reachable in an emergency — not with what the hostel demands. *"Not now"* is
  plain text at the bottom, always present, never delayed behind a timer. A dark pattern here
  would buy verification and spend trust.
- **Back off, don't escalate volume.** The wall appears on day 7, then on every third
  dashboard entry, capped at once per day, counted by `guardian_verification_prompt_count`.
- **Neutral wording.** "Not verified" — amber in MANDATORY, grey in OPTIONAL. Never red,
  never phrased as an accusation against a parent who has done nothing wrong.

## 7. Owner experience

The tenant record shows `Guardian · Not verified · Request confirmation`, where the action
sends the guardian message directly — the owner is often the person who actually met the
parent at move-in, and is better placed to chase than the tenant.

This also corrects `AttentionChips.tsx`, whose "Guardian Unverified" chip currently fires on
`!tenant.guardianPhone` — that is a *missing* number, not an unverified one. The two states
become distinguishable now that unverified is a real, common state rather than an impossible
one.

**Out of scope for v1:** an owner-facing worklist of all unverified guardians across a
hostel. Recorded here so it is a decision rather than an omission.

## 8. Backend changes

- `saveProfile()` — stop requiring the OTP. Keep every format, uniqueness and
  not-the-tenant's-own-number check. Accept an explicit deferral (with reason) and stamp
  `guardian_verification_deferred_at`.
- `activate()` — remove the independent hard gate entirely, in both modes. An unverified
  guardian no longer prevents activation.
- `getStatus()` — extend the existing `verification_status` with the hostel's policy, the
  computed state, and the deadline, so the screen renders from server-computed truth rather
  than deriving policy client-side.
- New: an endpoint to send a guardian confirmation request, and the webhook handler that
  resolves the reply.

## 9. Testing

Backend (`vitest`): policy resolution and defaulting; deferral recording; deadline maths;
activation succeeding while unverified; the guardian confirm handler including the
multi-ward picker; tenant-scoped verification including the legacy `tenant_id IS NULL`
fallback; the template contract (pure). New pure specs must be added to
`vitest.pure.config.ts`'s explicit include allowlist or they silently never run.

Frontend: the pure state and copy module only. This suite is node-environment with no jsdom
and matches `src/**/*.test.ts` — no `.test.tsx`, no component rendering.

## 10. Documentation

ADR-212 in `docs/obsidian/Decisions.md`, plus `Business-Rules`, `APIs`, `Database`,
`Features` and `Changelog` in the same change, and `docs/data-models/schema.md` for the
schema half.

## Risks

- **Meta template approval may lag the code.** Mitigated by the OTP fallback; the feature is
  useful before approval, better after.
- **Loosening a gate is hard to reverse quietly.** Mitigated by defaulting every existing
  hostel to MANDATORY, so the change is opt-in per hostel and visible in the config log.
- **The `tenant_id` backfill is deliberately not attempted.** There is no reliable way to
  attribute historical OTP rows to a tenant, so they are accepted as legacy rather than
  guessed at. The transition window ends when someone decides it does; until then, a
  pre-existing verification is trusted exactly as much as it is today.
