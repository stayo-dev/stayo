# Owner-Managed Tenants — Design

**Date:** 2026-08-27
**Status:** Approved for planning
**Related:** [[Business-Rules]], [[Database]], [[Decisions]], [[Features]]

## 1. Problem

An owner invites a tenant. The tenant ignores the link — they pay by UPI or cash,
hand to hand, and have no interest in installing anything. The owner still needs
their records: rent due, payments received, receipts, occupancy.

Today that owner is stuck. `activation-workflow-service.ts:1508` is the **only**
place a tenant becomes `ACTIVE`, and it is reachable only by the tenant clicking
their invite link and setting a password. Everything the owner cares about keys
off `ACTIVE`:

| Gate | Consequence when the tenant never clicks |
|---|---|
| `src/services/payments/rent-generation-service.ts:126` | No obligations generated — the tenant owes ₹0 forever |
| `src/services/payments/reminder-service.ts:350` | Owner cannot even manually send a reminder |
| `lib/services/room-capacity-service.ts:48` | Room reads **vacant** while a real person sleeps in it |
| `lib/services/analytics-service.ts:206` | Occupancy and revenue dashboards understate reality |

For a hostel where 8 of 30 tenants ignore the link, the owner's dashboard is
simply wrong. This is a credibility problem, not a convenience problem.

**Root cause:** one field does two jobs. `TenantStatus` answers *"does this person
have an account?"* while every consumer reads it as *"does this person live here?"*
Those are independent facts.

## 2. What must NOT be rebuilt

Auditing first changed the scope substantially. The following already exist and
are correct — the work is to *unlock* them, not to reimplement:

- **Offline payment recording.** `QuickCollectModal.tsx` (search → obligation →
  cash/UPI/bank) and `TenantActionsSheet`'s "Receive Payment" row are built and
  wired. `payments` already carries `offline_recorded_by / _at / _ip / _note`.
- **Reservation → allocation conversion**, including the overbooking capacity
  guard: `tenant-invitation-lifecycle-service.ts:1148-1163`. Currently trapped
  inside token-gated `completeActivation()`; must be extracted, not rewritten.
- **The tenancy row itself.** `tenant-invitation-lifecycle-service.ts:295-312`
  already writes `monthly_rent`, `joined_on`, `billing_start_date`,
  `security_deposit`, `maintenance_charge`, `payment_frequency`, `phone_1`,
  `hostel_id` at invite time, with `profile_id: null` by design. An ignored
  invite is a **complete tenancy that has been switched off**, not a stub.
- **OTP infrastructure.** `/api/auth/send-phone-otp`, `/api/auth/verify-phone-otp`.
- **WhatsApp reminder delivery.** `whatsappReminderDeliveryService.sendRentReminder`,
  with provider handling, idempotency keys and delivery logs already isolated
  from the business orchestrator. Reused as-is; only its *inputs* change.
- **Canonical phone normalization (frontend).** `src/shared/lib/phone.ts` —
  `canonicalPhone()` produces E.164 `+91XXXXXXXXXX`.
- **Just-in-time identity linking.** ADR-031 / `lib/auth/supabase-identity.ts`
  already treats identity as a late attachment. `profile.auth_user_id` is
  nullable by design.
- **Session revocation** via the Redis deny-list — reused by Revoke.

## 3. Approach: access as a second axis

Two independent axes replace one overloaded field.

```
tenancy status (existing)  ── does this person live here and owe rent?
  INVITED → ACTIVE → FORMER_TENANT / EXPIRED / CANCELLED

access mode (new)          ── does this person have a way in?
  OWNER_MANAGED  ⇄  SELF_SERVE
```

`ACTIVE` returns to meaning *"lives here, owes rent"* and becomes reachable two
ways: the tenant activates (today's path, unchanged), or the owner adopts them.

Every consumer in §1 then works with **zero changes**, because they already key
on `ACTIVE`. That is the central reason this approach was chosen over the two
alternatives considered:

- **Rejected — make consumers status-agnostic** (accept `INVITED` too): destroys
  a real distinction. "Invited, hasn't moved in" and "living here without an
  account" would become indistinguishable, losing the ability to tell a prospect
  from a resident.
- **Rejected — a separate offline-ledger module**: duplicates obligation and
  allocation logic, violating the standing "compose, don't reimplement" rule,
  and fails the integration requirement by construction.

The decisive property of the chosen approach: **the offline tenant is the same
row as the online one.** Receipts, ledger, settlement, move-out, agreements and
occupancy keep working, and "invite them to the app later" is an attach, not a
re-import.

## 4. Schema changes

Two additive columns on `tenants`. Both defaulted so existing rows keep today's
meaning and nothing changes underneath live data.

```prisma
enum TenantAccessMode {
  SELF_SERVE     // has (or is expected to have) their own login — today's default
  OWNER_MANAGED  // owner keeps the book; tenant has no account
}

model tenants {
  access_mode  TenantAccessMode @default(SELF_SERVE)
  display_name String?          // name for tenants with profile_id: null
}
```

`tenants` has **no name column today** — a tenant's name lives on `profile.name`
(required) or `tenant_invitations.name`. Owner-managed tenants have
`profile_id: null`, so `display_name` is where their name lives. A
`resolveTenantName(tenant)` helper falls back `profile.name → display_name →
invitation.name`, and every consumer reading `profiles.name` for a tenant moves
to it.

**Deploy order is load-bearing.** Per the 2026-08-22 outage (see [[Bugs]]),
adding a field to `schema.prisma` makes Prisma request it on *every* unselected
read of that table, 500-ing them all if the migration has not been applied.
Migration must be applied **before** the code that declares these fields ships.

One new table records the consent that an owner-managed tenancy cannot capture
from the tenant:

```prisma
model tenant_owner_attestations {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenant_id     String   @db.Uuid
  hostel_id     String   @db.Uuid
  attested_by   String   @db.Uuid   // owner profile id
  attested_at   DateTime @default(now()) @db.Timestamptz(6)
  attested_ip   String?
  rules_version String?
  note          String?
}
```

This is **not** a forged `TenantPolicyAcceptance`. Recording an owner's click as
if the tenant signed would turn the audit trail into fiction, and this is exactly
the record that matters in a deposit dispute. It is stored as what it is: the
owner asserting an offline arrangement, visibly distinct from a tenant signature
everywhere it surfaces.

## 5. Invariants

`scripts/activation-invariants-check.ts` becomes **conditional, not relaxed** —
weakening it globally would let genuine self-serve bugs through unnoticed.

- `SELF_SERVE` + `ACTIVE` → must have `profile_id`, completed profile, and a
  `TenantPolicyAcceptance` row *(unchanged — today's rule, still enforced)*
- `OWNER_MANAGED` + `ACTIVE` → must have `display_name`, a canonical phone, and
  a `tenant_owner_attestations` row
- `OWNER_MANAGED` must never have a live Supabase session (new check)
- No tenant may hold both a `TenantPolicyAcceptance` and be `OWNER_MANAGED`
  without having once been `SELF_SERVE` (catches a forged-consent regression)

## 6. Transitions

| Transition | Trigger | Effect |
|---|---|---|
| **Adopt** | Owner: "Keep records myself" on an ignored invite | `INVITED → ACTIVE`, `access_mode = OWNER_MANAGED`, reservation → allocation (reusing the extracted helper + capacity guard), attestation written. Rent generation begins. |
| **Add directly** | Owner ends the invite wizard with "Just add to my records" | Same as Adopt, without ever issuing a token. |
| **Revoke** | Owner: tenant stopped using the app | `SELF_SERVE → OWNER_MANAGED`. Row and history untouched; session revoked via the Redis deny-list; login stops working. |
| **Claim** | Tenant OTP-verifies their number, any time later | `OWNER_MANAGED → SELF_SERVE`, profile created and linked, `profile_id` set. **Same row.** |

**Revoke does not touch money.** Obligations keep generating, payments keep
being recordable, the ledger is untouched — only the way in closes. Revoking a
tenant who is actively using the app is permitted but must warn the owner
plainly, because it signs them out; it is not a silent setting.

**Adopt does not cancel the invitation.** If the tenant clicks that month-old
link after the owner has adopted them, that is a *claim*, not an error — the link
resolves to exactly the tenancy the owner has been keeping. Treating a stale
invite as invalid would break the "continue from there onwards" requirement in
the most likely way it would actually happen.

**Adopt is not the removed Activate button.** `InvitedTenantProfileView.tsx:44-47`
records that an owner-side Activate button was deliberately deleted because it
bypassed registration. Adopt does not claim registration happened; it records
that it did not, via the attestation, and marks the access mode accordingly.

## 7. Claim flow — phone is the identity

Every financial record (`rent_obligations`, `payments`, `receipts`,
`tenant_financial_ledger`, `room_allocations`) hangs off **`tenant_id`**, never
`profile_id`. Identity is a late attachment to a tenancy, not its foundation.
Claiming therefore preserves history for free — nothing migrates, nothing is
rebuilt, no duplicate row.

**Security rule, no exceptions:** whoever proves possession of the number
inherits a real person's financial history. The claim is **always OTP-gated**.
The fact that an *owner* typed and marked a number verified is never accepted as
proof — the owner asserting "this is Rakesh's number" is not evidence that the
person holding the handset is Rakesh. A single fat-fingered digit is otherwise a
data breach waiting a month to happen.

**Prerequisite — one canonical normalizer.** The backend currently has at least
three phone normalizers: `lib/services/search/ranking.ts:41`, a private one in
`lib/services/bulk-import-validation-service.ts:369`, and the invite path's own.
Today that is cosmetic. Once phone is the identity key, two normalizers
disagreeing means a tenant verifies `+91 98765 43210`, lookup misses
`9876543210`, and a **second tenancy is silently created** — the exact duplicate
this design exists to prevent. One normalizer matching `shared/lib/phone.ts`'s
E.164 output, used by both write and lookup, ships first.

Flow:

1. Tenant enters phone → OTP → verified.
2. Lookup by canonical phone across `tenants.phone_1` where
   `access_mode = OWNER_MANAGED` and status is live.
3. **Confirmation card before any linking** — "You're listed at Sunrise Boys
   Hostel, Room 204, since 12 July. Owner: Ramesh." Never auto-link without
   showing what is being claimed.
4. On confirm: attach to the logged-in profile if one exists (reusing the
   marketplace-profile-reuse rule in [[Business-Rules]] §Account types), else
   create the profile. Set `profile_id`, flip to `SELF_SERVE`, capture a real
   `TenantPolicyAcceptance` at this point.
5. Owner is notified: "Rakesh has joined the app."

Edge cases:

- **Multiple matches** (several hostels, or a former tenancy): show a picker, not
  a guess.
- **Marketplace account with `phone: null`** — per ADR-113, marketplace signup
  does not collect a phone. The flow keys on the *OTP-verified number*, not on
  `profile.phone` already being populated.
- **Owner edits the phone after adopting** — lookup follows the current value;
  the old number stops matching.
- **Room at capacity at adopt time** — the existing guard throws
  `CAPACITY_EXCEEDED`; surfaced as a room picker, not a dead end.

## 8. Reaching a tenant who has no account

Adoption alone does **not** deliver automated messages, and this is core to the
requirement rather than a later refinement. `reminder-service.ts:482` resolves
the recipient as `tenant.profiles?.phone`, and the name as
`tenant.profiles?.name`. An owner-managed tenant has `profile_id: null`, so
**every WhatsApp reminder is skipped with `TENANT_PHONE_MISSING`** and email
addresses them as "Tenant".

This is §1's root cause one layer down: the notification layer assumes a
tenant's contact details live on their *account*. For an owner-managed tenant
they live on `tenants.phone_1` and `display_name`.

**Required changes:**

1. `resolveTenantPhone(tenant)` alongside `resolveTenantName(tenant)`, falling
   back `profile.phone → tenants.phone_1`, both returning canonical E.164.
   `triggerNotification` uses them instead of reaching into `profiles`.
2. **WhatsApp is the only channel that reaches an owner-managed tenant** — they
   have no app, and often no email. `config.reminder_whatsapp` defaults to
   `false` per hostel, which would silently mean "no messages at all" for
   exactly the tenants who need them most. Adopting a tenant must therefore
   surface this to the owner rather than failing quietly.
3. **Escalation must not advance on channels that reached nobody.** Today the
   in-app channel writes a `reminder_logs` row unconditionally, and escalation
   reads those rows: `DUE_SOON → WARNING → FINAL_NOTICE`, never repeating a
   type, terminal after `FINAL_NOTICE`. An owner-managed tenant would burn the
   entire ladder without a single message arriving, then go permanently silent,
   while the owner sees "final notice sent" against someone never contacted.
   In-app must count as `skipped: true, reason: "NO_TENANT_ACCOUNT"` for
   `OWNER_MANAGED` tenants, and escalation must key on a reminder that actually
   reached a channel.
4. Every message to an owner-managed tenant carries a **claim link**, making
   each reminder a zero-pressure invitation to self-serve.

Receiving a WhatsApp message is not "using a platform" — this is the one form of
reach that works for a tenant who will never install anything.

## 9. Owner UX

The governing principle: **nothing in the owner's workflow may ever be gated on
tenant action.** An owner-managed tenant must read as a *full* tenant, never a
degraded one.

**Adopt moment.** `InvitedTenantProfileView` already answers "has the tenant
acted on it?". When an invite is stale, surface a calm, non-punitive prompt —
"Rakesh hasn't opened this in 12 days. You can keep his records yourself and
invite him again anytime." One tap. Labelled **"Keep records myself"**, never
"Activate".

**One wizard, two exits.** `InviteTenantWizard` currently ends in "Send invite".
It gains a second terminal action on the same final step: **"Just add to my
records"**. Same collected data, different ending — owners should never have to
choose the mode *before* entering data. Email becomes optional on this path;
phone and name are required.

**Lists.** `TenantRow` shows a quiet marker (e.g. "Not on app") via the existing
`StatusPill` / `HostelRelationshipBadge` idiom — informational, not a warning
colour. Critically, owner-managed tenants **must disappear from
`usePendingActivations`** and any "waiting on tenant" work queue. Remaining in
the nag list is precisely the interruption being removed.

**Daily loop — unchanged.** Once `ACTIVE`, owner-managed tenants simply appear in
`QuickCollectModal`'s search and in `TenantActionsSheet`. Recording a UPI or cash
payment needs **no new UI at all**.

**WhatsApp without a login.** Receiving a message is not "using a platform".
Reminders now fire because `reminder-service`'s `ACTIVE` gate passes, and
receipts deliver via the existing `whatsAppTemplateDeliveryService`. Messages to
owner-managed tenants must carry a claim link, making every reminder a soft,
zero-pressure invitation to self-serve.

## 10. Delivery phases

Both halves were explicitly requested and both ship; they sequence cleanly
because Phase 1 has no dependency on Phase 2.

**Phase 1 — the owner manages, and the tenant still hears from us.** The
`access_mode` / `display_name` migration, `resolveTenantName` and
`resolveTenantPhone`, the canonical backend phone normalizer, the extracted
reservation→allocation helper, Adopt and Add-directly, the conditional
invariants, the owner UX in §9, **and all of §8**. At the end of this phase an
ignored invite can be adopted; rent, occupancy and analytics become correct;
and automated WhatsApp reminders reach a tenant who never activated.

§8 is in Phase 1 deliberately. Splitting it out would ship a state where
reminders appear to fire, log as sent, escalate to final notice and stop — with
nothing having reached the tenant. That is worse than not sending at all,
because it looks like it worked.

**Phase 2 — the tenant can continue.** OTP-gated claim, the confirmation card,
the multi-match picker, marketplace-profile reuse, Revoke, and owner
notification. The claim link embedded in Phase 1's messages activates here.

The Phase 1 migration carries the outage risk noted in §4 and must be applied
before the declaring code ships, in its own deploy step.

## 11. Testing

Per the repo's constraints: `apps/frontend` tests are node-environment only, so
decision logic goes in pure `.ts` with colocated `.test.ts` and components stay
thin renderers. `apps/backend` pure tests must be added to
`vitest.pure.config.ts`'s explicit include allowlist or they silently never run.

- Pure: transition state machine (legal/illegal transitions per axis pair)
- Pure: `resolveTenantName` fallback order
- Pure: phone normalizer parity between backend and `shared/lib/phone.ts`
- Integration: adopt generates obligations on the next rent run
- Integration: adopt counts toward room capacity and analytics
- Integration: claim preserves obligations, payments and receipts on the same row
- Integration: claim without OTP is refused
- Integration: stale invite link after adopt routes to claim, not to an error
- Pure: `resolveTenantPhone` fallback order, canonical output
- Integration: an adopted tenant with no profile receives a WhatsApp reminder
- Integration: in-app is skipped (not logged as sent) for `OWNER_MANAGED`
- Integration: escalation does not advance when no channel actually delivered
- Invariant scripts extended per §5

## 12. Documentation

Same-change updates required: [[Database]] (new columns, enum, attestation
table), [[APIs]] (adopt / revoke / claim endpoints), [[Business-Rules]] (the two
axes, the OTP rule, the attestation-is-not-consent rule), [[Features]],
[[Changelog]], and a new ADR in [[Decisions]] recording the access-mode split and
why owner attestation is deliberately not a `TenantPolicyAcceptance`.
