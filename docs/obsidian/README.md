---
tags:
  - homepage
  - hms
---

# HMS Documentation Home

This is the living documentation workspace for the Hostel Management System (HMS), meant to be opened as an **Obsidian vault** rooted at `docs/obsidian/`. Unlike the reference "rebuild map" under `docs/` (aimed at a future rebuild, and in places out of date — see the discrepancies noted in [[Database]] and [[APIs]]), this vault is a **working log**, and as of this pass, the most current single source of truth for architecture, backend/frontend structure, schema, APIs, and business rules — every page below was written by directly reading the code, not by summarizing `docs/`.

## Codebase audit — what this vault currently reflects

[[Architecture]], [[Backend]], [[Frontend]], [[Database]], [[APIs]], [[Business-Rules]], [[Features]], and [[Decisions]] were rebuilt from a full pass over `apps/backend/` (294 API route files, ~140 service files, the full 2426-line `prisma/schema.prisma`) and `apps/frontend/` (full `src/` tree, routing, feature/domain structure). The instruction behind that pass was: **document only what's verifiable in code; mark anything else "Unknown / needs clarification."** You'll find several such flags scattered through these pages — they're real gaps, not filler, and worth resolving with the team rather than guessing.

## Map of contents

- [[Architecture]] — system shape, request flow, service-tree domain split, enforced invariants
- [[Backend]] — `apps/backend/` service layer, domain placement, test-coverage gaps
- [[Frontend]] — `apps/frontend/` routing, the `features/` → `domains/` migration in progress, the frozen `portal/` tree
- [[Database]] — full model/enum/relation inventory, schema-vs-docs discrepancies
- [[APIs]] — all 294 routes, grouped by module, including the 37 decommissioned (410) routes
- [[Business-Rules]] — late-fee math, obligation lifecycle, payment allocation, settlement, notification triggers — all traced to source
- [[Features]] — confirmed-implemented features, owner/tenant/public-facing, cross-referenced to routes and screens
- [[Decisions]] — ADRs inferred from migration names, invariant checks, and in-code comments
- [[Bugs]] — bug reports, open and fixed
- [[TODO]] — running backlog, including this audit's flagged unknowns
- [[Changelog]] — Keep a Changelog-format history
- [[Performance]] — measured backend latency baselines (region pin, Prisma relation load strategy) and what remains unmeasured

## Quick reference — what to read before touching what

Read the relevant row **before** writing code, not after — these pages exist to save you from re-deriving things by grepping cold.

| About to... | Read first |
|---|---|
| Touch payments, obligations, ledger, or settlement logic | [[Business-Rules]] (late-fee, obligation lifecycle, allocation, settlement sections) + [[Database]] (`rent_obligations`, `payments`, `payment_groups`, `tenant_financial_ledger`) + [[APIs]] (Payments / Payment Obligations sections) |
| Add, change, or remove an API route | [[APIs]] for existing patterns and naming/auth conventions + [[Backend]] to know which service tree (`lib/services` vs `src/services`) the domain belongs in |
| Change `prisma/schema.prisma` or write a migration | [[Database]] in full, including the "known schema quirks" section so you don't recreate an existing near-duplicate table |
| Work on `apps/frontend` owner screens | [[Frontend]] (routing tree, `features/` vs `domains/` split) + [[Features]] |
| Work on the tenant portal | [[Frontend]] — **read the frozen `src/portal/` allowlist section before adding any file there** — + [[Features]] |
| Touch move-out / exit / settlement | [[Business-Rules]] (Settlement section) + [[Database]] (`move_out_requests` + satellite tables) |
| Touch WhatsApp, email, or reminders | [[Business-Rules]] (Notification triggers) + [[Backend]] (Notification services section) |
| About to make a call with long-term architectural consequences | [[Decisions]] first, to check whether a prior ADR already covers this; add a new one when you decide |
| Just fixed something that revealed a real design gap | [[Bugs]] |
| Investigate or change backend latency / query performance | [[Performance]] — read the measured baselines and the "not yet measured" list before optimising anything, so you're not guessing at where the time goes |
| Not sure where something lives at all | [[Architecture]] first — it links onward to the right specific page |

## How this vault is meant to be used

1. **Read before you code.** Per CLAUDE.md, check this vault (starting from the Quick Reference above) before exploring the codebase cold for any non-trivial task — it's frequently faster and more current than reading the implementation from scratch.
2. **Claude keeps it current.** Per the "Documentation Rules" section in [CLAUDE.md](../../CLAUDE.md), any feature implementation, API change, schema change, business-rule change, significant refactor, or important bug fix must be reflected here in the same change — update after you finish, every time, not just when convenient.
3. **Cross-link liberally.** Use `[[Wiki Links]]` between notes so Obsidian's Graph View stays connected.
4. **Treat "Unknown" flags as real work items, not decoration.** Several pages here flag things that couldn't be verified from code alone (e.g. which of two near-duplicate services is canonical, whether a table is still live). If you resolve one while working, update the page to remove the flag — don't leave it stale once you know the answer.
5. **This complements, not replaces, `docs/`.** `docs/` remains useful for narrative/onboarding context; this vault is now the more current reference for exact current schema/API/service shape — see the explicit discrepancy lists in [[Database]] and [[APIs]] if the two disagree.

## Repo orientation

| Tree | Role |
|---|---|
| `apps/backend/` | Canonical API — Next.js 14 App Router + Prisma + Postgres (Supabase) |
| `apps/frontend/` | Canonical UI — Vite + React 19 SPA (public site, owner app, tenant portal) |
| `frontend/`, `temp-ui/`, `backend/` | Legacy / reference only, not deploy targets |
| `migrations/` | Legacy hand-written SQL, archived — Prisma (`apps/backend/prisma/migrations/`) is now the single source of truth for schema changes |
| `docs/` | Curated rebuild map — partially out of date, see [[Database]] §6 and [[APIs]] for specifics |

See [[Architecture]] for the full picture.
