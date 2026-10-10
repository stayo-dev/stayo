/**
 * The guardian an owner can supply in the import workbook — Guardian Name and
 * Guardian Phone — so the tenant is not asked for them again at onboarding.
 *
 * Onboarding already prefills every screen from the tenancy record — the
 * activation context returns `tenants.*` and the screens read it. What was
 * missing is a way for the import to *put* these details on the record:
 * `createInvitation` takes name, phone, room and money terms only. So the
 * confirm step writes these fields onto the new tenancy right after it is
 * created, through `tenantPrefillData` below.
 *
 * Every value is validated by the **same rules onboarding enforces**
 * (`activation-workflow-service.saveGuardian`), so an import
 * can never store something the tenant's own screen would have refused.
 *
 * What this never does:
 * - touch agreement, signature, rules-acceptance, activation or KYC fields —
 *   the tenant still reviews and signs the agreement themselves;
 * - collect a photo or documents (they cannot come from a spreadsheet), or
 *   any other personal detail — gender, tenant type, guardian relation, date
 *   of birth, college/office, address stay with the tenant at onboarding
 *   (product decision, 2026-10-10);
 * - mark anything verified. The one consequence of import data for
 *   verification is the guardian rule in `guardianSuppliedByImport`, which is
 *   keyed to *this tenancy's own import row*, never to a number merely being
 *   on file.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */
import { indianPhoneKey } from "./identity";

/**
 * `normalizeIndianPhone` from `lib/utils/phone-utils`, restated — the same
 * rule onboarding stores guardian numbers with (`+91` + 10 digits starting
 * 6–9). Restated rather than imported because `phone-utils` also imports the
 * database client, and this module must stay pure: the template builder and
 * parser import it, and their tests run with no database. A parity test in
 * `tests/bulk-import-onboarding-prefill.test.ts` pins the two together.
 */
export function normalizeIndianPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = String(value).replace(/\D/g, "");
  let tenDigits = "";
  if (cleaned.length === 10) tenDigits = cleaned;
  else if (cleaned.length === 12 && cleaned.startsWith("91")) tenDigits = cleaned.substring(2);
  else if (cleaned.length === 13 && cleaned.startsWith("091")) tenDigits = cleaned.substring(3);
  else if (cleaned.length === 11 && cleaned.startsWith("0")) tenDigits = cleaned.substring(1);
  else return null;
  return /^[6-9]\d{9}$/.test(tenDigits) ? `+91${tenDigits}` : null;
}

/** The owner-supplied values, as stored in `bulk_import_rows.mapped_data`. */
export interface ImportedProfileFields {
  guardian_name?: string;
  guardian_phone?: string;
}

export const PROFILE_FIELD_KEYS = ["guardian_name", "guardian_phone"] as const satisfies readonly (keyof ImportedProfileFields)[];

/**
 * Accepted headers for each field. The first is what the template prints;
 * the rest are spellings owners use in files they make themselves.
 */
export const PROFILE_COLUMNS: Record<keyof ImportedProfileFields, string[]> = {
  guardian_name: ["Guardian Name", "guardian_name", "Parent Name", "parent_name"],
  guardian_phone: ["Guardian Phone", "guardian_phone", "Parent Phone", "parent_phone", "Guardian Mobile"],
};

/** Labels the template prints for these columns. */
export const PROFILE_HEADERS = PROFILE_FIELD_KEYS.map((key) => PROFILE_COLUMNS[key][0]);

const TEXT_LIMIT = 200;

function readCell(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

/** Reads the guardian columns of one raw sheet row. Blank cells are absent. */
export function readProfileCells(row: Record<string, any>): ImportedProfileFields {
  const out: ImportedProfileFields = {};
  for (const key of PROFILE_FIELD_KEYS) {
    const value = readCell(row, PROFILE_COLUMNS[key]);
    if (value) out[key] = value;
  }
  return out;
}

export type ProfileProblem = {
  code: "GUARDIAN_PHONE_INVALID" | "GUARDIAN_PHONE_IS_TENANT" | "TEXT_TOO_LONG";
  field: keyof ImportedProfileFields;
  value: string;
};

/**
 * Checks the owner's guardian cells. Both are optional — a blank is filled in
 * by the tenant at onboarding — but a value that *is* given must be one
 * onboarding would accept, or the row stops until it is fixed or cleared.
 */
export function profileProblems(
  fields: ImportedProfileFields,
  context: { tenantPhone: string | null | undefined; today?: Date },
): ProfileProblem[] {
  const problems: ProfileProblem[] = [];
  if (fields.guardian_phone) {
    const guardian = normalizeIndianPhone(fields.guardian_phone);
    if (!guardian) {
      problems.push({ code: "GUARDIAN_PHONE_INVALID", field: "guardian_phone", value: fields.guardian_phone });
    } else if (context.tenantPhone && indianPhoneKey(guardian) === indianPhoneKey(context.tenantPhone)) {
      // `saveGuardian` refuses a guardian who is the tenant — so does this.
      problems.push({ code: "GUARDIAN_PHONE_IS_TENANT", field: "guardian_phone", value: fields.guardian_phone });
    }
  }
  if (fields.guardian_name && fields.guardian_name.length > TEXT_LIMIT) {
    problems.push({ code: "TEXT_TOO_LONG", field: "guardian_name", value: fields.guardian_name });
  }
  return problems;
}

/**
 * The normalised values confirm writes: a trimmed name and the guardian
 * number as onboarding stores it (`+91` + 10 digits). An invalid value never
 * reaches confirm — its row is blocked at preview.
 */
export function normalizeProfileFields(fields: ImportedProfileFields, _today?: Date): ImportedProfileFields {
  const out: ImportedProfileFields = {};
  const name = String(fields.guardian_name ?? "").trim();
  if (name) out.guardian_name = name;
  const phone = fields.guardian_phone ? normalizeIndianPhone(fields.guardian_phone) : null;
  if (phone) out.guardian_phone = phone;
  return out;
}

/**
 * The `tenants` update that puts the owner's guardian on the new tenancy.
 *
 * Only what the owner supplied is written — a blank stays blank for the
 * tenant to fill. The guardian phone goes to both `phone_2` and
 * `guardian_phone`, exactly as `saveGuardian` writes it (readers use
 * `phone_2 || guardian_phone`). The guardian relation is not imported: the
 * tenant gives it on the Guardian step, which therefore still opens for them,
 * prefilled, with no OTP when the number is the owner's.
 *
 * Deliberately absent: anything about agreements, signatures, rules
 * acceptance, activation, profile completion or documents.
 */
export function tenantPrefillData(fields: ImportedProfileFields): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (fields.guardian_name) data.guardian_name = fields.guardian_name;
  if (fields.guardian_phone) {
    data.guardian_phone = fields.guardian_phone;
    data.phone_2 = fields.guardian_phone;
  }
  return data;
}

/**
 * Whether the guardian number now on a tenancy is one the owner supplied for
 * **this tenancy** in an import that actually ran.
 *
 * This — not "a guardian number exists in the database" — is what lets
 * onboarding skip the guardian OTP. Requirements, all of them:
 * - an import row linked to this tenancy (`tenant_id`) that executed
 *   successfully;
 * - that row carries both a guardian name and a guardian phone;
 * - its phone is the same number as the one being checked (last 10 digits).
 *
 * A number the tenant typed differently, a guardian added by the manual
 * invite, onboarding or support, or a row that failed to import all fall
 * through to the ordinary OTP flow.
 */
export function guardianSuppliedByImport(
  importRows: Array<{ execution_status: string | null; mapped_data: unknown }>,
  guardianPhone: string | null | undefined,
): boolean {
  const key = indianPhoneKey(guardianPhone ?? "");
  if (!key) return false;
  return importRows.some((row) => {
    if (row.execution_status !== "SUCCESS") return false;
    const data = (row.mapped_data ?? {}) as Partial<ImportedProfileFields>;
    if (!String(data.guardian_name ?? "").trim()) return false;
    return indianPhoneKey(String(data.guardian_phone ?? "")) === key;
  });
}
