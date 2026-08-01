# WhatsApp template mapping — decided 2026-08-01

**Status: the invitation half is IMPLEMENTED and verified with a real send.**
The onboarding-complete half is still open — see the bottom of this file.

## Decided mapping

| Flow | Code constant / env | Template to use | Status in WABA |
|---|---|---|---|
| Tenant invitation ("activate your account") | `WHATSAPP_INVITATION_TEMPLATE` | **`stayo_tenant_invitation`** | Active · Quality pending |
| Tenant onboarding complete ("admission confirmed") | `ONBOARDING_COMPLETED_TEMPLATE_NAME` (`providers/whatsapp/templates.ts:118`, currently `"tenant_onboarding_completed_v1"`) | **`stayo_tenant_onboarding_complete"`** | Active · Quality pending |
| ~~Account activated~~ | — | **Not needed** — do not create `stayo_tenant_account_activated` | n/a |

## Mismatches — invitation: FIXED · onboarding-complete: still open

### 1. Invitation body parameter count — **will fail with Meta #132000**

`lib/services/notifications/providers/whatsapp/meta-provider.ts:637` sends **4**
body parameters for any template name that isn't `tenant_account_activation_v1`:

```
[ tenantName, ownerName, roomNumber, roomRent ]
```

`stayo_tenant_invitation` declares **2** body variables:

```
{{1}} = tenant name      (sample: "Shiva")
{{2}} = hostel name      (sample: "Delux Hostel")
```

Body copy: *"Hello {{1}}, you have been invited to join {{2}} on Stayo. Your room
has been assigned and your account is ready to activate. This invitation expires
in 48 hours."*

A 4-param payload against a 2-variable template is rejected with Meta `#132000`
— the same error `bd3d1e9` documents for the OTP template.

**Fix:** send exactly `[tenantName, hostelName]` for this template. Note the
current code has no `hostelName` in scope at that call site — `sendInvitation`'s
input has `hostelName`, so it is available, just unused in the params array.

### 2. Invitation language code — **will fail with Meta #132001**

Template was created as **English** (`en`). `invitationTemplateLanguage()`
(`meta-provider.ts:126-130`) defaults to **`en_IN`**. These are distinct
templates to Meta.

**Fix:** set `WHATSAPP_INVITATION_LANGUAGE=en`, or change the default.

### 3. Button parameter — already correct

Button is a dynamic URL `https://yourstayo.com/activate/{{1}}` taking the
activation token. Code already sends exactly that
(`extractActivationToken(input.activationLink)`). No change.

### 4. Onboarding-complete template — parameter count unverified

`stayo_tenant_onboarding_complete` body preview:

> Hello Shiva, your admission at delux hostel is complete.
> Room: G4.
> Joining Date: 21/06/2025.
> Monthly Rent: 8500.
> Rent is due on the 7th of every month.
> Type BAL anytime to check your payment status.

That reads as up to **6** variables (name, hostel, room, joining date, rent,
due day). **Verify against the live Graph API before coding** —
`GET /{WABA_ID}/message_templates?name=stayo_tenant_onboarding_complete` — the
same way `bd3d1e9` verified the OTP template rather than assuming. Then check
what `whatsapp-onboarding-handler.ts` currently supplies and reconcile.

Button is `Open Dashboard` (URL) — confirm whether it is static or dynamic; if
dynamic it needs a button parameter the handler must supply.

## Structural fix to do at the same time

`meta-provider.ts:637` currently branches on a template *name*
(`templateName === "tenant_account_activation_v1" ? 3 params : 4 params`). With
a third template name now in play this is exactly the drift trap that produced
the OTP incident.

Replace it with a **declared contract** in the style of `OTP_TEMPLATE_CONTRACT`
(see `bd3d1e9`): parameter meanings declared once, counts checked against the
live template by a `check:whatsapp-template`-style deploy gate, throwing a
descriptive error naming the template and what changed. Drift should fail at
deploy, not silently at send time.

## Env vars to set

```
WHATSAPP_INVITATION_TEMPLATE=stayo_tenant_invitation
WHATSAPP_INVITATION_LANGUAGE=en
```

Both need setting in **Vercel** — note `docs/obsidian/Changelog.md` (2026-08-01)
records that `api.yourstayo.com` is served by Vercel, not the Render service
`render.yaml` describes.

## Why this matters now

Task 2 made the invite wizard tell the truth about delivery failure — it now
shows the activation link and an email fallback when WhatsApp fails. With these
two templates mismatched, **every** invitation takes that failure path. Fixing
this is what makes real WhatsApp delivery work end to end.

## Acceptance

- Real invitation delivered to a real handset from the owner Invite wizard
- Invite success screen shows the WhatsApp-delivered state (not the fallback)
- Onboarding-complete message delivered on real activation
- Template drift fails a deploy check rather than a send
- No silent failures


---

## Implementation record — invitation (done)

Live Graph API inventory taken 2026-08-01 (all APPROVED):

```
stayo_tenant_invitation             en     body=2 btn=1   <- invitation
stayo_tenant_onboarding_complete    en     body=6 btn=0   <- still to wire
stayo_tenant_account_activated      en_IN  body=2 btn=0   <- not needed
otp                                 en_US  body=2 btn=1   <- already wired
```

New `lib/services/notifications/providers/whatsapp/invitation-template-contract.ts`
declares the parameter meanings once, builds the payload, and asserts the live
template still matches. `npm run check:whatsapp-template` now gates **both**
templates. Verified live:

```
OK  WhatsApp OTP template "otp" matches the payload contract (body: 2, button: 1)
OK  WhatsApp invitation template "stayo_tenant_invitation" matches the payload contract (body: 2, button: 1)
```

**Real send confirmed** to +91 8008046952 through `MetaWhatsAppProvider.sendInvitation`
(not a raw curl), first attempt, no retries:
`wamid.HBgMOTE4MDA4MDQ2OTUyFQIAERgSNzlGNUYyODg4QkJCOTQ3Q0YyAA==`

Retired names (`hms_tenant_invite_v2`, `tenant_account_activation_v1/v2`) are
now actively ignored if still set in a deployed environment, rather than passed
through to Meta as a template that does not exist.

## Still open: onboarding-complete

`ONBOARDING_COMPLETED_TEMPLATE_NAME` (`providers/whatsapp/templates.ts:118`) is
still `"tenant_onboarding_completed_v1"` — **a template that does not exist in
this WABA**, so the post-activation message currently fails every time.

The approved replacement is `stayo_tenant_onboarding_complete` (`en`, **6 body
parameters**, no button). Wiring it needs the six parameters identified in order
from the live BODY text and reconciled with what `whatsapp-onboarding-handler.ts`
supplies. Not done here — out of scope for the invitation fix.
