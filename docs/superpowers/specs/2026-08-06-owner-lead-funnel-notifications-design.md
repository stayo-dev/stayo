# Owner lead funnel — notifications + enquiry status tracking

**Date:** 2026-08-06
**Branch:** `feat/owner-lead-funnel-notifications`
**Status:** design approved, ready for planning

## 1. Problem

The owner-acquisition funnel runs end to end today — landing CTA → Google + phone OTP lead
capture → admin review → approval → activation link → prefilled onboarding → auto-progressing
lead status. What it does not do is **talk to the prospective owner**. A person who submits an
enquiry receives nothing, can see nothing, and learns the outcome only if an admin happens to
call them.

This design adds four WhatsApp touchpoints and one public status-tracking surface. It does not
rebuild the funnel.

## 2. Audit — what already exists

Verified by reading the live code on 2026-08-06. **None of the following is to be rebuilt.**

| Capability | Location |
|---|---|
| `platform_leads`, `platform_lead_invitations`, `PlatformLeadStatus` (`NEW → UNDER_REVIEW → APPROVED → INVITE_SENT → OWNER_ACTIVATED → HOSTEL_CREATED → LIVE`, or `LOST`) | `prisma/schema.prisma` |
| Landing CTA → real Google → `/lead-signup/callback` → `HostelLeadModal` (details + phone OTP) → lead row | `LandingPage.tsx:99`, `app/api/leads/self-serve/route.ts` |
| Admin console: list, detail drawer with event timeline, private `notes`, status PATCH restricted to `NEW`/`UNDER_REVIEW`/`LOST` | `AdminLeadsPage.tsx`, `app/api/platform-admin/leads/[id]/route.ts` |
| Approve → single-use token, 7-day expiry, WhatsApp send with email fallback, status advances only on successful delivery | `src/services/platform-leads/lead-invitation-service.ts:42` |
| `/owner-invite/:token` → prefilled onboarding → owner-signup with `lead_token` → `OWNER_ACTIVATED` | `app/api/leads/invitation/[token]/route.ts`, `app/api/auth/owner-signup/route.ts:72` |
| Auto-progression to `HOSTEL_CREATED` (`markHostelCreated`) and `LIVE` (`markLive`) | `lead-invitation-service.ts:182-203` |
| `stayo_owner_welcome` — Meta-APPROVED, fires after owner signup | `owner-welcome-template-contract.ts` |
| Per-lead event timeline (`systemEventLog`, `lead_id` inside `metadata`) | `platform-admin/leads/[id]/route.ts` |

### Gaps this design closes

1. `/api/leads/self-serve` creates the row and logs an event. **No acknowledgement is sent.**
2. **No status-tracking surface exists** — no route, no endpoint, no page. Fully greenfield.
3. **Rejection is silent.** A PATCH to `LOST` notifies nobody.
4. **`markLive()` only writes a log row** — nothing tells the owner their hostel is live.
5. The landing popup is **click-triggered**, not exploration-triggered.
6. The activation send defaults to `owner_lead_activation_v1`, **a placeholder that was never
   created in Meta** — which is why WhatsApp delivery on approval has never worked in any
   environment. Its param shape (`[owner_name, hostel_name]`) also differs from the intended
   template.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Status access via **secret tracking token** in the URL — `/enquiry/:token`, no auth | A prospective owner has no account. Mirrors the proven `/owner-invite/:token` pattern. Rejected phone+OTP (an OTP send per status check) and Google re-auth (`google_email` is nullable, so some leads would be untrackable). |
| D2 | Owner sees a **stage timeline + a separate `applicant_message`** field | Existing `notes` is an admin scratchpad ("bed count looks inflated, verify before approving"). Exposing it would leak internal assessment. One nullable column keeps the two audiences apart by construction rather than by discipline. |
| D3 | Popup fires at **40% scroll depth**, and "Yes" opens the **existing** `GoogleSignInModal` | Scroll depth proves genuine interest without interrupting a reader, and works reliably on mobile (unlike exit-intent). Reusing the existing modal means zero duplicate capture logic. |
| D4 | Build **all five** templates in the user's spec, including `stayo_owner_account_activated` | Consistent naming across the whole funnel. Cost: one extra Meta review, and `stayo_owner_welcome` is left approved-but-orphaned. |
| D5 | Rejection is an **explicit `POST .../reject` action requiring a reason**; plain PATCH to `LOST` stays silent | `LOST` is used for both "we declined" and "went cold". Auto-notifying every `LOST` would send "we are unable to proceed with your application" to someone who simply stopped replying. Symmetric with the existing `POST .../approve`. |
| D6 | All template URLs on **`https://yourstayo.com`** | Matches `lib/config/domains.ts`'s `PRODUCTION_FRONTEND_URL`. The drafts' `stayo.in`/`app.stayo.in` are not configured hosts, and `app.stayo.in/dashboard` maps to no route in this SPA. Meta bakes button URLs at approval, so a wrong host means resubmitting. |

## 4. Flow

```
Landing page, visitor scrolls past 40%
  └─► OwnerEnquiryPrompt  "Are you a hostel owner?"
        └─ Yes ─► GoogleSignInModal (existing)
                    └─► /lead-signup/callback (existing)
                          └─► HostelLeadModal — details + phone OTP (existing)
                                └─► POST /api/leads/self-serve
                                      ├─ creates platform_leads (NEW) + tracking_token
                                      └─► ① stayo_owner_lead_received  [non-blocking]

Admin /admin/leads
  ├─► POST /api/platform-admin/leads/[id]/approve   (exists)
  │     └─► ② stayo_owner_invitation
  └─► POST /api/platform-admin/leads/[id]/reject    (NEW)
        └─ status LOST + rejection_reason
        └─► ⑤ stayo_owner_lead_rejected

/owner-invite/:token → /onboarding → POST /api/auth/owner-signup
  └─ OWNER_ACTIVATED ─► ③ stayo_owner_account_activated  [non-blocking]
        └─ hostel created → HOSTEL_CREATED
              └─ publish complete → markLive() → LIVE
                    └─► ④ stayo_owner_onboarding_complete  [non-blocking]

At any point, from any device:
  GET /enquiry/:tracking_token  →  stage timeline + applicant_message
```

## 5. Schema

```prisma
model platform_leads {
  ...
  tracking_token    String   @unique   // 32-byte hex, minted at row creation
  applicant_message String?            // admin-authored, owner-visible
  rejection_reason  String?            // set only by the reject action
  // notes          String?            // UNCHANGED — stays admin-private
}
```

No new tables. `platform_lead_invitations` continues to own activation tokens; the two token
kinds have different lifetimes (tracking never expires, activation expires in 7 days) and
different audiences, so merging them would couple unrelated concerns.

**Migration:** add the three columns nullable, backfill `tracking_token` for existing rows with
`encode(gen_random_bytes(32), 'hex')`, then apply the `UNIQUE` constraint. `tracking_token`
becomes `NOT NULL` only after the backfill verifies zero nulls.

## 6. Notification layer

New service `src/services/platform-leads/platform-lead-notification-service.ts` owns all five
sends. `lead-invitation-service`'s private `dispatchActivationNotification()` moves into it, so
one module knows the delivery policy: **WhatsApp first, email fallback, never throw into the
caller's critical path.**

Each template gets a contract file under
`lib/services/notifications/providers/whatsapp/`, following the existing
`owner-welcome-template-contract.ts` pattern exactly: declared `bodyParameters` /
`buttonParameters` arrays, a **pure** payload builder, and env-var name/language overrides.

| # | Template | Body params | Button | Fires from |
|---|---|---|---|---|
| ① | `stayo_owner_lead_received` | `[name]` | dynamic URL, `tracking_token` | `/api/leads/self-serve` |
| ② | `stayo_owner_invitation` | `[name, expiry_days]` | dynamic URL, activation token + phone | `approveLead()` |
| ③ | `stayo_owner_account_activated` | `[name]` | static URL | owner-signup |
| ④ | `stayo_owner_onboarding_complete` | `[name, hostel_name]` | static URL + phone | `markLive()` |
| ⑤ | `stayo_owner_lead_rejected` | `[name, reason]` | phone only | `POST .../reject` |

### Error handling

Sends ①③④⑤ are **fire-and-forget**: a provider failure is logged with the template name and
swallowed. A WhatsApp outage must never block lead creation, account activation, or a hostel
going live.

Send ② keeps its **existing, deliberate** behaviour: if neither WhatsApp nor email succeeds, the
lead is left at `APPROVED` rather than advancing to `INVITE_SENT`, so the admin sees the failure
and can retry. This is the one case where delivery is load-bearing — nobody can activate an
account they were never sent a link to.

## 7. Meta template reference

Both tokens are `crypto.randomBytes(32).toString("hex")` → 64 hex characters. Meta requires
dynamic URL variables at the **end** of the URL; all of ours comply. Body and button variables
are numbered independently.

| # | Template | Meta URL field | Buttons |
|---|---|---|---|
| ① | `stayo_owner_lead_received` | `https://yourstayo.com/enquiry/{{1}}` (dynamic) | `Track Status` |
| ② | `stayo_owner_invitation` | `https://yourstayo.com/owner-invite/{{1}}` (dynamic) | `Activate Account`, `Call Us` |
| ③ | `stayo_owner_account_activated` | `https://yourstayo.com/onboarding` (static) | `Setup Hostel` |
| ④ | `stayo_owner_onboarding_complete` | `https://yourstayo.com/owner/home` (static) | `Open Dashboard`, `Call Us` |
| ⑤ | `stayo_owner_lead_rejected` | — | `Contact Us` (phone) |

`/owner-invite/:token` is already a live route. `/enquiry/:token` ships with this work.
`/owner/home` is the real dashboard route — `/dashboard` does not exist in this SPA and would
404.

**Expiry wording (②):** `DEFAULT_INVITE_DAYS = 7`, so the body reads *"This link expires in
{{2}} days"* and receives `7`. The original draft's "{{2}} hours / 48" would have to render as
`168`, which reads poorly.

All template names are overridable at runtime via env vars
(`WHATSAPP_OWNER_LEAD_RECEIVED_TEMPLATE`, `WHATSAPP_OWNER_INVITATION_TEMPLATE`, etc.), so a
Meta-forced rename during review is a config change, not a redeploy.

## 8. API surface

| Route | Change |
|---|---|
| `POST /api/leads/self-serve` | + non-blocking ① send after row creation |
| `GET /api/leads/track/:token` | **NEW**, public. Returns stage timeline + `applicant_message`. Never returns `notes`, the row `id`, or raw enum values. |
| `POST /api/platform-admin/leads/[id]/reject` | **NEW**, admin-only. Requires a non-empty `reason`. Sets `LOST` + `rejection_reason`, sends ⑤. Returns 400 for a lead whose status is already `APPROVED` or beyond — once an activation link is out, declining is not a status write. |
| `PATCH /api/platform-admin/leads/[id]` | + accepts `applicant_message`. Status allowlist unchanged. |

### Owner-facing stage mapping

The tracking endpoint maps internal status to a display stage so `INVITE_SENT` never leaks:

| Internal | Owner sees |
|---|---|
| `NEW` | Submitted |
| `UNDER_REVIEW` | Under review |
| `APPROVED`, `INVITE_SENT` | Approved — activation link sent |
| `OWNER_ACTIVATED`, `HOSTEL_CREATED` | Setting up your hostel |
| `LIVE` | Live on Stayo |
| `LOST` | Not proceeding |

## 9. Frontend

- **`OwnerEnquiryPrompt`** — scroll-depth (40%) card on `LandingPage`. `localStorage` dismissal
  with a 7-day cooldown; suppressed entirely for an authenticated owner who already has a hostel
  (the same condition `openOwnerAuth()` already checks). "Yes" calls the existing
  `openOwnerAuth()` — no duplicate capture logic.
- **`EnquiryStatusPage`** at `/enquiry/:token` — public route in `PublicRoutes.tsx`, alongside
  the existing `/owner-invite/:token`. Stage timeline + team message. Handles unknown-token with
  an honest "we couldn't find that enquiry" rather than a crash.
- **`HostelLeadModal`** — success step gains the tracking link, so the owner has it even if the
  WhatsApp never arrives.
- **`AdminLeadsPage`** — a `Reject Lead` button (reason required, mirroring the existing
  `Approve Lead`) and an applicant-message field **visibly separated** from private notes, so an
  admin cannot confuse the two.

All frontend API calls go through `@lib/api-client` per the enforced architecture check. A new
`features/hostel-leads/api` wrapper method covers the public tracking fetch.

## 10. Testing

`apps/frontend` tests are node-environment only, so pure logic is extracted and the components
stay thin renderers:

- Five payload builders — pure, one test each, covering missing/blank name fallback.
- Enum → display-stage mapper — pure, exhaustive over all eight statuses.
- Reject-transition guard — rejects an already-approved lead, requires a non-empty reason.
- Scroll-depth/cooldown decision function — pure, separated from the component.

**Backend pure tests must be added to `vitest.pure.config.ts`'s explicit include allowlist**, or
they silently never run. This has bitten this repo before.

## 11. Documentation

Per CLAUDE.md, updated in the same change:

- `docs/obsidian/Features.md` — extend the existing owner-acquisition funnel entry.
- `docs/obsidian/APIs.md` — two new routes, one modified.
- `docs/obsidian/Database.md` — three new columns.
- `docs/obsidian/Business-Rules.md` — notification triggers, the reject-vs-cold-lead rule.
- `docs/obsidian/Decisions.md` — ADR for D1 (tokenized public tracking) and D5 (explicit reject
  action), both being deliberate design choices rather than bugfixes.
- `docs/obsidian/Changelog.md` — one entry.

## 12. Known limitations, stated rather than hidden

- **Templates ①②④⑤ do not exist in Meta yet.** The code will be complete and correct, but those
  four sends will fail until the templates are approved. Contracts are built to fail loudly with
  the template name in the log, not silently. ③ replaces the approved `stayo_owner_welcome`, so
  it too is non-delivering until approved.
- **`stayo_owner_welcome` becomes orphaned** — it stays approved in Meta with no caller. Noted in
  the changelog so a future reader does not mistake it for a live sender.
- **The tracking token is a bearer secret.** Anyone with the link sees the enquiry's stage and
  team message. This is the accepted trade-off of D1, and is why `notes` is never exposed there.
- **The `RESEND_API_KEY` in the dev environment is invalid**, so the email fallback also fails
  there. That is a pre-existing environment gap, not introduced here.
