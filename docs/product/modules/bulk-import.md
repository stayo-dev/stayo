# Bulk Import

## What this does

Bulk import helps owners upload tenant data, validate rows, preview errors, and confirm valid tenant creation. It supports Google Form style data recovery and import workflows.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Bulk import upload | Accepts source file | Upload status and validation trigger |
| Google Form prompt | Generates import guidance | Prompt text and notes |
| Batch confirmation | Reviews parsed rows | Valid rows, invalid rows, duplicates, errors |

## Data it needs

- `bulkImportService.generateGoogleFormPrompt({ hostelId, notes })`.
- `bulkImportService.uploadTenantIdentityFile(formData)`.
- `bulkImportService.getBatchPreview(batchId)`.
- `bulkImportService.confirmBatchImport(batchId)`.
- Backend validation from `bulk-import-validation-service`.

## Data it produces

- `bulk_import_batches` records.
- Imported `profile`, `tenants`, `roomAllocation`, and obligation records.
- Validation error JSON.
- Import summary JSON.

## Key components

- v2 exposes bulk import services through `features/owners/api`.
- Legacy `frontend/src/pages/owner/BulkImport.jsx` shows older UI behavior.
- Legacy `BulkImportConfirm.jsx` shows confirmation workflow evidence.

## Business logic in this module

- Batches track total, valid, failed, imported, and duplicate row counts.
- Imported tenants can create rent obligations immediately.
- Validation errors are stored on the batch before confirmation.

## How this works (step by step)

1. The owner uploads a file for one hostel.
2. Backend creates a bulk import batch.
3. Validation stores row-level errors and summary counts.
4. The owner reviews the batch preview.
5. Confirmation imports valid rows and updates the batch status.

## How to reuse this for a new client

- Keep batch validation before database writes.
- Customize accepted spreadsheet columns.
- Seed room and hostel records before importing tenants.
- Run a small import before the full client migration.

**How this works:**
1. Upload creates a reversible staging record.
2. Confirmation performs real tenant creation.
3. The owner avoids corrupting production data with bad rows.

> **Needs clarification:** `apps/frontend` has service wrappers for bulk import, but visible v2 bulk import pages were not found. Legacy `frontend/` contains the strongest UI evidence.

