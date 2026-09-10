import type { TenantImportRow } from "../bulk-import-validation-service";

/**
 * What is persisted for a validated row.
 *
 * This is an allowlist, deliberately — nothing secret may reach
 * `bulk_import_rows.mapped_data` / the batch's `validation_errors` JSON. It
 * previously omitted every financial term beyond rent and deposit (and, in a
 * second round, `rent_source`), so maintenance, the already-paid amount, and
 * which rent value actually won stayed only in the preview and were
 * discarded before confirm could ever see them.
 *
 * Both `upload/route.ts` and `revalidate/route.ts` create a
 * `bulk_import_rows` row from this same function's output — previously each
 * kept its own copy, and a fix applied to one silently left the other
 * broken. Import this one copy from both call sites so they cannot drift
 * apart again.
 */
export function sanitizeImportRowForStorage(row: TenantImportRow): Partial<TenantImportRow> {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    room_no: row.room_no,
    room_id: row.room_id,
    monthly_rent: row.monthly_rent,
    advance_deposit: row.advance_deposit,
    security_deposit: row.security_deposit,
    maintenance_charge: row.maintenance_charge,
    maintenance_type: row.maintenance_type,
    agreement_duration_months: row.agreement_duration_months,
    amount_paid: row.amount_paid,
    amount_includes_deposit: row.amount_includes_deposit,
    payment_method: row.payment_method,
    payment_reference: row.payment_reference,
    joining_date: row.joining_date,
    rent_source: row.rent_source,
    notes: row.notes,
  };
}
