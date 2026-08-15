# The portable Stayo profile — Phase B

**Date:** 2026-08-15
**Status:** Approved design, implementing
**Builds on:** `2026-08-15-discovery-phase-a-design.md` (phase A shipped the account; this makes it portable)

---

## 1. Why

A person's identity data — date of birth, guardian, college, permanent address, and every uploaded ID — lives on `tenants`, which since migration 062 is **one row per tenancy per hostel**. Documents are worse: `identification_documents.tenant_id` ties an uploaded ID to a single tenancy.

So moving to a second hostel means re-entering everything and re-uploading every document, even though Stayo already holds it all. Phase A gave a person a durable Stayo account; it is still an empty shell.

**The primary requirement, stated by the owner:** a tenant must be able to complete their profile **before enquiring to any hostel at all**, and onboarding must then read it as defaults rather than asking again. The profile is not a byproduct of onboarding — it is the thing onboarding reads.

Out of scope, confirmed: parent/guardian logins. Guardian remains fields on the tenant's own profile, not a second account with its own access.

---

## 2. Identity lives beside `profiles`, not inside it

New **`profile_identity`**, 1:1 with `profile`:

`date_of_birth`, `gender`, `nationality`, `pan_number`, `permanent_address`, `photo_url`, `guardian_name`, `guardian_phone`, `guardian_relation`, `personal_email`, `profile_type`, `college_name`, `roll_number`, `course`, `year_of_study`, `branch`, `section`, `office_name`, `office_location`, `job_role`.

**Not columns on `profiles`, and this is load-bearing.** `getSession()` reads a profile on every authenticated request for every role, and Prisma selects the full column set on any query without an explicit `select`. That is exactly the mechanism that took production down on 2026-08-14: a `tenants` column present in `schema.prisma` but absent from the database 500'd the entire authenticated API, not just the screen that used it. Putting eighteen rarely-read columns on the hottest table in the system buys that risk for no benefit.

A separate table also gives the vault a natural home for a `completed_at` / completeness notion without polluting `profiles.is_profile_completed`, which already means something else (account setup, checked by `ProtectedTenantRoute`).

---

## 3. `tenants` keeps its columns — as a snapshot

The existing `tenants.*` identity columns stay, and stop being canonical. They become **what was true when that tenancy began**.

Reads are profile-first with a tenancy fallback for the transition window, so this is not a big-bang cutover and a half-migrated row still renders.

This also fixes a real defect rather than routing around it. `agreement-generation-service.ts` snapshots most contractual values into `content_snapshot`, but reads `tenant.permanent_address` **live**. Once addresses are person-level and editable from a profile screen, regenerating an old agreement's PDF would print an address the signatory never agreed to. Phase B snapshots it at signing and reads the snapshot first.

---

## 4. Documents: one vault, shared per hostel

Decided explicitly (the prototype contradicts itself — its verify screen promises "shared only with the owner you enquire to", its profile screen promises "verified once, reuse anywhere"; only one can be the default).

**`identity_documents`** — person-level. The file, uploaded once: `profile_id`, `doc_type`, `file_url`, `file_path`, `file_id`, `mime_type`, `file_size`, `doc_number`, `is_active`.

**`identity_document_shares`** — one row per (document, hostel): `status` (`PENDING`/`VERIFIED`/`REJECTED`), `verified_by`, `verified_at`, `rejected_by`, `rejected_at`, `rejection_reason`, `granted_at`, `revoked_at`, and `tenant_id` where one exists.

**Verification state lives on the share, never on the document.** That is the whole point: Owner A's decision must not silently become Owner B's. The tenant uploads once; each owner still verifies for their own tenancy, exactly as they do today.

Existing `identification_documents` rows migrate to one `identity_documents` row plus one share carrying their current verification state, so no owner loses a verification they have already made.

Access rule: an owner sees a document only through a live (non-revoked) share for a hostel they own.

---

## 5. Owner edits to person-level fields become proposals

`field-classification.ts` currently places `college_name`, `roll_number`, `course`, `year_of_study`, `branch`, `section`, `office_name`, `office_location`, `job_role`, `profile_type`, `photo_url`, `gender`, `date_of_birth` in **Category A** — owner edits apply immediately, audit log only.

Once those are person-level, a Category A edit by one owner rewrites the person's record everywhere, including at a hostel that owner has no relationship with. So they move to **Category B** — owner proposes, tenant approves — which is the category already built, already wired to the change-request machinery, and already named "Shared Profile Data".

Tenancy-scoped fields keep Category A: `document_verified`, `profile_completed`, `mobile_verified` describe *this tenancy*, not the person.

**Accepted cost, named at design time:** owners lose immediate edit on academic and personal fields. This was raised explicitly and approved.

---

## 6. Prefill — the point of the phase

1. A signed-in seeker completes their profile at `/discover/profile` with **no hostel involved**, before any enquiry.
2. Tenant activation reads `profile_identity` and pre-fills every step it can, showing what is already known instead of an empty form. The tenant confirms or corrects.
3. Confirmation writes the tenancy snapshot **and** writes corrections back to `profile_identity`, so a first-time user who filled onboarding rather than the profile screen still has their second hostel prefilled.

Write-back is deliberately last-write-wins on non-null values only: onboarding must never blank a profile field the person filled earlier and this form did not ask about.

---

## 7. Backfill has a genuine conflict to resolve

A person with two past tenancies can hold two different `college_name` values, and there is no universally correct winner.

Rule: prefer the **live** tenancy (`liveTenancyWhere`); else the most recent by `created_at`; per field; skipping nulls, so a populated older value is not overwritten by a newer null.

Delivered as a **script with `--dry-run` as the default**, reporting every conflict it resolved and every value it discarded, rather than an inline `UPDATE` in the migration. The losing values stay inspectable — `tenants` keeps its columns (§3), so nothing is destroyed.

---

## 8. Risks

| Risk | Handling |
|---|---|
| A half-migrated row renders blank | Profile-first read with tenancy fallback (§3), not a cutover |
| Cross-hostel document leak | Access only via a live share for a hostel the caller owns; asserted by test |
| Owner surprised by losing immediate edits | §5, raised and approved before building |
| Old agreements re-render with new addresses | Snapshot at signing, read snapshot first (§3) |
| Backfill picks the wrong value | Dry-run default, conflicts reported, source data retained |
| `profiles` bloat / session cost | Separate table (§2) |

**Verification:** `DATABASE_URL_TEST` points at the same Supabase project as dev (an unfixed collision recorded in the vault), so migration and backfill will be reported as **unverified against a live database** unless a real test database is provided. Behaviour is pinned with the repo's mocked-Prisma pattern.

---

## 9. Documentation

`docs/obsidian/`: [[Database]] (three tables, the snapshot rule), [[APIs]] (profile + vault routes), [[Business-Rules]] (Category A→B reclassification, document access rule), [[Decisions]] (an ADR for the vault/sharing model), [[Features]], [[Changelog]].
