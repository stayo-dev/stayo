# Stayo — Owner Journey Checklist

**Date:** 2026-08-01 · Companion to the [Product Integration Audit](./2026-08-01-owner-product-integration-audit.md) and [API Coverage Matrix](./2026-08-01-api-coverage-matrix.md)

A linear, manual verification script for the complete owner product. Run it after every implementation slice.

**How to use**
- Work top to bottom in one sitting, as one owner, in one browser.
- A step passes only when the effect is visible **in a different screen than the one you acted in**, and survives a hard reload (`Cmd/Ctrl+Shift+R`). Anything that only lives in React state does not count.
- Keep DevTools → Network open. **A step fails if the action fires no request**, no matter how convincing the toast.
- Status column: `PASS` / `FAIL` / `N/A`. Record the date and build in the header row.

**Baseline as of 2026-08-01** is pre-filled in the *Aug-01* column so you can measure movement rather than re-deriving it.
`✅ pass` · `❌ fail` · `⚠️ partial` · `🚫 not built`

---

## Phase 0 — Environment sanity

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 0.1 | `cd apps/backend && npm run dev` | starts on :3000, `/api/health` returns ok | ✅ | |
| 0.2 | `cd apps/frontend && npm run dev` | Vite starts; no missing-env throw from `api-client.ts` / `supabaseClient.ts` | ✅ | |
| 0.3 | `npm run check:architecture` (frontend) | passes | ✅ | |
| 0.4 | `npm run check:invariants` (backend) | passes | ✅ | |
| 0.5 | `npm test` (backend) | passes | — | |
| 0.6 | Confirm WhatsApp env is set, or knowingly accept the degraded path | `PHONE_VERIFICATION_MODE`, `WHATSAPP_*` | ⚠️ | |

---

## Phase 1 — Signup & onboarding

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 1.1 | Land on `/`, click an owner CTA | Google sign-in modal opens | ✅ | |
| 1.2 | Complete Google → lead modal → OTP → submit | `platform_leads` row created (`NEW`) | ✅ | |
| 1.3 | Approve that lead in `/admin/leads` | activation link delivered or error surfaced honestly | ⚠️ | |
| 1.4 | Open `/owner-invite/:token` | prefilled wizard at `/onboarding` | ✅ | |
| 1.5 | Account step: name, mobile, email, password ≥8 | account created, session live | ✅ | |
| 1.6 | Re-enter the account step after going back | **no duplicate signup / no 409 stall** | ✅ | |
| 1.7 | KYC step: upload Aadhaar | real file → ImageKit, row `PENDING`, **not** auto-verified | ✅ | |
| 1.8 | Create step: hostel name + **type** (Boys/Girls/Co-Living) | type persisted and visible later | ❌ **dropped** | |
| 1.9 | Location step: address + city | persisted | ✅ | |
| 1.10 | Details step: capacity, **food Yes/No**, **security deposit** | food + deposit persisted | ❌ **dropped** | |
| 1.11 | Floors / Rooms / Beds steps | counts carried into publish | ✅ | |
| 1.12 | Review step | matches everything entered | ✅ | |
| 1.13 | Publish step: choose **"Keep as draft"** | hostel is a draft, not live | ❌ **publishes anyway** | |
| 1.14 | Publish: watch the Network tab | **1 request, not 45** | ❌ `1+F+F×R` | |
| 1.15 | **Kill the backend mid-publish, restart, press Publish again** | resumable, or clean rollback | ❌ **unrecoverable 400** | |
| 1.16 | Land on `/owner/home` | real hostel card, real bed counts | ✅ | |
| 1.17 | Check `hostel_billing_preferences.default_security_deposit` | equals the wizard value | ❌ null | |
| 1.18 | Check `rooms.base_rent` | equals the wizard rent | ❌ null | |

---

## Phase 2 — Multi-hostel workspace

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 2.1 | Home → **"+ Add hostel"** | provisioning flow opens | 🚫 toast | |
| 2.2 | Create a second hostel | appears on Home | 🚫 | |
| 2.3 | Home shows aggregate across **both** | beds/outstanding/collected summed | ✅ | |
| 2.4 | Global hostel switcher | present in the shell | 🚫 | |
| 2.5 | `/owner/more/billing` — which hostel? | explicit picker | ❌ silently `hostels[0]` | |
| 2.6 | `/owner/more/notices` — which hostel? | explicit picker | ❌ silently `hostels[0]` | |
| 2.7 | `/owner/more/service-requests` — which hostel? | explicit picker | ❌ silently `hostels[0]` | |
| 2.8 | Tenants list → "All Hostels" | tenants from both, correctly labelled | ✅ | |
| 2.9 | Log in as a **different owner** | sees none of owner A's data | ✅ | |
| 2.10 | Hit `/api/tenants?hostelId=<owner-A-hostel>` as owner B | `403` | ✅ | |
| 2.11 | Archive / delete a hostel | possible | 🚫 | |

---

## Phase 3 — Property structure

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 3.1 | Home → tap a property card | drill-down opens | ✅ | |
| 3.2 | **Drill-down header** | real hostel name + city | ❌ **"Hostel · —"** | |
| 3.3 | Overview tab | real beds / due / collected | ✅ | |
| 3.4 | Rooms tab | real floors + rooms + occupancy dots | ✅ | |
| 3.5 | `+ Add` room | persists; survives reload | ✅ | |
| 3.6 | Add Floor with N rooms | all created | ⚠️ non-atomic loop | |
| 3.7 | Reorder: drag a room to another floor | persists after reload | ✅ | |
| 3.8 | Room sheet → **Edit room details** | rename / capacity / rent | 🚫 toast | |
| 3.9 | Delete a room | possible | 🚫 | |
| 3.10 | Rename / delete a floor | possible | 🚫 | |
| 3.11 | Room shows a real rent | not ₹0 | ❌ | |
| 3.12 | **Tenants tab of the drill-down** | the hostel's real tenants | ❌ **always empty** | |
| 3.13 | Tenants tab tiles vs Overview tab | agree | ❌ contradict | |
| 3.14 | Search a room | filters | ✅ | |

---

## Phase 4 — Tenant lifecycle (the critical journey)

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 4.1 | Tenants → `+ Invite` | wizard opens | ✅ | |
| 4.2 | Step 1: name + phone + **email** | email field exists | ❌ **no email field** | |
| 4.3 | Step 1 with an empty name → Continue | blocked with a message | ❌ advances | |
| 4.4 | Step 2: hostel → room | **only vacant** rooms listed | ✅ | |
| 4.5 | Step 3: rent / deposit / maintenance / frequency | prefilled from hostel policy | ⚠️ manual | |
| 4.6 | Step 4: confirm → Send | `POST /api/owners/invitations` | ✅ | |
| 4.7 | **Disable WhatsApp, invite again** | UI says delivery failed + shows the link | ❌ **claims success** | |
| 4.8 | Success screen offers a copyable activation link | present | ❌ discarded | |
| 4.9 | Tenant appears as `Invited` | on the list | ✅ | |
| 4.10 | DB: `tenants` + `room_allocations` + rent/deposit/maintenance obligations | all created | ✅ | |
| 4.11 | Home "Activate Tenants" count | increments | ✅ | |
| 4.12 | **Resend invitation** | available on the row | 🚫 | |
| 4.13 | **Cancel invitation** | available; frees the bed | 🚫 | |
| 4.14 | **Edit invitation** before activation | available | 🚫 | |
| 4.15 | Open the activation link → set password | account activated | ✅ | |
| 4.16 | Tenant accepts rules + signs agreement | `agreements` row `SIGNED` | ✅ | |
| 4.17 | Tenant uploads KYC docs | `PENDING` | ✅ | |
| 4.18 | Owner → Tenant Detail → Documents | docs listed with status | ✅ | |
| 4.19 | **Owner approves a document** | status → `VERIFIED` | 🚫 **no control** | |
| 4.20 | **Owner rejects with a reason** | tenant is told why | 🚫 | |
| 4.21 | **Owner uploads a doc on the tenant's behalf** | possible | 🚫 | |
| 4.22 | Home "Verify KYC" tile → tap | navigates to the pending queue | 🚫 not clickable | |
| 4.23 | Tenant status becomes `ACTIVE` | list + detail agree | ✅ | |
| 4.24 | Bed count on Home decreases | ✅ | ✅ | |
| 4.25 | Tenant Detail → header/room/joined/agreement | all real | ✅ | |
| 4.26 | Tenant Detail → **Overdue card** | shows real days | ❌ **always 0 or 1, labelled "days"** | |
| 4.27 | Charges tab → full obligation history | all, not 5 | ❌ capped at 5 | |
| 4.28 | Charges tab → **`+ Add Charge`** | creates an obligation | 🚫 **no handler** | |
| 4.29 | **Cancel an obligation** | possible | 🚫 | |
| 4.30 | **Waive an obligation** | possible | 🚫 | |
| 4.31 | **Private Notes → type + `+`** | persists; survives reload | 🚫 **no handler** | |
| 4.32 | Comm center → call / WhatsApp icons | actionable | 🚫 `<span>` | |
| 4.33 | Stay tab → **Change room** | room picker → allocation shifts | ❌ **wrong sheet** | |
| 4.34 | Stay tab → **Change rent** | password step → applies → reflected everywhere | ✅ | |
| 4.35 | Actions → **Change billing frequency** | possible | 🚫 toast | |
| 4.36 | Actions → **Share payment link** | link generated | 🚫 toast | |
| 4.37 | Actions → **View receipts** | receipts listed | 🚫 toast | |
| 4.38 | Actions → **Request change** | change-request created | 🚫 toast | |
| 4.39 | Invite a **51st** tenant to one hostel | all 51 visible | ❌ **list caps at 50** | |
| 4.40 | With >50, check the filter chip counts | accurate | ❌ | |

---

## Phase 5 — Money

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 5.1 | Money → Pulse | real collected / due / rate | ✅ | |
| 5.2 | Money → Collections | every tenant with dues | ⚠️ capped at 50 | |
| 5.3 | Collect → tenant search | real results | ✅ | |
| 5.4 | Enter a **partial** amount | live FIFO split preview | ✅ | |
| 5.5 | Enter **more than owed** | preview shows the advance/credit | ✅ | |
| 5.6 | Confirm → password step | rejects a wrong password | ✅ | |
| 5.7 | Confirm → success | `payments` row + obligation status updated | ✅ | |
| 5.8 | Home outstanding after collecting | **decreases** | ✅ | |
| 5.9 | Tenant Detail outstanding | decreases | ✅ | |
| 5.10 | Money → Collections | tenant drops off / updates | ✅ | |
| 5.11 | Hard reload | numbers hold | ✅ | |
| 5.12 | **Find the receipt for that payment** | viewable / downloadable / shareable | 🚫 **nowhere** | |
| 5.13 | **Reverse a wrong payment** | possible | 🚫 | |
| 5.14 | **Transfer a payment to the right tenant** | possible | 🚫 | |
| 5.15 | **Payment history for a tenant** | full ledger | 🚫 | |
| 5.16 | **Export payments** | CSV/XLSX | 🚫 | |
| 5.17 | **Manually generate this month's rent** | preview → generate | 🚫 cron-only | |
| 5.18 | Wait for `cron-generate-rent` | obligations appear | ✅ | |
| 5.19 | Overdue tenant appears in Collections + Home | ✅ | ✅ | |
| 5.20 | **Send a reminder manually** | possible | 🚫 | |
| 5.21 | Late fee applied per policy | via `cron-rent-reminders` | ✅ | |
| 5.22 | **Verify a submitted UPI reference** | approval queue | 🚫 | |
| 5.23 | Expenses: add / edit / delete | persists | ✅ | |
| 5.24 | Expenses: export | file downloads | ✅ | |
| 5.25 | Expense insights (category / vendor / trend) | real | ✅ | |

---

## Phase 6 — Agreements & renewals

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 6.1 | Home → **"Review Agreements"** tile → tap | opens a renewal queue | 🚫 not clickable | |
| 6.2 | Find any owner agreements screen | exists | 🚫 **no route** | |
| 6.3 | Create a renewal offer | possible | 🚫 | |
| 6.4 | Bulk renewal campaign | possible | 🚫 | |
| 6.5 | Send an offer to a tenant | possible | 🚫 | |
| 6.6 | Tenant opens `/tenant/renewal` and accepts | works tenant-side | ✅ | |
| 6.7 | Owner sees the acceptance | anywhere | 🚫 | |
| 6.8 | Edit the agreement template | possible | 🚫 | |
| 6.9 | Agreement expiry handled | `cron-agreement-lifecycle` | ✅ | |
| 6.10 | Terminate an agreement early | possible | 🚫 | |

---

## Phase 7 — Move-out

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 7.1 | Tenant Detail → Actions → **Check-out / Exit** | sheet opens | ✅ | |
| 7.2 | Submit a move-out request | `move_out_requests` row | ✅ | |
| 7.3 | Reject the request | status reverts | ✅ | |
| 7.4 | Record an inspection (damages/deductions) | persists | ✅ | |
| 7.5 | Settle | deposit netted against dues | ✅ | |
| 7.6 | Mark vacated | physical exit recorded | ✅ | |
| 7.7 | Complete | tenant → `LEFT` | ✅ | |
| 7.8 | Bed becomes vacant | Rooms tab + Home | ✅ | |
| 7.9 | Home vacancy count increases | ✅ | ✅ | |
| 7.10 | Raise a dispute | possible | 🚫 | |
| 7.11 | `cron-move-out-releases` releases the room | ✅ | ✅ | |

---

## Phase 8 — Alerts, notifications, search

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 8.1 | Home bell badge | matches the Alerts page | ❌ **different sources** | |
| 8.2 | Alerts → Leads | real leads from `/api/leads` | ❌ mock | |
| 8.3 | Alerts → Renewals | real renewal queue | ❌ mock | |
| 8.4 | Alerts → Requests | real service requests | ❌ mock | |
| 8.5 | Alerts → Admin | real notifications | ❌ mock | |
| 8.6 | Mark one read, hard reload | stays read | ❌ resets | |
| 8.7 | Act on an alert | performs the action | 🚫 toast | |
| 8.8 | **Convert a lead into a tenant invitation** | possible | 🚫 | |
| 8.9 | Home search bar → type | it is an input | ❌ **`<span>`** | |
| 8.10 | Search a tenant by name/phone globally | results across hostels | 🚫 | |
| 8.11 | Search a room globally | results | 🚫 | |
| 8.12 | Tenants list search | filters (within the loaded 50) | ⚠️ | |

---

## Phase 9 — Configuration

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 9.1 | More → Workspace Configuration | real checklist + % | ✅ | |
| 9.2 | More → Settings → Hostel identity | edit + save | ✅ | |
| 9.3 | More → Settings → Rent and billing | late fee toggle + amount saves | ⚠️ flat rule, primary hostel | |
| 9.4 | More → Settings → **Tenant defaults** | edit defaults | 🚫 toast | |
| 9.5 | More → Settings → Notices | create/delete announcements + events | ✅ | |
| 9.6 | More → Settings → Service Requests | assign / progress / resolve / reject | ✅ | |
| 9.7 | More → My profile | edit + save | ✅ | |
| 9.8 | **More header shows YOUR name/email** | real | ❌ **hardcoded mock** | |
| 9.9 | More → Agreements row | opens agreements | 🚫 toast | |
| 9.10 | More → Properties row | opens property management | 🚫 toast | |
| 9.11 | `/owner/config/finance` | real screen | 🚫 "Not built yet" | |
| 9.12 | `/owner/config/agreements` (+ templates, clauses) | real screens | 🚫 ×3 | |
| 9.13 | `/owner/config/automation` | real screen | 🚫 | |
| 9.14 | `/owner/config/notifications` | real screen | 🚫 | |
| 9.15 | `/owner/config/account` (team / roles) | real screen | 🚫 | |
| 9.16 | About → Privacy Policy | opens `/legal/privacy` | 🚫 toast (**page exists**) | |
| 9.17 | About → Terms | opens `/legal/terms` | 🚫 toast (**page exists**) | |
| 9.18 | Help → contact actions | open WhatsApp / mail / call | 🚫 ×3 | |
| 9.19 | Sign out | session revoked; back button cannot re-enter | ✅ | |

---

## Phase 10 — Resilience (run last, on every build)

| # | Step | Expected | Aug-01 | Now |
|---|---|---|---|---|
| 10.1 | DevTools → block `/api/owner/portfolio/summary`, reload Home | **error + retry**, not ₹0 | ❌ **shows ₹0** | |
| 10.2 | Block `/api/tenants`, open Tenants | error + retry | ❌ empty list | |
| 10.3 | Block `/api/expenses`, open Money | error + retry | ❌ zeros | |
| 10.4 | Go offline, tap Collect | clear offline message | ❌ | |
| 10.5 | Brand-new owner, zero hostels | useful empty state, not a blank Home | ❌ | |
| 10.6 | Hostel with zero tenants | empty state with a CTA | ✅ | |
| 10.7 | Hostel with zero rooms | empty state with a CTA | ✅ | |
| 10.8 | Double-tap "Send invitation" | one invitation, not two | ✅ disabled | |
| 10.9 | Double-tap "Confirm payment" | one payment | ✅ disabled | |
| 10.10 | Reload mid-onboarding | resumes or clearly restarts | ⚠️ state lost | |
| 10.11 | Idle 30 min | session-expiry modal | ✅ | |
| 10.12 | Deep-link `/owner/tenants/:id` while logged out | login → **returns to that URL** | ❌ lands on `/` | |
| 10.13 | Log in as a tenant, force `/owner/home` | redirected out | ✅ | |
| 10.14 | Log in as admin, force `/owner/home` | redirected out | ✅ | |
| 10.15 | Two tabs: collect in tab A, reload tab B | tab B agrees | ✅ | |
| 10.16 | Two tabs: collect in tab A, **do not reload** tab B | live update via SSE | ❌ no subscriber | |
| 10.17 | Resize to 1440px | usable (not just a 480px column) | ⚠️ by design | |

---

## Scorecard

| Phase | Steps | Passing (Aug-01) |
|---|---|---|
| 0 Environment | 6 | 5 |
| 1 Signup & onboarding | 18 | 12 |
| 2 Multi-hostel | 11 | 4 |
| 3 Property structure | 14 | 8 |
| 4 Tenant lifecycle | 40 | 17 |
| 5 Money | 25 | 16 |
| 6 Agreements | 10 | 2 |
| 7 Move-out | 11 | 9 |
| 8 Alerts & search | 12 | 0 |
| 9 Configuration | 19 | 8 |
| 10 Resilience | 17 | 8 |
| **Total** | **183** | **89 (49%)** |

The 49% here and the ~45% in the audit are consistent: this checklist over-weights the flows that are finished (move-out, money) because they have more discrete steps. The audit's figure weights by business importance. Both point at the same three holes: **the tenant lifecycle after invite, agreements, and the alerts/notifications inbox.**
