# Owner onboarding — persistence, guidance, verification and location

**Date:** 2026-08-07
**Branch:** `feat/owner-onboarding-ux`
**Status:** design approved, implementing

## 1. Audit — what already exists

Verified by reading the code on 2026-08-07. **Do not rebuild these.**

- The 8-step wizard (`OwnerOnboardingWizard` + `components/steps/*`) is real and wired to real endpoints.
- **KYC uploads are real** (ADR-038): `owner_documents` table, `POST/GET /api/owner/kyc-documents`, files stored `PENDING`, and only an admin review can mark one `VERIFIED`. The step already uploads for real.
- `hostels.verification_status` (`HostelVerificationStatus`, default `PENDING`) already exists and is documented as admin-settable.

**The gap that matters most:** uploads land in `owner_documents` and **no admin endpoint or admin UI exists to review them**. Owners are uploading into a queue nobody can see.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Approval gates **going live**, not wizard progress | Both documents become required to *upload*, but the owner finishes onboarding immediately. The hostel stays `PENDING` and cannot publish until an admin approves. Hard-blocking mid-wizard would strand an owner who signs up at 11pm, and they would not come back. |
| D2 | Location is built against a **swappable `PlacesProvider`**, stubbed today | No Google API key yet, and Places autocomplete bills per keystroke. The full UI ships now; swapping in Google later is a config change, not a rewrite. |
| D3 | Draft is **localStorage, auto-saved, password excluded** | Step 1 creates the account, so no server row exists to save against for the first step. Local covers reload/tab-close/restart on the same device, which is the actual reported loss. Never persist a password. |
| D4 | Deposit is asked as **"do you take one?" → then months or flat** | A single amount field cannot express "two months' rent", which is the common Indian hostel norm, and forces a number on owners who take no deposit at all. |
| D5 | Room setup asks an explicit **confirmation before Continue** | `Generate` is optional and silent, so an owner can walk past the step having created nothing and not know it. |

## 3. Scope

1. **Draft persistence** — auto-save every field except passwords; restore with a "picking up where you left off" banner and a Start over escape.
2. **Password guidance** — live criteria checklist (length, letter, number, special), ticking as each passes, with strength wording.
3. **Documents** — Aadhaar and PAN both required; admin review endpoints + a review surface in the admin console; go-live gated on approval.
4. **Location** — `PlacesProvider` interface, stub implementation, autocomplete UI + selected-place confirmation.
5. **Deposit** — yes/no, then months-of-rent or flat amount.
6. **Rooms** — confirmation before advancing.
7. **Mobile** — field and component pass at 390px.

## 4. Pure modules (node-testable, no jsdom)

| Module | Responsibility |
|---|---|
| `passwordPolicy.ts` | Criteria evaluation + strength label. No React. |
| `onboardingDraft.ts` | Serialize/restore/clear; the password-exclusion rule lives here, not in a component. |
| `depositPolicy.ts` | Normalise `{takesDeposit, mode, months, flatAmount}` → the amount the backend stores, plus validation. |

Components stay thin renderers over these, per the repo's node-only test constraint.

## 5. Known limitations

- The stub places provider returns fixed suggestions; it is not a geocoder. Real coordinates arrive only with a Google key.
- localStorage is per-device: an owner who starts on a phone and continues on a laptop still loses the draft. Accepted under D3.
- Admin review is a queue with approve/reject; it does not do document OCR or identity matching.
