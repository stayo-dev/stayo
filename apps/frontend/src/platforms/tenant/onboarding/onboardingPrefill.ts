/**
 * Which onboarding fields are already known, and which still have to be asked.
 *
 * Pure and node-testable on purpose: `apps/frontend`'s suite has no jsdom, so
 * every decision lives here and `WelcomeIdentityStep` stays a renderer over the
 * result. Nothing in this file touches React.
 */

export type KnownSource = 'PROFILE' | 'TENANCY' | 'INVITE';

/** The `known` block on the activation context (see `onboarding-known.ts`). */
export interface KnownBlock {
  name: string | null;
  email: string | null;
  phone: string | null;
  phone_verified: boolean;
  identity: Record<string, unknown>;
  has_prefill: boolean;
  source_of: Record<string, KnownSource>;
}

export interface KnownRow {
  field: string;
  label: string;
  /** Ready to render — dates are humanised, everything else is its string form. */
  display: string;
  origin: KnownSource;
}

export interface PrefillPlan {
  /** The locked "your Stayo account" block. */
  account: { name: string; email: string; phone: string; phoneVerified: boolean };
  /** The "we already know these" rows, in reading order. */
  knownRows: KnownRow[];
  /** False when there is nothing worth showing — render the plain form instead. */
  showKnownBlock: boolean;
  /** True when submit must carry a fresh OTP. */
  otpRequired: boolean;
}

const PERSONAL_ROWS: { field: string; label: string }[] = [
  { field: 'date_of_birth', label: 'Date of birth' },
  { field: 'gender', label: 'Gender' },
  { field: 'permanent_address', label: 'Permanent address' },
  { field: 'guardian_name', label: 'Guardian' },
  { field: 'guardian_phone', label: 'Guardian mobile' },
  { field: 'guardian_relation', label: 'Relationship' },
];

const ACADEMIC_ROWS: { field: string; label: string }[] = [
  { field: 'college_name', label: 'College' },
  { field: 'course', label: 'Course' },
  { field: 'year_of_study', label: 'Year of study' },
  { field: 'branch', label: 'Branch' },
  { field: 'roll_number', label: 'Roll number' },
];

const PROFESSIONAL_ROWS: { field: string; label: string }[] = [
  { field: 'office_name', label: 'Company' },
  { field: 'job_role', label: 'Role' },
  { field: 'office_location', label: 'Office location' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates arrive as ISO strings; a person reads "14 Mar 2004". */
function display(field: string, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (field !== 'date_of_birth') return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

export function buildPrefillPlan(input: {
  known?: KnownBlock;
  profileType: 'STUDENT' | 'WORKING_PROFESSIONAL';
  /** Has the tenant unlocked and changed the mobile number in this session? */
  phoneEdited: boolean;
}): PrefillPlan {
  const { known, profileType, phoneEdited } = input;

  const account = {
    name: known?.name ?? '',
    email: known?.email ?? '',
    phone: known?.phone ?? '',
    phoneVerified: Boolean(known?.phone_verified),
  };

  // The server applies exactly this rule in `saveAccount()`. Asking for an OTP
  // the server would not have demanded is the bug this replaces.
  const otpRequired = !account.phoneVerified || phoneEdited;

  const specs = [
    ...PERSONAL_ROWS,
    ...(profileType === 'WORKING_PROFESSIONAL' ? PROFESSIONAL_ROWS : ACADEMIC_ROWS),
  ];

  const knownRows: KnownRow[] = known
    ? specs
        .map((spec) => ({
          field: spec.field,
          label: spec.label,
          display: display(spec.field, known.identity?.[spec.field]),
          origin: known.source_of?.[spec.field] ?? 'PROFILE',
        }))
        .filter((row) => row.display !== '')
    : [];

  return {
    account,
    knownRows,
    showKnownBlock: knownRows.length > 0,
    otpRequired,
  };
}
