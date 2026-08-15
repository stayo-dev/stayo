-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 064: The portable Stayo profile (phase B)
--
-- Identity and documents stop belonging to a tenancy and start belonging to a
-- person, so a tenant fills them in once — before enquiring anywhere — and
-- every later onboarding reads them as defaults.
--
-- 1. profile_identity  — person-level identity, 1:1 with profiles.
-- 2. identity_documents — the document vault. Uploaded once, owned by the person.
-- 3. identity_document_shares — per-hostel access AND per-hostel verification.
--
-- Three things this migration deliberately does NOT do:
--
--   * It does not add columns to `profiles`. That table is read by getSession()
--     on every authenticated request for every role, and Prisma selects the
--     full column set on any query without an explicit `select` — the exact
--     mechanism that took production down on 2026-08-14.
--   * It does not drop or alter any `tenants` identity column. Those become the
--     tenancy-time snapshot (and the backfill's audit trail), not dead weight.
--   * It does not backfill. See scripts/backfill-profile-identity.ts, which is
--     dry-run by default because a person with two past tenancies can hold two
--     conflicting values and there is no universally correct winner.
--
-- See docs/superpowers/specs/2026-08-15-portable-profile-phase-b-design.md
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Person-level identity ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profile_identity (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         uuid        NOT NULL UNIQUE REFERENCES profiles (id) ON DELETE CASCADE,

  -- Personal
  date_of_birth      date,
  gender             text,
  nationality        text,
  pan_number         text,
  permanent_address  text,
  photo_url          text,
  personal_email     text,

  -- Guardian. Fields on the tenant's own profile — NOT a second account.
  -- Parent/guardian logins are explicitly out of scope.
  guardian_name      text,
  guardian_phone     text,
  guardian_relation  text,

  -- STUDENT | WORKING_PROFESSIONAL. Plain text, matching this schema's
  -- convention for descriptive statuses; it drives which documents are
  -- required (see requiredDocumentTypes in the document routes).
  profile_type       text        NOT NULL DEFAULT 'STUDENT',

  -- Academic
  college_name       text,
  roll_number        text,
  course             text,
  year_of_study      integer,
  branch             text,
  section            text,

  -- Professional
  office_name        text,
  office_location    text,
  job_role           text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

-- ── 2. The document vault ────────────────────────────────────────────────────
-- One row per file the person has uploaded, ever. No hostel, no tenancy: those
-- live on the share below.

CREATE TABLE IF NOT EXISTS identity_documents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  doc_type    text        NOT NULL,
  doc_number  text,
  file_url    text        NOT NULL,
  file_path   text,
  file_id     text,
  mime_type   text        NOT NULL,
  file_size   integer     NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_identity_documents_profile_type
  ON identity_documents (profile_id, doc_type, is_active);

-- ── 3. Per-hostel access and verification ────────────────────────────────────
-- Verification state lives HERE, never on the document. That is the whole
-- point of the model: one owner's decision must not silently become another's.

CREATE TABLE IF NOT EXISTS identity_document_shares (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_document_id uuid        NOT NULL REFERENCES identity_documents (id) ON DELETE CASCADE,
  hostel_id            uuid        NOT NULL REFERENCES hostels (id) ON DELETE CASCADE,
  -- Present once the share belongs to a real tenancy; null while the person is
  -- only an applicant.
  tenant_id            uuid        REFERENCES tenants (id),

  status               text        NOT NULL DEFAULT 'PENDING',  -- PENDING | VERIFIED | REJECTED
  verified_by          uuid        REFERENCES profiles (id),
  verified_at          timestamptz,
  rejected_by          uuid        REFERENCES profiles (id),
  rejected_at          timestamptz,
  rejection_reason     text,

  granted_at           timestamptz NOT NULL DEFAULT now(),
  -- Set instead of deleting, so a revoked share stays auditable: an owner who
  -- once verified a document must remain attributable after access ends.
  revoked_at           timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz
);

-- One share per document per hostel. Re-granting reactivates the existing row
-- rather than stacking duplicates with conflicting verification states.
CREATE UNIQUE INDEX IF NOT EXISTS identity_document_shares_doc_hostel_key
  ON identity_document_shares (identity_document_id, hostel_id);

-- The owner-side read: "documents shared with this hostel, still live".
CREATE INDEX IF NOT EXISTS idx_identity_document_shares_hostel_status
  ON identity_document_shares (hostel_id, status)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_identity_document_shares_tenant
  ON identity_document_shares (tenant_id)
  WHERE tenant_id IS NOT NULL;
