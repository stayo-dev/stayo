/**
 * Tenant details an owner can supply in the import workbook, so the tenant is
 * not asked for them again at onboarding.
 *
 * Onboarding already prefills every screen from the tenancy record — the
 * activation context returns `tenants.*` and the screens read it. What was
 * missing is a way for the import to *put* these details on the record:
 * `createInvitation` takes name, phone, room and money terms only. So the
 * confirm step writes these fields onto the new tenancy right after it is
 * created, through `tenantPrefillData` below.
 *
 * Every value is validated by the **same rules onboarding enforces**
 * (`activation-workflow-service.saveProfile` / `saveGuardian`), so an import
 * can never store something the tenant's own screen would have refused.
 *
 * What this never does:
 * - touch agreement, signature, rules-acceptance, activation or KYC fields —
 *   the tenant still reviews and signs the agreement themselves;
 * - collect a photo or documents (they cannot come from a spreadsheet);
 * - mark anything verified. The one consequence of import data for
 *   verification is the guardian rule in `guardianSuppliedByImport`, which is
 *   keyed to *this tenancy's own import row*, never to a number merely being
 *   on file.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */
import { parseImportDate } from "./dates";
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

/** The owner-supplied profile values, as stored in `bulk_import_rows.mapped_data`. */
export interface ImportedProfileFields {
  date_of_birth?: string;
  gender?: string;
  profile_type?: string;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_relation?: string;
  college_name?: string;
  course?: string;
  roll_number?: string;
  office_name?: string;
  office_location?: string;
  job_role?: string;
  permanent_address?: string;
}

export const PROFILE_FIELD_KEYS = [
  "date_of_birth",
  "gender",
  "profile_type",
  "guardian_name",
  "guardian_phone",
  "guardian_relation",
  "college_name",
  "course",
  "roll_number",
  "office_name",
  "office_location",
  "job_role",
  "permanent_address",
] as const satisfies readonly (keyof ImportedProfileFields)[];

/**
 * Workbook headers, in the order the template writes them after the existing
 * columns. The first entry is what the template prints; the rest are accepted
 * spellings for files owners make themselves.
 */
export const PROFILE_COLUMNS: Record<keyof ImportedProfileFields, string[]> = {
  date_of_birth: ["Date of Birth", "date_of_birth", "DOB", "dob", "Birth Date"],
  gender: ["Gender", "gender"],
  profile_type: ["Tenant Type", "tenant_type", "Profile Type", "profile_type", "type"],
  guardian_name: ["Guardian Name", "guardian_name", "Parent Name", "parent_name"],
  guardian_phone: ["Guardian Phone", "guardian_phone", "Parent Phone", "parent_phone", "Guardian Mobile"],
  guardian_relation: ["Guardian Relation", "guardian_relation", "Relation", "relation"],
  college_name: ["College", "college", "college_name", "College Name"],
  course: ["Course", "course"],
  roll_number: ["Roll Number", "roll_number", "Roll No"],
  office_name: ["Company", "company", "office_name", "Office Name"],
  office_location: ["Office Location", "office_location"],
  job_role: ["Job Role", "job_role", "Designation"],
  permanent_address: ["Permanent Address", "permanent_address", "Address", "address"],
};

/** Labels the template prints for these columns, in template order. */
export const PROFILE_HEADERS = PROFILE_FIELD_KEYS.map((key) => PROFILE_COLUMNS[key][0]);

/** The four values onboarding accepts for gender — `saveProfile`'s own list. */
export const GENDER_VALUES = ["Male", "Female", "Other", "Prefer not to say"] as const;
export const TENANT_TYPE_VALUES = ["Student", "Working Professional"] as const;

const TEXT_LIMIT = 200;
const ADDRESS_LIMIT = 500;

function readCell(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

/** Reads the profile columns of one raw sheet row. Blank cells are absent. */
export function readProfileCells(row: Record<string, any>): ImportedProfileFields {
  const out: ImportedProfileFields = {};
  for (const key of PROFILE_FIELD_KEYS) {
    const value = readCell(row, PROFILE_COLUMNS[key]);
    if (value) out[key] = value;
  }
  return out;
}

export function normalizeGender(value: string | undefined): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["male", "m", "boy"].includes(text)) return "Male";
  if (["female", "f", "girl"].includes(text)) return "Female";
  if (text === "other") return "Other";
  if (["prefer not to say", "not specified"].includes(text)) return "Prefer not to say";
  return null;
}

export function normalizeTenantType(value: string | undefined): "STUDENT" | "WORKING_PROFESSIONAL" | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!text) return null;
  if (["student", "studying"].includes(text)) return "STUDENT";
  if (["working professional", "working", "professional", "employee", "job"].includes(text)) {
    return "WORKING_PROFESSIONAL";
  }
  return null;
}

/**
 * A date of birth onboarding would accept: a real DD/MM/YYYY (or ISO /
 * Excel-serial) date, before today, not before 1900 — `validDateOfBirth`'s rule.
 */
export function parseDateOfBirth(value: string | undefined, today: Date): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = parseImportDate(text);
  if (!date) return null;
  if (date.getTime() >= today.getTime()) return null;
  if (date.getFullYear() < 1900) return null;
  return date;
}

export type ProfileProblem = {
  code: "DOB_INVALID" | "GENDER_INVALID" | "TENANT_TYPE_INVALID" | "GUARDIAN_PHONE_INVALID" | "GUARDIAN_PHONE_IS_TENANT" | "TEXT_TOO_LONG";
  field: keyof ImportedProfileFields;
  value: string;
};

/**
 * Checks the owner's profile cells. Every value here is optional — a blank
 * cell is simply something the tenant fills in at onboarding — but a value
 * that *is* given must be one onboarding would accept, or the row stops
 * until it is fixed or cleared.
 */
export function profileProblems(
  fields: ImportedProfileFields,
  context: { tenantPhone: string | null | undefined; today: Date },
): ProfileProblem[] {
  const problems: ProfileProblem[] = [];
  if (fields.date_of_birth && !parseDateOfBirth(fields.date_of_birth, context.today)) {
    problems.push({ code: "DOB_INVALID", field: "date_of_birth", value: fields.date_of_birth });
  }
  if (fields.gender && !normalizeGender(fields.gender)) {
    problems.push({ code: "GENDER_INVALID", field: "gender", value: fields.gender });
  }
  if (fields.profile_type && !normalizeTenantType(fields.profile_type)) {
    problems.push({ code: "TENANT_TYPE_INVALID", field: "profile_type", value: fields.profile_type });
  }
  if (fields.guardian_phone) {
    const guardian = normalizeIndianPhone(fields.guardian_phone);
    if (!guardian) {
      problems.push({ code: "GUARDIAN_PHONE_INVALID", field: "guardian_phone", value: fields.guardian_phone });
    } else if (context.tenantPhone && indianPhoneKey(guardian) === indianPhoneKey(context.tenantPhone)) {
      // `saveGuardian` refuses a guardian who is the tenant — so does this.
      problems.push({ code: "GUARDIAN_PHONE_IS_TENANT", field: "guardian_phone", value: fields.guardian_phone });
    }
  }
  for (const key of PROFILE_FIELD_KEYS) {
    const value = fields[key];
    const limit = key === "permanent_address" ? ADDRESS_LIMIT : TEXT_LIMIT;
    if (value && value.length > limit) problems.push({ code: "TEXT_TOO_LONG", field: key, value });
  }
  return problems;
}

/**
 * The normalised values persisted in `mapped_data` — what confirm writes and
 * what the guardian rule compares against. Only valid values survive; a row
 * with an invalid one never reaches confirm (it is blocked at preview).
 */
export function normalizeProfileFields(fields: ImportedProfileFields, today: Date): ImportedProfileFields {
  const out: ImportedProfileFields = {};
  const dob = parseDateOfBirth(fields.date_of_birth, today);
  if (dob) out.date_of_birth = toIsoDate(dob);
  const gender = normalizeGender(fields.gender);
  if (gender) out.gender = gender;
  const type = normalizeTenantType(fields.profile_type);
  if (type) out.profile_type = type;
  const guardianPhone = fields.guardian_phone ? normalizeIndianPhone(fields.guardian_phone) : null;
  if (guardianPhone) out.guardian_phone = guardianPhone;
  for (const key of [
    "guardian_name",
    "guardian_relation",
    "college_name",
    "course",
    "office_name",
    "office_location",
    "job_role",
    "permanent_address",
  ] as const) {
    const value = String(fields[key] ?? "").trim();
    if (value) out[key] = value;
  }
  // Onboarding stores roll numbers uppercased (`saveProfile`).
  const roll = String(fields.roll_number ?? "").trim().toUpperCase();
  if (roll) out.roll_number = roll;
  return out;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The `tenants` update that puts the owner's details on the new tenancy.
 *
 * Only fields the owner actually supplied are written — a blank stays blank
 * for the tenant to fill. The column mapping mirrors onboarding exactly:
 * guardian phone goes to both `phone_2` and `guardian_phone` (`saveGuardian`
 * writes both, and readers use `phone_2 || guardian_phone`); student fields
 * only for a student, office fields only for a working professional.
 *
 * Deliberately absent: anything about agreements, signatures, rules
 * acceptance, activation, profile completion or documents.
 */
export function tenantPrefillData(fields: ImportedProfileFields): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (fields.date_of_birth) data.date_of_birth = new Date(`${fields.date_of_birth}T00:00:00.000Z`);
  if (fields.gender) data.gender = fields.gender;
  if (fields.profile_type) data.profile_type = fields.profile_type;
  if (fields.guardian_name) data.guardian_name = fields.guardian_name;
  if (fields.guardian_relation) data.guardian_relation = fields.guardian_relation;
  if (fields.guardian_phone) {
    data.guardian_phone = fields.guardian_phone;
    data.phone_2 = fields.guardian_phone;
  }
  if (fields.permanent_address) data.permanent_address = fields.permanent_address;

  // A blank type means the owner did not say; onboarding treats that as a
  // student (`saveProfile`'s default), so student details still apply.
  const isProfessional = fields.profile_type === "WORKING_PROFESSIONAL";
  if (!isProfessional) {
    if (fields.college_name) data.college_name = fields.college_name;
    if (fields.course) data.course = fields.course;
    if (fields.roll_number) data.roll_number = fields.roll_number;
  } else {
    if (fields.office_name) data.office_name = fields.office_name;
    if (fields.office_location) data.office_location = fields.office_location;
    if (fields.job_role) data.job_role = fields.job_role;
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
