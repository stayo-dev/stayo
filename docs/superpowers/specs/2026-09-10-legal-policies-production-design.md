# Production Legal Policy Set — Design

**Date:** 2026-09-10
**Status:** Approved design, pending implementation plan
**Scope:** Public legal documents, platform policy consent subsystem, grievance intake, legal UI/UX

## 1. Context

Stayo is moving to production. The legal document set has to do three jobs at once:

1. **Bind users defensibly** — owners onboarding to a paid subscription, residents whose rent flows through Stayo's account.
2. **Pass payment-aggregator onboarding review** — Easebuzz merchant verification.
3. **Support Meta Business Verification** for the WhatsApp display name and templates.

The existing set (`apps/frontend/src/content/legal.ts`, six documents) was written against an
earlier, different understanding of the business and now contradicts the code in several places
that matter. This design replaces it.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Stayo is a pure technology platform** — never a party to the stay, and never in the flow of tenant money | *Revised 2026-09-10 (see §2.1).* Under the Easebuzz sub-merchant model each hostel owner is the merchant of record with their own sub-merchant account; tenant payments settle **directly to the owner**. Stayo's only revenue is owner subscriptions. Strictly lower liability than the collection-agent position originally approved. |
| D2 | **Publish the compliance minimum** of entity details | Consumer Protection (E-Commerce) Rules 2020 and IT Rules 2021 require legal name, registered address and a named Grievance Officer. Payment aggregators verify these against the live site. Supersedes the current "address and registration IDs are deliberately NOT surfaced" stance in `company.ts`. |
| D3 | **Full versioned policy + acceptance record** | Today nothing proves any user accepted anything. Robust policies that cannot be shown to have been accepted are weak in a dispute. |
| D4 | **Terms = shared core + Schedule A (Owners) + Schedule B (Residents)** | Owners buy software; residents get a free account and pass money through. One undifferentiated document is why the current one is incoherent. Two fully separate documents would duplicate boilerplate and drift — the exact failure that produced the two divergent `legal.ts` copies. |
| D5 | **Platform refund floor, hostel terms beyond it — imposed on owners, not underwritten by Stayo** | *Revised 2026-09-10.* "Ask the hostel" is not a publishable refund policy and tends to fail aggregator review. But Stayo never holds tenant money, so it cannot pay a refund it never received: the floor is a **contractual obligation on the owner**, enforced by suspension and delisting, executed by the owner from their own sub-merchant account. |
| D6 | **Name Easebuzz as the payment partner**, via a single constant | Aggregator reviewers look for it; refund timelines are meaningless without naming the rails. Centralised so switching is a one-line change. |

### 2.1 The Easebuzz sub-merchant model (confirmed 2026-09-10)

Stayo is onboarding as an **Easebuzz partner**, and each hostel owner is onboarded as an
**individual sub-merchant with their own Easebuzz account**. A resident's payment settles
**directly to the owner's sub-merchant account**. Stayo is never in the flow of funds and never
holds tenant money; owners see and manage their own settlements in their own account. Stayo's
sole revenue is the owner subscription.

This resolves both risks previously recorded in §14 as deferred:

- **RBI payment-aggregator exposure — resolved.** Easebuzz is the authorised aggregator and the
  owner is the merchant. Stayo neither collects nor settles third-party funds.
- **GST-threshold contamination — resolved.** Rent never reaches the proprietor's account, so it
  can never be read as his own receipts. Only subscription revenue counts toward the ₹20 lakh
  threshold.

**Code consequence, out of scope here but must be tracked.** The owner-payout/settlement subsystem
describes the superseded model: `gateway_transactions` is documented as "money the provider
actually captured into **Stayo's** account", with settlement runs, Stayo-initiated transfers, the
T+2 working-day promise and a "With Stayo" money state (`src/services/settlements/*`,
`docs/obsidian/Business-Rules.md` § "Owner payouts"). None of that exists under the sub-merchant
model. Nothing real is lost — Business-Rules records **zero captured payments in any environment**
— but a meaningful amount of shipped code now models a business Stayo is not running. That
cleanup is a separate decision from this legal work.

### Entity facts fixed by these decisions

- **Trishul Solutions is a sole proprietorship of Chidiri Shiva Prakash.** No separate legal
  personality: the contracting party is the proprietor personally, trading as Trishul Solutions.
  Liability is personal and unlimited, which raises the stakes on the limitation-of-liability and
  indemnity clauses — they must be genuine, not boilerplate.
- **Principal place of business** (per Udyam registration): 12-75/1, Balaji Nagar, Block 2,
  Kodangal, Vikarabad District, Telangana 509338.
- **Grievance Officer: Chidiri Shiva Prakash**, `grievance@yourstayo.com` — the proprietor acting
  in the role, standard practice at this size. See §9.1 for what the role obliges.

**Published contacts vs registration contacts.** The Udyam registration carries the proprietor's
*personal* contacts (`8008046952`, `spchidiri2006@gmail.com`); `+91 76750 80090` and the
`@yourstayo.com` addresses are dedicated business contacts. **Only the business contacts are
published** — nothing obliges a proprietor to publish a personal number or personal email, and
putting either into legal pages that get scraped is a needless exposure.

Two consequences:

1. **Update the Udyam record to the business contacts.** Udyam is self-declared and editable free
   online with Aadhaar OTP. Leaving a mismatch between the registration and the live site invites
   a manual-review question during Easebuzz KYC and Meta Business Verification — avoidable friction
   for ten minutes of work, and permanent once done.
2. **The published address is residential, and that is the genuine exposure.** The legal name and
   the principal place of business *must* be published; the contacts need not be. A residential
   address on a consumer platform means aggrieved users know where the founder lives, which is a
   real consideration in a business whose disputes involve deposits and evictions.

   **A Hyderabad coworking or virtual office with a Shop & Establishment registration solves two
   problems with one action**: it keeps the home address private, *and* it supplies the Hyderabad
   nexus that would let the jurisdiction clause in §6.1 be tightened from non-exclusive to
   exclusive. At roughly ₹1,000–2,000/month this is the highest-leverage item in this spec.
   Recorded as a recommendation, not a blocker — the documents draft with the Udyam address and
   the swap is a single constant edit.
- **Not GST-registered.** No GSTIN is claimed anywhere, no GST is shown on any Stayo invoice.
  Fee clauses state that fees are exclusive of taxes and that tax will apply *if and when* Stayo
  becomes liable to register.

## 3. Non-goals

- Migrating the payment integration to Easebuzz (tracked as a go-live prerequisite, §13, not built here).
- Moving to gateway split-settlement (recommended in §14, deliberately out of scope).
- Publishing subscription prices (product decision — flagged in §11, not decided here).
- Rewriting per-hostel house rules (`RuleVersion` / `TenantPolicyAcceptance`) — untouched.

## 4. Audit findings this design corrects

### Policy contradicts the product

| Current policy asserts | Code actually does |
|---|---|
| Refunds "credited back to the original bank account or payment method within 7 to 10 business days" | Manual owner-initiated bank transfer recorded in a ledger (`app/api/tenants/[id]/financial-ledger/refund-status/route.ts`); no gateway reversal, no SLA |
| Deletion "within 30 business days", removing "billing records" | Closure is **immediate anonymisation, never erasure**; financial rows survive by design (`src/services/profile/account-closure-service.ts`) |
| "All payments made to **Stayo** for rent … are non-refundable" | Stayo is not the landlord. Deposit refundability is per-hostel configurable (`advance_refundable`), so a platform-wide blanket rule is both false and likely an unfair term |
| Footer offers a "Cookie Policy" | No cookie policy exists; the link points at the privacy page. No cookie/consent banner exists |
| Privacy policy names Razorpay twice | Contradicts the requirement to keep the aggregator out of general trust copy, and is now the wrong provider |

### Structural gaps

- **No consent record.** No `terms_accepted_at`, no policy-version column, no assent gate at owner
  signup or tenant activation. The correct pattern already exists one layer down —
  `TenantPolicyAcceptance` (`prisma/schema.prisma`) stores version + snapshot + IP + user-agent +
  typed signature — but only for *hostel house rules*, never for Stayo's own terms.
- **A live page with placeholder identity.** `apps/backend/app/legal/page.tsx` publishes
  "Sunrise Residency / example-hostel.in" as real legal terms.
- **The grievance channel is a `mailto:` link** (`ContactPage.tsx`). No ticket, no acknowledgement
  record, and a silent failure for any user with no mail client configured. The IT Rules'
  48-hour acknowledgement cannot be evidenced with it.
- **The privacy policy omits the strongest privacy asset**: the identity-document vault, where a
  document is held once and shared per-hostel only with the resident's consent, revocably
  (`identity_document_shares`).
- **Children's data.** DOB and guardian details are collected, students are a core segment, and
  agreements capture guardian e-signatures — yet the privacy policy asserts "we may track your
  behaviour, preferences", which DPDP §9 prohibits for under-18s.
- **A GST report for an unregistered proprietor.** `app/api/platform-admin/revenue/export/route.ts`
  generates `gst-tax-report.csv` back-computing 18% GST on Stayo's own subscription invoices.
  Admin-only, so nothing customer-facing has leaked.

## 5. Document set and routes

Seven documents. **Every existing URL survives as an alias** — aggregators and Meta may already
have registered them.

| Document | Canonical route | Aliases | Audience |
|---|---|---|---|
| Terms of Use (core + Schedule A + Schedule B) | `/legal/terms` | `/terms` | both, filtered by reader |
| Privacy Policy | `/legal/privacy` | `/privacy` | all |
| Payments, Refunds & Cancellations | `/legal/refunds` | `/refund-policy`, `/legal/refund-policy` | all |
| Cookie & Tracking Notice | `/legal/cookies` | — | all (**new**) |
| Service Delivery & Access | `/legal/service-delivery` | `/shipping-policy`, `/legal/shipping-policy` | all |
| Data Deletion & Retention | `/legal/data-deletion` | — | all |
| Contact & Grievance Redressal | `/contact` | `/legal/contact` | all |

Acceptable Use folds into Terms rather than becoming a separate page. A user-generated-content /
reviews takedown clause also lives in Terms, since hostel reviews are shipping and IT Rules
require a published takedown route for UGC.

## 6. Substantive positions

### 6.1 Terms of Use — core

- Stayo is a **technology platform and collection agent**. The accommodation contract is
  resident ↔ hostel owner. Stayo generates and stores the agreement; it is not a party to it.
- Contracting entity named as a **sole proprietorship concern of [PROPRIETOR NAME]**, with
  principal place of business.
- **Limitation of liability** capped at fees actually received from that user in the preceding
  three months, with a nominal floor (proposed ₹5,000) for residents who pay Stayo nothing directly.
- **Eligibility: 18+.** A guardian holds the account for a minor. This is the clean answer to
  DPDP §9 and fits the guardian details and guardian e-signatures already captured.
- **Acceptable use**, including the existing prohibitions (bypassing payment mechanisms, false
  identification) plus platform-integrity items.
- **UGC / reviews**: licence grant, moderation is Stayo's, published takedown route via the
  grievance channel.
- Governing law India; **Hyderabad** jurisdiction (confirmed 2026-09-10).

  **Drafted as non-exclusive, deliberately.** Under s.20 CPC parties may agree to one of the
  courts that would *otherwise* have jurisdiction; an *exclusive* clause naming a court with no
  nexus is void as ousting jurisdiction. The registered principal place of business is Vikarabad
  District, so Hyderabad's nexus is currently weak. Wording it as *"the courts at Hyderabad,
  Telangana shall have jurisdiction"* rather than *"exclusive jurisdiction"* keeps the preferred
  forum without giving anyone a clause to strike. It can be tightened to exclusive once Stayo has
  a real place of business in Hyderabad — which is the cheaper fix, and worth doing.
- **New: arbitration clause** — sole arbitrator, Hyderabad seat, Arbitration & Conciliation Act
  1996. The single most effective clause for avoiding drawn-out consumer litigation.

### 6.2 Schedule A — Hostel Owners

- Subscription, trial, billing cycle, autopay; behaviour on `PAYMENT_FAILED` / `CANCELLED`
  (data retained, access suspended, export window) — mirroring `HostelSubscriptionStatus`.
- Owner **warrants** lawful right to let the property and accuracy of listings, and **indemnifies**
  Stayo against resident claims concerning the premises.
- **Sub-merchant onboarding.** The owner is onboarded as an Easebuzz sub-merchant and is the
  **merchant of record** for every resident payment. The terms must state that the owner enters a
  **direct relationship with Easebuzz**, accepts Easebuzz's own merchant terms, and that
  settlement timing, holds and transaction fees are governed by that relationship — not by Stayo.
- **KYC warranty.** The owner warrants that all KYC information submitted through Stayo for
  sub-merchant onboarding is true and current, and indemnifies Stayo for losses arising from it.
  Stayo may **suspend or withdraw** platform access if Easebuzz suspends the sub-merchant, or on
  Easebuzz's instruction — a pass-through obligation Stayo owes its aggregator partner.
- **The owner issues refunds**, from their own sub-merchant account, and is responsible for
  honouring the platform refund floor (§6.4), for deposit refunds, and for their own tax position.
  Stayo never holds, refunds or reverses resident money.

### 6.3 Schedule B — Residents

- The account is free.
- **Payment made through the platform settles directly to the hostel's own merchant account and
  discharges the resident's obligation at the moment of successful payment.** Under the
  sub-merchant model Stayo is never in the flow of funds, so the resident carries no settlement
  risk from Stayo — a materially better position than the collection-agent model, and worth
  stating plainly rather than leaving implied.
- The hostel's house rules, notice period and deposit terms bind separately and are shown before
  payment.
- What Stayo is **not** responsible for: room condition, food, safety, hostel conduct.

### 6.4 Payments, Refunds & Cancellations

Two clearly separated parts, because conflating them is why the current document reads as nonsense.

**Part 1 — Money you pay Stayo (owner subscriptions).** Stayo's own refund terms; trial handling;
whether fees are refundable on mid-cycle cancellation *(placeholder — §12)*.

**Part 2 — Money you pay to a hostel through the platform (rent, deposit, booking token).**

The document must be unambiguous that **Stayo neither receives nor refunds this money**. It
settles directly to the hostel's own merchant account with Easebuzz; the hostel issues any refund
from that account.

- **Platform minimum floor — a condition of listing, binding on every hostel:**
  - duplicate payments, failed-but-debited transactions and wrong-amount charges are always corrected;
  - a booking token is refunded in full if the hostel cancels, or if the room materially differs
    from the listing.
- **How the floor is enforced**, stated honestly: Stayo cannot pay a refund it never received.
  Stayo's remedies against a hostel that refuses are **suspension and delisting**, plus escalation
  through the grievance channel (§9), and — for a genuine gateway-level failure such as a
  double-capture — raising it with the payment partner. Residents are told this plainly rather
  than being led to expect Stayo to pay.
- Beyond the floor, the hostel's own terms govern and are shown to the resident before payment.
- **Turnaround stated separately by mechanism**: gateway-level corrections follow the payment
  partner's own timeline; hostel-issued refunds follow the commitment in §12.
- **Payment partner named here**: Easebuzz, an RBI-authorised payment aggregator, referenced from
  the single `PAYMENT_PARTNER` constant.

**Drafting caution.** This part carries the highest risk of over-promising in the whole set. Every
sentence must survive the test: *can Stayo actually do this without holding the money?* Anything
that fails that test becomes an owner obligation with a stated enforcement remedy, never a Stayo
guarantee.

### 6.5 Privacy Policy

Rebuilt to DPDP 2023 shape:

- Itemised notice; a **purpose-by-purpose table** of what is collected and why.
- **Data Principal rights**: access, correction, erasure, grievance, nomination — each with the
  route that actually exercises it.
- **Retention that matches the code**: anonymise-not-erase, with the reason stated (a hostel's
  ledger is not solely the leaver's to rewrite).
- **The identity-document vault**, described as the asset it is: a document is held once, shared
  per-hostel only with the resident's consent, and revocable; verification is per-hostel so one
  owner's approval never silently verifies the document everywhere.
- **Recipient categories**, naming the payment aggregator; other processors disclosed by category
  (authentication, email delivery, media storage, messaging, hosting, caching).
- **Children**: 18+ eligibility restated; no behavioural tracking or profiling of minors.
- The "we may track your behaviour, preferences" line is **removed** as written.

### 6.6 Cookie & Tracking Notice — and why there is no banner

Verified at design time: the frontend loads **no third-party analytics or tracking pixels**
(no GA/GTM, PostHog, Mixpanel, Hotjar or Meta pixel), and the only cookie read is the auth/refresh
cookie in `src/lib/api-client.ts`. Strictly-necessary cookies require **notice, not consent**, so a
cookie consent banner is deliberately **not** built — a banner asking permission for cookies that
cannot be declined is theatre, and trains users to dismiss consent prompts.

The Cookie Notice therefore documents what is set, why, and that it is essential to signing in.

**This conclusion is load-bearing**: introducing any analytics, advertising or behavioural tracking
later changes the answer and requires revisiting this section. The `check-legal.mjs` invariant
(§13) asserts no known analytics host appears in the frontend, so the assumption fails loudly
rather than silently.

### 6.7 Payment-partner disclosure rule

- **General trust copy** (homepage, marketing, privacy summary) stays aggregator-neutral:
  "processed securely by an RBI-authorised, PCI-DSS compliant payment aggregator; card and UPI
  credentials never reach Stayo's servers."
- **Payments/Refunds policy and the privacy recipient list** name Easebuzz explicitly.
- Both read from **one constant**, `PAYMENT_PARTNER`, beside `COMPANY` in the content config.
- Claims must be verified against what is actually stored before publication: `gateway_transactions`
  keeps `provider_payment_id`, amount, status and a `raw` payload. The wording will be "we do not
  store full card numbers, CVV, PINs or banking passwords" — precise, and true even if the payload
  contains a card network or last-four.

## 7. Content architecture

`apps/frontend/src/content/legal.ts` becomes `src/content/legal/`: one typed module per document
plus a registry.

- The renderer's `block: any` (`LegalPage.tsx`) becomes an **exhaustive discriminated union**,
  extended with the blocks real legal text needs: numbered clauses with stable anchor ids, nested
  ordered/unordered lists, definition lists and tables.
- **Per-document metadata**: `{ id, title, version, effectiveDate, lastUpdated, audience, summary, material }`.
- Each document opens with a **plain-language "In short" summary**, clearly labelled as a summary
  that does not override the terms. Good UX, and DPDP asks for clear notice.

**Deleted outright** — the divergent copy still publishing "Sunrise Residency / example-hostel.in":

- `apps/backend/content/legal.ts`
- `apps/backend/app/legal/`
- `apps/backend/components/legal/`

## 8. Consent and versioning subsystem

Mirrors the existing `RuleVersion` + `TenantPolicyAcceptance` pattern rather than inventing one.

### Schema

```
platform_policy_versions
  id, policy_id, version, effective_date, content_hash,
  content_snapshot (Json), material (bool), published_at
  unique(policy_id, version)

platform_policy_acceptances
  id, profile_id, policy_version_id (FK), accepted_at,
  accepted_ip, accepted_user_agent, context
  unique(profile_id, policy_version_id)
```

`context` ∈ `SIGNUP_OWNER | ACTIVATION_TENANT | REPROMPT`.

**Open question for the plan:** FK target is `profile_id`, consistent with the rest of the schema.
The in-flight Clerk migration introduced a vendor-neutral `users` table; confirm `profile` remains
the stable app identity before writing the migration.

Storing the full `content_snapshot` once per *version* (not per user) is the deliberate choice:
proving what v1.2 said must not depend on reading git history.

### API

- `GET /api/legal/policies` — current versions plus, for an authenticated caller, which they have
  accepted and which need re-acceptance.
- `POST /api/legal/acceptances` — body `{ acceptances: [{ policy_id, version }] }`; records IP and
  user-agent server-side, never from the client.

### Drift guard

The client posts the version it displayed. The backend rejects a mismatch with
`409 POLICY_VERSION_STALE` and the UI re-prompts. Silent divergence — the exact failure that
produced the two `legal.ts` copies — becomes a loud one.

### Capture points — clickwrap, no checkboxes

The assent line sits directly against the primary button: *"By continuing, you agree to the Terms
of Use and Privacy Policy"*, with inline links.

- **Owner signup** (Clerk sign-up page).
- **Tenant activation**, at the existing `ACTIVATE` step, which already records IP and user-agent —
  marginal cost near zero.

Courts uphold this sign-in-wrap pattern where the notice is conspicuous and adjacent to the
action, and it is materially quieter than a checkbox — satisfying the "accessible, not advertised"
requirement without weakening enforceability.

**Re-prompting** happens only for versions flagged `material: true`; typo fixes never interrupt anyone.

## 9. Grievance and contact

Compose the existing substrate rather than reimplementing: `platform_support_tickets` already
handles "a problem with Stayo itself", profile-scoped and admin-resolved (ADR-079).

- **Extend it to accept unauthenticated submissions** — nullable `profile_id` plus submitted
  contact details — with a `category` of `GRIEVANCE | DATA_REQUEST | PAYMENT | OTHER`, returning a
  ticket reference to the submitter. A parent, a prospective resident, or someone exercising data
  rights with no account can then actually reach Stayo.
- ADR-079's separation is preserved: nothing here reads or writes the hostel-side ticket tables.

The Contact page becomes a real redressal surface:

- audience switch (resident / hostel owner / something else) routing to the right channel;
- the **escalation ladder** with stated timelines: Level 1 support → Level 2 Grievance Officer
  (acknowledged within 48 hours, resolved within the statutory window) → DPDP data-rights contact;
- the required entity block: legal name, proprietorship, principal place of business, phone, email.

The `mailto:` form is replaced, not decorated.

### 9.1 The Grievance Officer role — obligations and exposure

The proprietor, Chidiri Shiva Prakash, holds the role at `grievance@yourstayo.com`.

| Obligation | Source | Window |
|---|---|---|
| Acknowledge a complaint | IT Rules 2021, r.3(2)(a) | 24 hours |
| Dispose of the complaint | IT Rules 2021, r.3(2)(a) | 15 days |
| Acknowledge a consumer complaint | Consumer Protection (E-Commerce) Rules 2020 | 48 hours |
| Redress a consumer complaint | Consumer Protection (E-Commerce) Rules 2020 | 1 month |
| Remove specified unlawful content on complaint (impersonation, non-consensual imagery) | IT Rules 2021, r.3(2)(b) | 24 hours |
| Publish name and contact; maintain records | IT Rules 2021 / CP E-Commerce Rules | ongoing |
| Answer Data Principal requests | DPDP Act 2023 | per the DPDP rules |

**Exposure is bounded.** Stayo is a regular intermediary, **not** a Significant Social Media
Intermediary (that threshold is 50 lakh registered users). The personal criminal liability people
associate with this area attaches to the *Chief Compliance Officer* of an SSMI under r.4(1)(a) and
does not apply here. For a regular intermediary the consequence of failing is loss of safe harbour
under s.79 of the IT Act for the specific content, plus consumer-forum exposure — business risk,
not personal criminal risk. And as a sole proprietor the founder already carries unlimited
personal liability for the business, so naming himself adds no meaningful incremental exposure.

**The design discharges most of the burden automatically.** The ticket intake (§9) returns an
immediate acknowledgement with a reference number, which satisfies the 24- and 48-hour
acknowledgement obligations without manual action, and the ticket table is the required record.
What remains genuinely manual is the 15-day resolution.

**The one real hazard is publishing a channel nobody monitors.** An unwatched `grievance@` is
worse than none — it is documented non-compliance with a timestamp on it. The role must not be
published until the inbox is monitored.

## 10. UI/UX — accessible, not advertised

- **One footer.** `MarketingFooter` and `PublicLayout` currently carry different, inconsistent link
  sets, including a "Cookie Policy" pointing at the privacy page. Both derive from the policy
  registry, so adding a document adds the link everywhere at once. Muted, single quiet row.
- **`/legal` becomes a document library**, not six equal cards: sticky document rail (collapsing to
  a picker on mobile), the "In short" card atop each policy, version and effective-date badge,
  auto-generated sticky table of contents, and **per-clause deep links** (`#clause-4-2`) so support
  can point someone at an exact clause. Print/PDF stylesheet, because disputes and aggregator
  reviews want a printable copy. Theme-aware, per the existing `ThemeProvider`.
- **In-app, quiet.** Owner: the scattered rows in `MoreHelpPage` collapse into one
  "Legal & policies" row. Tenant app: currently has **no policy access at all** — gets the same
  single row in its Profile hub.
- **Contextual links at the moment of relevance** — a small "Refund policy" link beside payment
  CTAs, "How we use your documents" beside document upload. This is what actually satisfies
  "accessible but not highlighted": the link appears where it is wanted, so the footer never has
  to shout.

## 11. Verification readiness

The spec carries a checklist mapping each reviewer requirement to the page that satisfies it,
covering both Easebuzz merchant onboarding and Meta Business Verification. Two gaps it surfaces:

- **No public pricing page.** Aggregator onboarding generally expects visible pricing for a
  subscription product; a `subscription_plans` catalog exists with nothing public rendering it.
  Whether to publish prices is a product decision — flagged, not assumed.
- **Proprietorship proof for Meta.** With no GST certificate, Meta Business Verification for a sole
  proprietorship typically wants Udyam registration, a Shop & Establishment licence, or a
  bank-issued certificate. Does not affect the documents; does affect the launch timeline.

## 12. Placeholders the proprietor must supply

Built with clearly-marked placeholders, and the invariant script (§13) fails the build while any
remain:

- ~~proprietor's legal name~~ — **supplied**: Chidiri Shiva Prakash;
- ~~principal place of business~~ — **supplied**: 12-75/1, Balaji Nagar, Block 2, Kodangal,
  Vikarabad District, Telangana 509338;
- ~~Grievance Officer~~ — **supplied**: Chidiri Shiva Prakash, `grievance@yourstayo.com`;
- ~~jurisdiction~~ — **settled**: Hyderabad, drafted **non-exclusive** for the nexus reason in
  §6.1. Establishing an actual Hyderabad place of business would let it be tightened to exclusive
  and is recommended;
- ~~revenue share~~ — **settled**: the owner subscription is Stayo's **only** revenue; it takes no
  share of transaction fees or TDR on resident payments. The terms state this affirmatively —
  *Stayo earns nothing from your rent* — which is a genuine trust asset and forecloses any
  suggestion that Stayo profits from payment volume. If the Easebuzz commercials ever change to
  include a share, this claim must change with them;
- support hours and Level 1 response SLA;
- subscription trial length, and whether subscription fees are refundable on mid-cycle cancellation;
- the refund-floor turnaround Stayo commits to;
- confirmation of the liability floor for residents (§6.1 proposes ₹5,000).

## 13. Cleanups, invariants and go-live prerequisites

**Cleanups folded in**

- Remove or relabel the `gst-tax-report.csv` export asserting 18% GST on an unregistered
  proprietorship's revenue.
- Delete the stale backend legal tree (§7).

**New invariant script** — `apps/frontend/scripts/check-legal.mjs`, in the style of the existing
`check-architecture.mjs` and wired into the same build step, asserting:

1. every registry document has a version, effective date, summary and a live route;
2. no unresolved placeholder remains in published copy;
3. no payment-provider name appears outside the `PAYMENT_PARTNER` constant;
4. every alias route in §5 resolves;
5. no known third-party analytics host appears in the frontend (guards §6.6).

**Go-live prerequisites (blocking, not optional)**

1. **Easebuzz integration must land before real money is taken** through the published policy.
   The code captures through Razorpay today and Easebuzz appears nowhere in the codebase.
   Naming the intended aggregator before integration is normal — Easebuzz reviews the site before
   approving the merchant account — but the swap must complete before production traffic.
2. Placeholders in §12 resolved.

## 14. Risks and recommendations outside this scope

**Resolved 2026-09-10 by the sub-merchant model (§2.1)** — recorded because the reasoning matters
if the model ever changes:

- ~~**Payment-aggregator regulation.**~~ Resolved. Stayo neither collects nor settles third-party
  funds; Easebuzz is the authorised aggregator and each owner is the merchant of record.
- ~~**GST threshold contamination.**~~ Resolved. Rent never reaches the proprietor's account.

**Still live:**

- **Entity form.** A sole proprietorship carries unlimited personal liability, and switching to an
  LLP or private limited company later means re-onboarding with the aggregator, re-papering owner
  contracts, and every user re-accepting terms under a different counterparty. Doing it **before**
  the consent subsystem (§8) starts recording acceptances is materially cheaper than after.
- **Aggregator dependency.** Suspension of Stayo's partner account, or of an owner's sub-merchant
  account, is now a single point of failure for the payment path. The terms must reserve the right
  to suspend on the partner's instruction (§6.2) rather than leaving Stayo in breach of its own
  promises when that happens.

## 15. Testing

Frontend tests are node-environment only, matching `src/**/*.test.ts` with no jsdom and no
component rendering — so decision logic goes in pure `.ts` modules and components stay thin.

- **Frontend (pure):** registry completeness (every document has required metadata); block-union
  validity; which policies require re-acceptance given a set of accepted versions; alias-route
  resolution.
- **Backend (vitest):** acceptance service records IP/user-agent server-side; duplicate acceptance
  is idempotent per (profile, version); stale version yields `409 POLICY_VERSION_STALE`;
  unauthenticated grievance submission creates a ticket with a null `profile_id` and returns a
  reference; ADR-079 separation holds (no write reaches hostel-side ticket tables).
- **Invariant script** runs in the build, per §13.

## 16. Documentation obligations

Per the repository documentation rule, the implementing change must also update
`docs/obsidian/Features.md`, `docs/obsidian/APIs.md` (new legal + grievance endpoints),
`docs/obsidian/Database.md` (two new tables), `docs/obsidian/Business-Rules.md` (refund floor,
18+ eligibility, payout terms as published), `docs/obsidian/Decisions.md` (an ADR recording D1–D6),
and `docs/obsidian/Changelog.md`.

## 17. Suggested phasing

This design is large enough that the implementation plan should sequence it into independently
shippable phases rather than one change. Each phase leaves the product in a coherent state.

**Phase 1 — Documents and content architecture.** The typed content registry, all seven documents,
the `PAYMENT_PARTNER` constant, deletion of the stale backend legal tree, the GST-export cleanup,
and `check-legal.mjs`. Ships the legally correct text with the existing renderer. *This is the
phase that unblocks Easebuzz and Meta verification*, so it should land first and alone.

**Phase 2 — Legal UI/UX.** The document-library `/legal`, unified footer, in-app rows for owner and
tenant, contextual links, print stylesheet.

**Phase 3 — Grievance intake.** Extending `platform_support_tickets` to unauthenticated
submissions, and rebuilding the Contact page onto it. Removes the `mailto:` gap.

**Phase 4 — Consent and versioning.** The two tables, the API, the clickwrap capture points and
re-prompt flow. Deliberately last: it is the largest change, it touches the in-flight Clerk signup
work, and it is the only phase with a schema migration — but note that acceptance evidence only
starts accruing from the day it ships, which is an argument against deferring it long.
