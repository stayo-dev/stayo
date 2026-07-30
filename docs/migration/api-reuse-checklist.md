# StayO API Reuse Checklist

Version: 2.0 — rewritten from live code inspection
Status: Living document
Last Updated: July 2026
Supersedes: v1.0, which listed invented endpoint shapes (`GET /rooms/:id`, `GET /complaints`, `GET /food/menu`, `GET /reports/revenue`, etc.) that don't match any real route in the backend. Every path below is copied from an actual `route.ts` file under `apps/backend/app/api/`.

---

# Purpose

Complete, verified inventory of every live backend API endpoint, organized by module, with its real HTTP method, auth requirement, key database tables, backend-reuse status (from `docs/migration/backend-gap-analysis.md`), and frontend-integration status. Update the **Frontend Status** column as StayO screens get wired up — everything else here is a fact about the existing backend and shouldn't change unless the backend itself changes.

All paths are relative to the backend's base URL and already include the real `/api/...` prefix used in code.

# Status Legend

**Backend** (fixed, from the gap analysis): ✅ Reuse · ⚠ Extend · 🔄 Refactor · ❌ Replace (doesn't exist)

**Frontend**: 🔴 Not Started · 🟡 In Progress · 🟢 Connected

Every row below starts 🔴 — this checklist was generated before any StayO frontend integration work began.

---

# Authentication — 19 endpoints, ✅ Reuse

| Endpoint | Method | Auth | Key tables | Notes | Frontend |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | Public | `profile`, `refresh_tokens`, `login_attempts` | Email/phone + password | 🔴 |
| `/api/auth/onboarding-login` | POST | Public | `profile` | Phone + password, bulk-imported tenants | 🔴 |
| `/api/auth/refresh` | POST | Refresh cookie | `refresh_tokens` | ⚠ doesn't call the reuse-detection rotation logic that exists in the service layer | 🔴 |
| `/api/auth/logout` | POST | Session | `refresh_tokens` | | 🔴 |
| `/api/auth/logout-all` | POST | Session | `refresh_tokens` | Revokes every session for the user | 🔴 |
| `/api/auth/me` | GET | Session | `profile`, `tenants`, `roomAllocation` | Current profile/tenant context | 🔴 |
| `/api/auth/activity` | POST | Session | — | Inactivity-timeout heartbeat | 🔴 |
| `/api/auth/csrf` | GET | Public | — | Issues double-submit CSRF cookie | 🔴 |
| `/api/auth/register` | POST | **Existing OWNER session** | `profile` | Not self-service signup — see gap analysis | 🔴 |
| `/api/auth/change-password` | POST | Session | `profile` | | 🔴 |
| `/api/auth/forgot-password` | POST | Public (rate-limited) | `profile` | Always returns a generic message | 🔴 |
| `/api/auth/reset-password` | POST | Reset token | `profile` | Single-use token via Redis lock | 🔴 |
| `/api/auth/reset-onboarding-password` | POST | Phone + current password | `profile` | Tenant first-login password change | 🔴 |
| `/api/auth/confirm-identity` | POST | Session, OWNER only | `identity_tokens`, `actionLog` | Issues 2-min step-up token for sensitive financial actions | 🔴 |
| `/api/auth/google-callback` | POST | OAuth code | `profile` | OWNER accounts only, never auto-creates | 🔴 |
| `/api/auth/send-phone-otp` | POST | Public (rate-limited) | `PhoneVerificationOtp` | WhatsApp delivery | 🔴 |
| `/api/auth/verify-phone-otp` | POST | Public (rate-limited) | `PhoneVerificationOtp`, `profile` | | 🔴 |
| `/api/events` | GET (SSE) | OWNER/ADMIN | — | Live activity stream | 🔴 |
| `/api/events-token` | GET | OWNER/ADMIN | — | 60s short-lived token for the SSE query-param auth flow | 🔴 |

---

# Owners — 25 endpoints, ✅ Reuse

| Endpoint | Method | Auth | Key tables | Notes | Frontend |
|---|---|---|---|---|---|
| `/api/owner-actions` | GET | Session | — | Catalog of available owner actions for a tenant entity | 🔴 |
| `/api/owner/activity-logs` | GET | OWNER/ADMIN | `activity_logs`, `systemEventLog` | ⚠ has a "first hostel" fallback anti-pattern, see gap analysis | 🔴 |
| `/api/owner/billing/frequency-requests` | GET | OWNER/ADMIN | `payment_frequency_change_requests` | | 🔴 |
| `/api/owner/billing/frequency-requests/[id]/decision` | POST | OWNER/ADMIN | `payment_frequency_change_requests` | | 🔴 |
| `/api/owner/finance/{by-hostel,collections,summary,transfers}` | GET/POST/PATCH/DELETE | — | — | **410 decommissioned** — legacy owner finance/subscription routes | 🔴 |
| `/api/owner/hostels` | GET, POST | OWNER/ADMIN | `hostels` | List with occupancy stats / create | 🔴 |
| `/api/owner/hostels/[id]/agreement-template` | GET, POST | OWNER/ADMIN | `agreementTemplate`, `RuleVersion` | Draft/publish workflow | 🔴 |
| `/api/owner/hostels/[id]/agreement-template/preview` | POST | OWNER/ADMIN | — | Returns a PDF binary | 🔴 |
| `/api/owner/hostels/[id]/agreement-template/signature` | POST | OWNER/ADMIN | — | Uploads signature stamp to ImageKit | 🔴 |
| `/api/owner/integrity` | GET | (middleware only — no explicit check) | — | Data-integrity metrics dashboard | 🔴 |
| `/api/owner/logo` | POST, DELETE | — | — | **410**, redirects to `/api/hostels/:id/logo` | 🔴 |
| `/api/owner/me/{activation,subscription,usage}` | — | — | — | **410 decommissioned** | 🔴 |
| `/api/owner/me/hostel` | PATCH | OWNER | `hostels` | Legacy single-hostel-implicit update | 🔴 |
| `/api/owner/me/preferences` | GET, PATCH | OWNER | `hostels` | Only auto-resolves hostel if owner has exactly 1 | 🔴 |
| `/api/owner/me/profile` | GET, PATCH | OWNER | `profile`, `hostels` | | 🔴 |
| `/api/owner/payments/offline` | POST | (alias) | — | Re-export of `/api/payments/record-offline` | 🔴 |
| `/api/owner/portfolio/summary` | GET | OWNER/ADMIN | `hostel_daily_snapshots` | Reads precomputed snapshots only | 🔴 |
| `/api/owner/search` | GET | OWNER/ADMIN | `profile` | Global tenant search | 🔴 |
| `/api/owner/whatsapp/connections` | GET | OWNER | `owner_whatsapp_identities` | | 🔴 |
| `/api/owner/whatsapp/connections/[connectionId]` | DELETE | OWNER | `owner_whatsapp_identities` | | 🔴 |
| `/api/owner/whatsapp/link-code` | POST | OWNER | `owner_whatsapp_identities` | | 🔴 |
| `/api/owners/invitations` | POST | OWNER | `tenants`, `tenant_invitations` | | 🔴 |

---

# Hostels — 14 endpoints, ✅ Reuse

| Endpoint | Method | Auth | Key tables | Notes | Frontend |
|---|---|---|---|---|---|
| `/api/hostels/[id]` | GET, PATCH, DELETE | OWNER (+ADMIN on GET) | `hostels` | DELETE = archive; blocked if active allocations exist | 🔴 |
| `/api/hostels/[id]/automation-config` | PATCH | OWNER only | `hostels.preferences_config` | Auto-rent/auto-late-fee/auto-reminders toggles | 🔴 |
| `/api/hostels/[id]/billing-config` | PATCH | OWNER only | `hostels.preferences_config` | Rent cycle, due day, grace days, late-fee rules | 🔴 |
| `/api/hostels/[id]/billing-defaults` | GET, PATCH | OWNER | `hostels.preferences_config` | | 🔴 |
| `/api/hostels/[id]/invite-defaults` | PATCH | OWNER only | `hostels.preferences_config` | Deposit/maintenance defaults for invites | 🔴 |
| `/api/hostels/[id]/logo` | POST, DELETE | OWNER | `hostels` | ImageKit upload | 🔴 |
| `/api/hostels/[id]/notification-config` | PATCH | OWNER only | `hostels.preferences_config` | Reminder channels/schedule | 🔴 |
| `/api/hostels/[id]/payment-config` | PATCH | OWNER only | `hostels.preferences_config` | UPI id, partial payments toggle | 🔴 |
| `/api/hostels/[id]/preferences` | GET, PATCH | OWNER | `hostels.preferences_config` | Full policy object, generic patch | 🔴 |
| `/api/hostels/[id]/preferences/inspector` | GET | OWNER | `whatsapp_logs`, `reminder_logs` | Reminder-decision timeline debugger | 🔴 |
| `/api/hostels/[id]/preferences/metadata` | GET | OWNER | `owner_whatsapp_identities` | WhatsApp connection health | 🔴 |
| `/api/hostels/[id]/preferences/simulate` | GET | OWNER | `tenants` | Simulates a full reminder journey | 🔴 |
| `/api/hostels/[id]/receipt-config` | PATCH | OWNER only | `hostels.preferences_config` | | 🔴 |
| `/api/hostels/[id]/security-config` | PATCH | OWNER only | `hostels.preferences_config` | | 🔴 |
| `/api/hostels/[id]/system-config` | PATCH | OWNER only | `hostels.preferences_config` | Currency, timezone, locale | 🔴 |

---

# Floors — 4 endpoints, ✅ Reuse

| Endpoint | Method | Auth | Key tables | Notes | Frontend |
|---|---|---|---|---|---|
| `/api/floors` | GET | OWNER/ADMIN | `floors`, `rooms`, `room_allocations` | Room/occupancy counts per floor | 🔴 |
| `/api/floors` | POST | OWNER/ADMIN | `floors` | | 🔴 |
| `/api/floors/[id]` | PATCH | OWNER/ADMIN | `floors` | Rename/reorder | 🔴 |
| `/api/floors/[id]` | DELETE | OWNER/ADMIN | `floors` | Blocked if active rooms exist | 🔴 |

---

# Rooms & Allocations — 11 endpoints, ✅ Reuse

| Endpoint | Method | Auth | Key tables | Notes | Frontend |
|---|---|---|---|---|---|
| `/api/rooms` | GET | OWNER/ADMIN | `rooms`, `floors`, `room_allocations` | `?grouped=true` returns floor tree | 🔴 |
| `/api/rooms` | POST | OWNER/ADMIN | `rooms` | Duplicate room_no check | 🔴 |
| `/api/rooms/[id]` | GET, PATCH, DELETE | OWNER/ADMIN | `rooms`, `room_activity_logs` | Capacity ceiling 20; delete blocked by active allocations/reservations | 🔴 |
| `/api/rooms/[id]/overview` | GET | OWNER/ADMIN | `rooms`, `tenants` | Current tenants + reserved invitations | 🔴 |
| `/api/rooms/[id]/invite-defaults` | GET | OWNER/ADMIN | `hostels.preferences_config` | | 🔴 |
| `/api/allocations` | GET | not-TENANT | `roomAllocation` | | 🔴 |
| `/api/allocations` | POST | not-TENANT | `roomAllocation` | Atomic, capacity-checked in-transaction | 🔴 |
| `/api/allocations/[id]/end` | PATCH | Owner (route-level check) | `roomAllocation` | | 🔴 |
| `/api/allocations/my-room` | GET | TENANT | `roomAllocation` | Alias of `/tenants/me/room` | 🔴 |
| `/api/allocations/shift` | POST | OWNER/ADMIN | `roomAllocation` | Atomic transfer, target validated before old allocation closes | 🔴 |
| `/api/allocations/tenant/[id]` | GET | OWNER (own tenant) / TENANT (self) / ADMIN | `roomAllocation` | Full history | 🔴 |

---

# Tenants — 60+ endpoints, ✅ Reuse

## Core CRUD
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants` | GET, POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]` | GET, PUT, DELETE | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/full` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/by-profile/[profileId]` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/export` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/increment-year` | GET, POST | OWNER/ADMIN | 🔴 |

## Invitation / activation lifecycle
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/invite` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/resend-invitation` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/cancel-invitation` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/compliance-action` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/activate` | GET, POST, PATCH | Public, token-gated | 🔴 |
| `/api/tenants/activate/context` | GET | Public, token-gated | 🔴 |
| `/api/tenants/activate/photo` | POST | Public, token-gated | 🔴 |
| `/api/tenants/activate/signature` | POST | Public, token-gated | 🔴 |
| `/api/tenants/onboarding/complete` | POST | Session | 🔴 |
| `/api/tenants/me/complete-profile` | POST | TENANT | 🔴 |
| `/api/tenants/me/onboarding-settings` | GET | TENANT | 🔴 |

## Reactivation
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/[id]/reactivate` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/me/reactivation-request` | POST | TENANT (rate-limited 1/24h) | 🔴 |
| `/api/tenants/owner/reactivation-requests` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/owner/reactivation-requests/[id]/decision` | POST | OWNER/ADMIN | 🔴 |

## Transfer
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/transfer` | POST, GET | OWNER/ADMIN | 🔴 |

## Documents / photo
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/[id]/documents` | GET | OWNER/ADMIN/TENANT-self | 🔴 |
| `/api/tenants/[id]/documents/[docId]/download` | GET | OWNER/ADMIN/TENANT-self | 🔴 |
| `/api/tenants/[id]/documents/[docId]/message` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/documents/[docId]/reject` | PATCH | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/documents/[docId]/verify` | PATCH | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/documents/bulk-verify` | PATCH | OWNER/ADMIN | 🔴 |
| `/api/tenants/me/documents` | GET, POST | TENANT | ImageKit upload — 🔴 |
| `/api/tenants/pending-documents` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/photo` | POST | OWNER/TENANT-self | 🔴 |
| `/api/tenants/me/photo` | POST | TENANT | 🔴 |

## Notes
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/[id]/notes` | GET, POST, DELETE | OWNER/ADMIN | 🔴 |

## Financial self-service (tenant-scoped)
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/[id]/billing-timeline` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/financial-ledger` | GET, POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/financial-ledger/adjust` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/financial-ledger/refund-status` | PATCH | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/financial-timeline` | GET | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/change-frequency` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/change-frequency/custom` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/[id]/change-rent` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenants/me/billing-frequency` | GET, POST | TENANT | 🔴 |
| `/api/tenants/me/billing-timeline` | GET | TENANT | 🔴 |
| `/api/tenants/me/financial-ledger` | GET | TENANT | 🔴 |
| `/api/tenants/me/financial-read-model` | GET | TENANT | 🔴 |
| `/api/tenants/me/payments/history` | GET | TENANT | 🔴 |
| `/api/tenants/me/renewal-signature` | POST | TENANT | 🔴 |

## Score, profile, owner overview
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenants/[id]/score` | GET | OWNER | 🔴 |
| `/api/tenants/me/score` | GET | TENANT | 🔴 |
| `/api/tenants/me/profile` | GET, PATCH | TENANT | 🔴 |
| `/api/tenants/me/room` | GET | TENANT | 🔴 |
| `/api/tenants/profile` | GET, PATCH | Public GET / TENANT PATCH | 🔴 |
| `/api/tenants/owner/tenants/[id]/overview` | GET | OWNER | 🔴 |

## `/api/tenant/*` (singular, parallel namespace)
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/tenant/agreement-renewal` | GET | TENANT | 🔴 |
| `/api/tenant/exit` | POST | OWNER/ADMIN | 🔴 |
| `/api/tenant/renewal-offer` | GET | TENANT | 🔴 |
| `/api/tenant/renewal-offer/[id]/accept` | POST | TENANT | 🔴 |
| `/api/tenant/renewal-offer/[id]/decline` | POST | TENANT | 🔴 |
| `/api/tenant/renewal-offer/[id]/discuss` | POST | TENANT | 🔴 |

## Generic profile + bulk import
| Endpoint | Method | Auth | Frontend |
|---|---|---|---|
| `/api/profile/me`, `/api/profile` | GET, PATCH | Session | 🔴 |
| `/api/profiles/[id]` | GET, PUT | Self or OWNER/ADMIN | 🔴 |
| `/api/profiles/unassigned/tenants` | GET | OWNER | 🔴 |
| `/api/bulk-import/upload` | POST | OWNER/ADMIN | Validate-only, max 150 rows — 🔴 |
| `/api/bulk-import/[batch_id]` | GET | OWNER/ADMIN | 🔴 |
| `/api/bulk-import/[batch_id]/confirm` | GET, POST | OWNER/ADMIN | Idempotent per row — 🔴 |
| `/api/bulk-import/revalidate` | POST | OWNER/ADMIN | 🔴 |
| `/api/bulk-import/template` | GET | OWNER/ADMIN | 🔴 |
| `/api/bulk-import/google-form-prompt` | POST | OWNER | 🔴 |

---

# Complaints — 0 endpoints, ❌ Replace

**No API exists.** The `complaints` table has no route, no service, no create/list/update/resolve path. Nothing to list here — this entire section needs to be designed and built from scratch (routes, validators, service, plus whatever UI-facing shape StayO's Complaint List / Details / Create screens need). Reuse the existing table columns as a starting schema if they fit.

---

# Payments & Billing — 30 live + 12 decommissioned, ✅ Reuse (core) / ❌ Replace (PhonePe, platform billing)

## Core payment lifecycle
| Endpoint | Method | Auth | Notes | Frontend |
|---|---|---|---|---|
| `/api/payments` | GET | OWNER | Paginated, filtered | 🔴 |
| `/api/payments` | POST | OWNER | Manual/offline record | 🔴 |
| `/api/payments/[id]` | GET | OWNER/ADMIN | | 🔴 |
| `/api/payments/[id]/receipt` | GET | TENANT-self / OWNER | | 🔴 |
| `/api/payments/attempts/[id]` | GET | Session (tenant scoped) | | 🔴 |
| `/api/payments/create-intent` | POST | Session | Rate-limited 10/5min; ADVANCE/DEPOSIT/RENT branches | 🔴 |
| `/api/payments/verify` | POST | Session | Client-side post-checkout verification | 🔴 |
| `/api/payments/confirm` | POST | OWNER/ADMIN | Confirm/reject pending attempt | 🔴 |
| `/api/payments/manual-confirm` | POST | OWNER/ADMIN | Requires identity token | 🔴 |
| `/api/payments/offline` | POST | (alias) | Re-export of `record-offline` | 🔴 |
| `/api/payments/record-offline` | POST | OWNER/ADMIN | Requires identity confirmation token | 🔴 |
| `/api/payments/pay-dues` | POST | TENANT-self / OWNER | FIFO pay-down of all unpaid obligations | 🔴 |
| `/api/payments/pay-link` | POST | OWNER / TENANT | Mints shareable `/pay/{token}` link | 🔴 |
| `/api/payments/pay/[token]` | GET, POST | Public, token-gated | Self-contained HTML checkout page | 🔴 |
| `/api/payments/pending-verification` | GET | OWNER/ADMIN | | 🔴 |
| `/api/payments/preview` | GET | TENANT/OWNER | | 🔴 |
| `/api/payments/quick-collect/search` | GET | OWNER/ADMIN | | 🔴 |
| `/api/payments/reconcile` | POST | OWNER | | 🔴 |
| `/api/payments/dues` | GET | OWNER | | 🔴 |
| `/api/payments/generate-preview` | GET | OWNER/ADMIN | Dry-run of the rent-generation cron | 🔴 |
| `/api/payments/obligations` | POST | OWNER/ADMIN | Manual obligation creation | 🔴 |
| `/api/payments/obligations/[id]/cancel` | POST | OWNER, identity token | Only if zero payments recorded | 🔴 |
| `/api/payments/obligations/[id]/waive` | POST | OWNER, identity token | | 🔴 |
| `/api/payments/obligations/[id]/history` | GET | OWNER/ADMIN / TENANT-self | | 🔴 |
| `/api/payments/settlement-plan` | POST | Session | Custom obligation selection | 🔴 |
| `/api/payments/settlement-preview` | GET | Session | Read-only dry run | 🔴 |
| `/api/payments/tenant-dues` | GET | TENANT-self / OWNER | | 🔴 |
| `/api/payments/tenant/[id]` | GET | TENANT / OWNER | | 🔴 |
| `/api/payments/test-intent` | POST | Session, **disabled in production** | | 🔴 |
| `/api/webhooks/payments/razorpay` | POST | HMAC signature only | The only implemented gateway — see gap analysis re: PhonePe | 🔴 |
| `/api/verify/receipt` | GET | Public, token-verified | | 🔴 |
| `/api/invoices/[id]` | GET | Session, ownership-checked | PDF via ImageKit | 🔴 |
| `/api/rent/generate` | GET, POST | OWNER/ADMIN | Owner-triggered rent generation | 🔴 |

## Cron (system-triggered, `CRON_SECRET` bearer)
| Endpoint | Notes |
|---|---|
| `/api/cron/generate-rent` | Batched monthly rent generation |
| `/api/cron/reconcile-payments` | Reconciles pending attempts |
| `/api/cron/process-autopay-retries` | **410 decommissioned** |
| `/api/cron/process-overflow` | **410 decommissioned** |
| `/api/cron/reconcile-addons` | **410 decommissioned** |

## Decommissioned platform billing — ❌ Replace if StayO needs a subscription/billing engine
| Endpoint | Status |
|---|---|
| `/api/billing/message-quota`, `/overflow`, `/plans`, `/upgrade` | 410, all methods |
| `/api/addons`, `/addons/purchase`, `/addons/usage`, `/addons/verify` | 410, all methods |
| `/api/plans`, `/api/subscription`, `/api/usage` | 410 |

---

# Food — 0 endpoints, ❌ Replace

**No API exists.** Confirmed via three independent search passes. Nothing to list — schema, routes, and service all need to be designed from scratch.

---

# Reports / Dashboard / Analytics — 17 endpoints, ✅ Reuse

*(No `/reports/*` path exists — this is the real location of that functionality.)*

| Endpoint | Method | Auth | Notes | Frontend |
|---|---|---|---|---|
| `/api/dashboard` | GET | OWNER/ADMIN | Multi-month bundle, requires `hostelId` | 🔴 |
| `/api/dashboard/cashflow` | GET | OWNER/ADMIN | | 🔴 |
| `/api/dashboard/funnel` | GET | OWNER/ADMIN | Reminder→payment conversion | 🔴 |
| `/api/dashboard/monthly-stats` | GET | OWNER/ADMIN | | 🔴 |
| `/api/dashboard/operations` | GET | OWNER/ADMIN | Move-ins/outs, vacancy, tickets | 🔴 |
| `/api/dashboard/portfolio-performance` | GET | OWNER/ADMIN | Multi-hostel rankings | 🔴 |
| `/api/dashboard/portfolio-shell` | GET | OWNER/ADMIN | | 🔴 |
| `/api/dashboard/stats`, `/stats-shell`, `/summary` | GET | OWNER/ADMIN | Same underlying data, 3 near-duplicate endpoints | 🔴 |
| `/api/dashboard/stats-activity` | GET | OWNER/ADMIN | | 🔴 |
| `/api/dashboard/stats-analytics` | GET | OWNER/ADMIN | | 🔴 |
| `/api/dashboard/tenant` | GET | **TENANT only** | | 🔴 |
| `/api/dashboard/tenants` | GET | OWNER/ADMIN | Tenant-intelligence dashboard | 🔴 |
| `/api/analytics/dashboard` | GET | OWNER/ADMIN | "Advanced" combined dashboard | 🔴 |
| `/api/metrics` | GET | **⚠ no auth check** | Should be fixed regardless of frontend work | 🔴 |
| `/api/metrics/reset` | POST | OWNER/ADMIN | | 🔴 |

---

# Notifications — 7 endpoints, ✅ Reuse

| Endpoint | Method | Auth | Notes | Frontend |
|---|---|---|---|---|
| `/api/notifications` | GET | Session | Last 50, own notifications | 🔴 |
| `/api/notifications/[id]/read` | POST | Session | | 🔴 |
| `/api/notifications/send-reminder` | POST | OWNER/ADMIN | Manual one-tap reminder | 🔴 |
| `/api/notifications/test-reminder` | POST | OWNER/ADMIN | | 🔴 |
| `/api/webhooks/notifications/whatsapp` | GET, POST | Public / HMAC signature | Meta webhook + bot command handler | 🔴 |
| `/api/debug/send-test-otp` | POST | ADMIN | | 🔴 |
| `/api/debug/whatsapp-health` | GET | Public (booleans only) | | 🔴 |

**Note**: the WhatsApp bot itself (tenant commands `BAL`/`DUES`/`PAY`/`STATUS`/`HELP`, owner commands `SUMMARY`/`COLLECTIONS`/`VACANCIES`/etc.) lives inside `whatsapp-webhook-event-service.ts` / `owner-whatsapp-assistant.ts`, triggered by the webhook route above, not by a set of individually-listed REST endpoints — decide whether StayO keeps this conversational surface as-is.

---

# Admin — 9 live + 15 decommissioned, 🔄 Refactor + ❌ Replace

| Endpoint | Method | Auth | Notes | Frontend |
|---|---|---|---|---|
| `/api/admin/finance-ops` | GET | **ADMIN** (unreachable — role doesn't exist in schema) | | 🔴 |
| `/api/admin/finance-ops/anomalies` | GET | **ADMIN** (unreachable) | | 🔴 |
| `/api/admin/finance-ops/attempts` | GET | **ADMIN** (unreachable) | | 🔴 |
| `/api/admin/finance-ops/attempts/[id]` | GET | **ADMIN** (unreachable) | | 🔴 |
| `/api/admin/finance-ops/reconciliation-runs` | GET | **ADMIN** (unreachable) | | 🔴 |
| `/api/admin/finance-ops/webhook-events` | GET | **ADMIN** (unreachable) | | 🔴 |
| `/api/admin/finance/reconciliation/issues` | GET | **OWNER**, despite the `/admin/` path | 7-detector scan results | 🔴 |
| `/api/admin/finance/reconciliation/issues/[issueId]` | PATCH | OWNER | Fixed state-machine transitions | 🔴 |
| `/api/admin/finance/reconciliation/scan` | POST | OWNER | | 🔴 |
| `/api/admin/activation-analytics` | all | — | **410 decommissioned** | 🔴 |
| `/api/admin/finance-ops/invoices` | GET | — | **410 decommissioned** | 🔴 |
| `/api/admin/settlements/*` (11 routes) | all | — | **410 decommissioned**, entire subtree | 🔴 |

**Before any Super Admin screen is wired to real data**: the Prisma `Role` enum needs an `ADMIN` value added and an issuance path built (currently no code anywhere assigns `role: "ADMIN"` to a real profile). Owner-approval workflow, cross-hostel visibility, and platform user management — all implied by `docs/product/personas.md`'s Super Admin — don't exist yet in any form, live or decommissioned.

---

# Bonus modules (not in the original 12, substantial and reusable)

## Agreements, Renewals, Move-out — ✅ Reuse
`/api/agreements/*` (lifecycle-recovery, renewal-draft, renewal-offer, sign-renewal, history, r4-readiness, renewal-audiences, renewal-offers, renewals), `/api/change-requests/*`, `/api/move-out/*` (requests, inspect, settle, vacate, complete, reject, cancel, dispute, feedback, analytics, vacancies, tenant, timeline), `/api/tenant/exit`, `/api/recovery/cases/*`. Full lease lifecycle with inspections, disputes, and settlement — see gap analysis for detail.

## Admissions, Leads, Visit — ✅ Reuse, maps to StayO's V2 marketplace roadmap
`/api/admissions/leads` (+ `/qr-code`), `/api/leads` (+ `[id]`, `/analytics`, `/notes`, `/reserve-room`, `/convert-to-invitation`, `/reservations/[id]/cancel`), `/api/visit/[hostelSlug]` (+ `/leads`, `/activities`, all public). Includes lead scoring, status auto-progression, reservation anti-abuse cooldowns, and a funnel analytics view — genuinely sophisticated, worth pulling into V1 consideration rather than waiting for V2 given how much already works.

---

# Development checklist (per endpoint, once frontend work starts)

- [ ] Endpoint behavior re-verified against this doc (backend may have changed since)
- [ ] Auth/role requirement matches what's documented here
- [ ] Request body/query shape confirmed against the actual Zod validator (not assumed)
- [ ] Loading, empty, and error states implemented
- [ ] Tested on mobile and desktop
- [ ] Frontend Status column above updated (🔴 → 🟡 → 🟢)
