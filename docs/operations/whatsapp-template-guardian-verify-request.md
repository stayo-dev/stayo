# Template: `guardian_invitation`

> **Status, 2026-09-16:** submitted and **PENDING** Meta review, as `guardian_invitation` —
> *not* the `stayo_guardian_verify_request` this document originally proposed. Meta does not allow
> renaming a template, so the code's default was changed to match reality rather than the
> convention. What is actually live differs from the draft below in three ways, all harmless:
> **no header**, **no footer**, and a **12-hour** delivery validity. The body variables and the
> quick-reply text are exactly as specified, which is all the code depends on.
>
> A PENDING template **cannot be sent**, so the feature stays on the OTP fallback until it is
> APPROVED *and* `WHATSAPP_GUARDIAN_VERIFY_TEMPLATE` is set.


The message that removes the code relay from guardian verification (ADR-212, `docs/obsidian/Decisions.md`).
Submit this in WhatsApp Manager → Manage templates → Create template, or with the API call at the
bottom. Until it is **APPROVED and the env vars are set**, the code falls back to the existing OTP
relay — nothing breaks, the friction just stays.

## What to enter in WhatsApp Manager

| Field | Value |
|---|---|
| **Name** | `guardian_invitation` (as submitted) |
| **Category** | **Utility** — not Marketing. It is a confirmation request about an existing relationship the tenant asserted, not a promotion. Marketing would also make it opt-out-able and more expensive. |
| **Language** | English (`en`) |

**Header** — Text:

```
Confirm your ward
```

**Body** (three variables, in this order):

```
Hello {{1}}, {{2}} has listed you as their parent/guardian for their stay at {{3}} on Stayo. Please confirm so we can keep you updated about their stay, rent and safety.

If you do not know this person, please ignore this message.
```

**Sample values** Meta asks for: `{{1}}` = `Lakshmi`, `{{2}}` = `Aarav`, `{{3}}` = `Sunrise Residency`

**Footer**:

```
Stayo Property Management
```

**Buttons** → Quick reply, one button:

```
Yes, I confirm
```

## Three things not to change without changing the code

1. **`{{2}}` is a bare first name, never a possessive.** The body supplies its own framing ("has
   listed you as their parent/guardian"), so "Aarav's has listed you" is the failure mode.
   `buildGuardianVerifyRequestPayload` strips a trailing `'s` via `tenantDisplayName()`; the
   template must not add one back.

2. **The ignore line stays.** This is the one message Stayo sends to someone who has never heard of
   Stayo, about a claim somebody else made about them. A person named by mistake — or by a stranger
   who mistyped a digit — has to be able to do nothing and have that be the right answer. Nothing
   escalates on silence.

3. **The button stays a quick reply with exactly this text.** A tap arrives as an inbound
   `type: "button"` webhook, which `extractMessageEvents` converts into a *text* event and resolves
   through the ordinary command vocabulary. `isGuardianConfirmReply()` matches on letters only, so
   it accepts both the dynamic payload `ConfirmWard` and the button's own text
   (`Yes, I confirm` → `yesiconfirm`). Changing the wording breaks the second path; a URL or
   call button breaks both.

## After approval — nothing to do

**No environment variable is required.** The template name is hardcoded
(`guardian_invitation`), per ADR-196: a template's name and parameter vector are code, not
configuration.

While the template is PENDING, Meta rejects sends with error `132001` and the code falls back
to the OTP relay — the path every tenant uses today. The moment Meta approves it, the next send
succeeds. **No variable to set, no deploy, nothing to remember.**

`WHATSAPP_GUARDIAN_VERIFY_TEMPLATE` still exists as an *override*, for pointing at a `_v2`
during a copy revision without a deploy. Leaving it unset is the normal case.

Note that the fallback is deliberately narrow: only `132001` (name/translation missing),
`132015` (paused) and `132016` (disabled) count. A network blip or a rate limit is **not**
treated as unavailability — doing so would push every tenant onto the code relay the first time
WhatsApp had a bad minute, and never put them back.

## Creating it via the API instead

`WHATSAPP_BUSINESS_ACCOUNT_ID` and `WHATSAPP_ACCESS_TOKEN` come from the root `.env`. This
**submits for Meta review** — it is not reversible by deleting locally, and review usually takes
minutes to a day.

```bash
curl -X POST "https://graph.facebook.com/v21.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "stayo_guardian_verify_request",
    "language": "en",
    "category": "UTILITY",
    "components": [
      { "type": "HEADER", "format": "TEXT", "text": "Confirm your ward" },
      {
        "type": "BODY",
        "text": "Hello {{1}}, {{2}} has listed you as their parent/guardian for their stay at {{3}} on Stayo. Please confirm so we can keep you updated about their stay, rent and safety.\n\nIf you do not know this person, please ignore this message.",
        "example": { "body_text": [["Lakshmi", "Aarav", "Sunrise Residency"]] }
      },
      { "type": "FOOTER", "text": "Stayo Property Management" },
      { "type": "BUTTONS", "buttons": [ { "type": "QUICK_REPLY", "text": "Yes, I confirm" } ] }
    ]
  }'
```

Check status with:

```bash
curl -s "https://graph.facebook.com/v21.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?fields=name,status,category&limit=100" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" | grep -o 'stayo_guardian[^}]*'
```

## Related

Contract module: `apps/backend/lib/services/notifications/providers/whatsapp/guardian-verify-request-template-contract.ts`
(a template's name and parameter vector are code, not configuration — ADR-196).
Sender: `lib/services/notifications/command-center/guardian-verify-request.ts`.
