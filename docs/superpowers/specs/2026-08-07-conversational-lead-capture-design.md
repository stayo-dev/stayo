# Conversational lead capture — qualify first, Google last

**Date:** 2026-08-07
**Branch:** `dev`
**Status:** design approved, implementing

## 1. Problem

The landing-page owner flow opens with **"Continue with Google"**. A prospect who is
not ready to hand over a Google identity — which on a first visit is most of them —
bounces, and we capture nothing at all. The flow also asks nothing about the
business, so an admin reviewing a lead knows only the hostel's name and a phone
number.

Invert it: hold a short conversation, capture the lead at the phone step, and offer
Google **last** as optional enrichment. A prospect who never touches Google is still
a lead.

## 2. What the current code actually gates on

Verified in `lib/services/auth/signup-phone-verification-gate.ts`:

- `POST /api/leads/self-serve` requires a **fresh (30 min) phone-OTP attempt** for that
  number, with status `VERIFIED` **or** `SKIPPED` (the latter is written when WhatsApp
  cannot deliver — see `phone-verification-mode.ts`). The difference is recorded in
  `platform_leads.phone_verified`, not enforced.
- **Google is a frontend-only anti-spam step.** `google_email` is nullable and is
  asserted by the client, never verified server-side.

So moving Google to the end requires **no change to the security model**. This is the
key finding: the goal is reachable without weakening anything.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | The lead row is written **at the phone step**, before Google | Preserves the existing anti-spam gate. A lead with no phone is not actionable — the admin's whole workflow (call, WhatsApp, approve → send activation link) needs one, so a phone-less "lead" would be noise in the console. |
| D2 | Ask **three** questions only — hostel name, owner name, phone | Reversed mid-implementation. The first draft also asked city, bed count, pain point and current tooling: useful to sales, but seven screens is a wall, and every extra screen is another place to abandon. Only the fields an admin cannot act without were kept. The `pain_point`/`current_tooling` columns were already created and applied, and are left in place, nullable and unpopulated, rather than dropped from a production table — the same state `city`/`bed_count` were already in. |
| D3 | Google is offered **after** the lead is saved, as enrichment, and is skippable | The screen must make clear the enquiry is already in — skipping must not read as failure. |
| D4 | Google enrichment attaches to the lead via its **`tracking_token`** | The token is already a bearer secret delivered to this same person, and it avoids inventing a second identifier. Survives the OAuth redirect via `sessionStorage`. |
| D5 | `google_email` stays **client-asserted**, as today | Consistent with the existing flow; it is a contact detail, not a credential. Tightening it is a separate decision, not a regression introduced here. |

## 4. Flow

```
Landing CTA / scroll prompt
  └─► Conversation (one question per screen, back button, progress bar)
        1. What's your hostel called?       → hostel_name
        2. And your name?                   → name
        3. Best number to reach you on?     → phone
             └─ OTP  ─────────────────────► LEAD SAVED (google_email = null)
        4. "Add my email with Google"  ── skip ──► done, still a lead
             └─ Supabase OAuth → /lead-signup/callback
                  → reads pending tracking_token from sessionStorage
                  → POST /api/leads/track/:token/link-email  { google_email }
```

The hostel comes first because it is the easiest, most flattering thing to answer;
the phone comes last so an early exit costs the visitor nothing.

## 5. Schema

```prisma
model platform_leads {
  ...
  /// Qualification answers from the conversational capture flow. Free-form
  /// strings rather than enums: the option lists are marketing copy and will
  /// be reworded without a migration.
  pain_point        String?
  current_tooling   String?
}
```

Migration `20260807000000_platform_leads_qualification`, additive and nullable — no
backfill needed.

## 6. API

| Route | Change |
|---|---|
| `POST /api/leads/self-serve` | Validator widened to accept `pain_point`/`current_tooling`, though the shipped 3-question flow sends neither. Gate unchanged. |
| `POST /api/leads/track/[token]/link-email` | **NEW**, public, token-gated. Sets `google_email` on that lead only if it is currently null, so a leaked link cannot overwrite a captured address. |

## 7. Frontend

- `features/owner-onboarding/leadConversation.ts` — **pure**: step order, per-step
  validation, progress, and which step comes next. Unit-tested (node env, no jsdom).
- `components/HostelLeadModal.tsx` — rewritten as the conversation shell over that
  module. One question per screen, Back, progress indicator.
- `LandingPage.openOwnerAuth()` — opens the conversation directly instead of
  `GoogleSignInModal`. The returning-owner shortcut is unchanged.
- `LeadSignupCallbackPage.tsx` — after OAuth, links the email to the pending lead
  instead of opening the capture modal.

## 8. Known limitations

- A prospect who abandons **before** the phone step is not captured. Accepted under
  D1: such a row would be unreachable by every admin action.
- `google_email` remains client-asserted (D5).
- `pain_point` and `current_tooling` exist as columns but nothing writes them, since
  the flow was cut to three questions (D2). They are left in place rather than
  dropped from a production table; a future qualification pass can populate them
  without another migration.
- Verified end to end against the live database on 2026-08-07: three questions →
  OTP → `POST /leads/self-serve` returned 201 with a tracking token, and
  `GET /leads/track/:token` returned the correct stage. The test row was deleted
  afterwards. The Google-enrichment round-trip was **not** exercised — it needs a
  real Google account.
