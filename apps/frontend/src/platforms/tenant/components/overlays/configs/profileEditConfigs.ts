import type { ProfileEditField, ProfileEditSection } from '../ProfileEditScreen';
import type { DetailSection, OverlayTone } from '../types';

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const RELATION_OPTIONS = ['Father', 'Mother', 'Guardian', 'Sibling', 'Other'];

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : '');
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const dateFull = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dateMonthYear = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—');
const maskAadhaar = (docNumber?: string | null) => {
  const digits = (docNumber ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `XXXX XXXX ${digits.slice(-4)}`;
};

/** The shape the Aadhaar row and its edit field are both rendered from. */
export interface AadhaarRow {
  text: string;
  /** Mono is for document numbers. Everything else here is a sentence. */
  mono: boolean;
  /** Whether a document exists at all — drives Upload vs. Replace. */
  uploaded: boolean;
}

/**
 * What the Aadhaar row should say.
 *
 * This used to be `maskAadhaar(doc?.doc_number)` on its own, which told every
 * tenant who *had* uploaded an Aadhaar that it was "Not uploaded":
 * `identification_documents.doc_number` is optional and **no current upload
 * path writes it** — neither onboarding (`POST /tenants/activate/documents`)
 * nor this screen's own picker sends a number; only the frozen legacy portal
 * ever collected one. So the row answered "do we know your number?" while
 * appearing to answer "have you uploaded it?", and the tenant re-uploaded
 * into an unchanging message. Existence and status are what the row is for;
 * the number is a bonus when we happen to have it. See [[Bugs]].
 */
export function aadhaarRow(doc?: { doc_number?: string | null; document_status?: string | null; is_verified?: boolean | null } | null): AadhaarRow {
  if (!doc) return { text: 'Not uploaded', mono: false, uploaded: false };

  const masked = maskAadhaar(doc.doc_number);
  if (masked) return { text: masked, mono: true, uploaded: true };

  const status = String(doc.document_status ?? '').toUpperCase();
  if (status === 'REJECTED') return { text: 'Rejected — upload again', mono: false, uploaded: true };
  if (doc.is_verified === true || status === 'APPROVED' || status === 'VERIFIED') {
    return { text: 'Uploaded · Verified', mono: false, uploaded: true };
  }
  return { text: 'Uploaded · Pending verification', mono: false, uploaded: true };
}
const YEAR_SUFFIX: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
const ordinalYear = (n: unknown) => {
  const num = Number(n);
  if (!num) return '—';
  return `${num}${YEAR_SUFFIX[num] ?? 'th'} year`;
};

export interface ProfileEditConfig {
  title: string;
  sub: string;
  /** Read-only card view — matches Stayo Tenant.dc.html's DETAIL-map entries for these screens exactly. */
  viewSections: DetailSection[];
  headPill?: string;
  pillTone?: OverlayTone;
  /** The design's own bottom-button copy, reused as the view-mode edit trigger. */
  editButtonLabel: string;
  sections: ProfileEditSection[];
}

/**
 * Config for the Profile tab's "Your details" screens, per Stayo Tenant.dc.html's
 * Personal/Contact/Emergency/Academic DETAIL entries. `viewSections` renders the
 * read-only card exactly as designed; `sections` is the editable form shown once
 * the tenant taps the bottom button. `verify: 'PHONE'` fields (the phone only —
 * 2026-08-14 product decision) save via a change-request instead of directly (see
 * directly — the owner-approval queue this used to pass through is gone, see ADR-119).
 */
export function buildProfileEditConfigs(
  tenant: any,
  profile: any,
  contacts: any,
  documents: any[],
  verification: any,
): Record<string, ProfileEditConfig> {
  const t = tenant ?? {};
  const p = profile ?? {};
  const c = contacts ?? {};
  const aadhaarDoc = (documents ?? []).find((d: any) => d.doc_type === 'AADHAAR');
  const aadhaar = aadhaarRow(aadhaarDoc);
  const isVerified = verification?.overall === 'VERIFIED';

  const phoneValue = c.tenant_phone?.value ?? t.phone_1 ?? p.phone ?? '';
  const emailValue = t.personal_email ?? '';
  const guardianPhoneValue = c.guardian_phone?.value ?? t.guardian_phone ?? t.phone_2 ?? '';
  const alternatePhoneValue = c.emergency_phone?.value ?? t.phone_3 ?? p.emergency_contact ?? '';
  const guardianName = t.guardian_name ?? '';
  const guardianRelation = t.guardian_relation ?? '';

  return {
    personal_info: {
      title: 'Personal information',
      sub: 'Yours to change, any time',
      headPill: isVerified ? 'Verified' : undefined,
      pillTone: 'green',
      editButtonLabel: 'Edit details',
      viewSections: [
        {
          kind: 'rows',
          title: 'Identity',
          rows: [
            { label: 'Full name', value: dash(p.name) },
            { label: 'Date of birth', value: dateFull(t.date_of_birth) },
            { label: 'Gender', value: dash(t.gender) },
            { label: 'Nationality', value: dash(t.nationality) },
          ],
        },
        {
          kind: 'rows',
          title: 'Government ID',
          rows: [
            { label: 'Aadhaar', value: aadhaar.text, mono: aadhaar.mono },
            { label: 'PAN', value: dash(t.pan_number), mono: true },
          ],
        },
      ],
      sections: [
        {
          title: 'Identity',
          fields: [
            { key: 'name', label: 'Full name', type: 'text', value: p.name ?? '' },
            { key: 'date_of_birth', label: 'Date of birth', type: 'date', value: iso(t.date_of_birth) },
            { key: 'gender', label: 'Gender', type: 'select', options: GENDER_OPTIONS, value: t.gender ?? '' },
            { key: 'nationality', label: 'Nationality', type: 'text', value: t.nationality ?? '', placeholder: 'Indian', optional: true },
          ] as ProfileEditField[],
        },
        {
          title: 'Government ID',
          fields: [
            { key: 'aadhaar', label: 'Aadhaar', type: 'document', docType: 'AADHAAR', value: aadhaar.uploaded ? aadhaar.text : '', mono: aadhaar.mono },
            { key: 'pan_number', label: 'PAN', type: 'text', value: t.pan_number ?? '', placeholder: 'ABCDE1234F', optional: true },
          ] as ProfileEditField[],
        },
      ],
    },
    contact_info: {
      title: 'Contact details',
      sub: 'How we reach you',
      editButtonLabel: 'Update contact details',
      viewSections: [
        {
          kind: 'rows',
          title: 'Contact',
          rows: [
            { label: 'Phone', value: dash(phoneValue) },
            { label: 'Email', value: dash(emailValue) },
            { label: 'WhatsApp', value: 'Same as phone' },
          ],
        },
        {
          kind: 'rows',
          title: 'Permanent address',
          rows: [
            { label: 'City', value: dash(p.city) },
            { label: 'State', value: dash(p.state) },
            { label: 'PIN', value: dash(p.pincode), mono: true },
          ],
        },
      ],
      sections: [
        {
          title: 'Contact',
          fields: [
            { key: 'phone_1', label: 'Phone', type: 'text', value: phoneValue, verify: 'PHONE' },
            { key: 'personal_email', label: 'Email', type: 'text', value: emailValue, verify: 'EMAIL' },
          ] as ProfileEditField[],
        },
        {
          title: 'Permanent address',
          fields: [
            { key: 'city', label: 'City', type: 'text', value: p.city ?? '' },
            { key: 'state', label: 'State', type: 'text', value: p.state ?? '' },
            { key: 'pincode', label: 'PIN', type: 'text', value: p.pincode ?? '' },
          ] as ProfileEditField[],
        },
      ],
    },
    emergency_info: {
      title: 'Emergency contact',
      sub: 'Who we call in an emergency',
      editButtonLabel: 'Update emergency contact',
      viewSections: [
        {
          kind: 'person',
          initial: (guardianName || 'G').charAt(0).toUpperCase(),
          name: guardianName || 'Not set',
          role: guardianRelation ? `${guardianRelation} · Guardian` : 'Guardian',
          tag1: dash(guardianPhoneValue),
          tag2: dash(p.city),
        },
        {
          kind: 'rows',
          title: 'Details',
          rows: [
            { label: 'Relation', value: dash(guardianRelation) },
            { label: 'Phone', value: dash(guardianPhoneValue) },
            { label: 'Alternate', value: dash(alternatePhoneValue) },
          ],
        },
      ],
      sections: [
        {
          title: 'Details',
          fields: [
            { key: 'guardian_name', label: "Contact person's name", type: 'text', value: guardianName },
            { key: 'guardian_relation', label: 'Relationship', type: 'select', options: RELATION_OPTIONS, value: guardianRelation },
            { key: 'guardian_phone', label: 'Phone', type: 'text', value: guardianPhoneValue },
            { key: 'phone_3', label: 'Alternate phone', type: 'text', value: alternatePhoneValue },
          ] as ProfileEditField[],
        },
      ],
    },
    academic_info:
      t.profile_type === 'WORKING_PROFESSIONAL'
        ? {
            title: 'Work details',
            sub: 'Employer & role',
            editButtonLabel: 'Edit details',
            viewSections: [
              {
                kind: 'rows',
                title: 'Work',
                rows: [
                  { label: 'Company', value: dash(t.office_name) },
                  { label: 'Role', value: dash(t.job_role) },
                  { label: 'Location', value: dash(t.office_location) },
                ],
              },
            ],
            sections: [
              {
                title: 'Work',
                fields: [
                  { key: 'office_name', label: 'Company', type: 'text', value: t.office_name ?? '', placeholder: 'Where do you work?' },
                  { key: 'job_role', label: 'Role', type: 'text', value: t.job_role ?? '', placeholder: 'What do you do there?' },
                  { key: 'office_location', label: 'Location', type: 'text', value: t.office_location ?? '' },
                ] as ProfileEditField[],
              },
            ],
          }
        : {
            title: 'Academic details',
            sub: 'College & course',
            editButtonLabel: 'Edit details',
            viewSections: [
              {
                kind: 'rows',
                title: 'Institution',
                rows: [
                  { label: 'College', value: dash(t.college_name) },
                  { label: 'Course', value: dash(t.course) },
                  { label: 'Year', value: ordinalYear(t.year_of_study) },
                  { label: 'Roll no.', value: dash(t.roll_number), mono: true },
                ],
              },
              {
                kind: 'rows',
                title: 'Duration',
                rows: [
                  { label: 'Joined', value: dateMonthYear(t.joined_on) },
                  { label: 'Expected exit', value: dateMonthYear(t.expected_completion_date) },
                ],
              },
            ],
            sections: [
              {
                title: 'Institution',
                fields: [
                  { key: 'college_name', label: 'College', type: 'text', value: t.college_name ?? '', placeholder: 'Which college?' },
                  { key: 'course', label: 'Course', type: 'text', value: t.course ?? '', placeholder: 'Which course?' },
                  { key: 'branch', label: 'Branch', type: 'text', value: t.branch ?? '' },
                  { key: 'year_of_study', label: 'Year', type: 'text', value: t.year_of_study != null ? String(t.year_of_study) : '' },
                  { key: 'roll_number', label: 'Roll number', type: 'text', value: t.roll_number ?? '' },
                ] as ProfileEditField[],
              },
              {
                title: 'Duration',
                fields: [
                  { key: 'expected_completion_date', label: 'Expected exit', type: 'date', value: iso(t.expected_completion_date) },
                ] as ProfileEditField[],
              },
            ],
          },
  };
}
