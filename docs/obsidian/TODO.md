---
tags: [todo, backlog]
---

# TODO / Backlog

Related: [[Bugs]] · [[Features]] · [[Decisions]]

Running backlog of documentation and follow-up work. Not a replacement for a real issue tracker — use this for things worth remembering across sessions that don't have a ticket yet.

## Documentation backlog

- [ ] Add real ER diagram to [[Database]] (relation table exists, not yet rendered as a diagram).
- [ ] Add sequence/state diagrams listed as TODO in [[Architecture]] (move-out state machine is a good first Mermaid `stateDiagram-v2` candidate — full graph is already written out in [[Business-Rules]]).
- [ ] Refresh `docs/data-models/schema.md` and `docs/data-models/enums.md` — confirmed stale against the live schema (19 undocumented models, 13 undocumented enums, `AdvanceLedgerReason`/`AdvanceLedgerType` renamed to `FinancialLedgerReason`/`FinancialLedgerType` without the docs catching up). See [[Database]] §6.

## Unknowns flagged during the 2026-07-18 codebase audit (need team clarification, not guesses)

- [ ] `lib/services/activity-service.ts` vs `activity.service.ts` — two near-duplicate `ActivityService` classes; which is canonical? See [[Backend]].
- [ ] Which of the four overlapping "financial issue" tables (`financial_invariant_failures`, `payment_operational_anomalies`, `payment_reconciliation_items`, `financial_reconciliation_issues`) is currently authoritative? See [[Database]].
- [ ] `paymentAttempt`'s two generations of provider-reference fields (`merchant_txn_id`/`gateway_txn_id` vs `merchant_transaction_id`/etc.) — which is canonical at the code level? See [[Database]].
- [ ] Whether rent is prorated anywhere for partial-month billing (not found in `lib/billing/engine.ts`) — check `agreement-rent-schedule-service.ts`. See [[Business-Rules]].
- [ ] **Decide what renewal's `KEEP_AS_CREDIT` deposit policy should do** now that future rent credit is gone from the payment path ([[Decisions#ADR-036|ADR-036]]). `renewal-offer-service.ts` is the only remaining writer of `FUTURE_RENT_CREDIT_TOPUP` — it carries an excess security deposit forward at renewal. Options: settle it against the next installment(s), force `REFUND`, or keep it as the one legitimate credit.
- [ ] Full enumeration of owner-side WhatsApp assistant commands (only `HELP`/`DUES` confirmed; the assistant uses ID-based interactive menus, not a flat command table like the tenant side). See [[Business-Rules]].
- [ ] Whether `components/landing-v2/*` or `components/marketing/*` is the live marketing component set in `apps/frontend` — both exist with overlapping names. See [[Frontend]].
- [ ] Whether `apps/frontend/src/services/index.ts` (root barrel) still has any consumers, or is dead. See [[Frontend]].
- [ ] Three routes with no auth guard found in code (`GET /api/owner/integrity`, `GET /api/metrics`, `GET /api/debug/whatsapp-health`) — confirm intentionally public/internal vs. a real gap. See [[APIs]].
- [ ] `/api/owners/invitations` vs `/api/tenants/invite` — near-duplicate routes calling the same service; consolidate or document why both exist. See [[APIs]].

## Known follow-up work (carried from [[Bugs]])

- [ ] Fix manual ledger POST route (`/api/tenants/[id]/financial-ledger`) enum validation mismatch — see [[Bugs]].
- [ ] Live-database audit for tenants with stale simultaneous Outstanding + Future Credit — see [[Bugs]].

## Template

```markdown
- [ ] <task> — **why:** <reason> — **related:** [[links]]
```

## See also
- [[Bugs]] for the open issues these tasks often trace back to
- [[Changelog]] for what's already been done
