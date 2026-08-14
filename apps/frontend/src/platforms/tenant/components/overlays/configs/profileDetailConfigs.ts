import { stayoToast } from '@shared/ui-patterns/Toast';
import type { DetailConfig, OverlayTone } from '../types';

interface ProfileDetailContext {
  tenant: any;
  profile: any;
  contacts: any;
  documents: any[];
  onUploadDocument: () => void;
}

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const dateLabel = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const DOC_TONE: Record<string, OverlayTone> = { VERIFIED: 'green', PENDING: 'yellow', REJECTED: 'red' };

/**
 * @deprecated Superseded by `profileEditConfigs.ts` + `ProfileEditScreen.tsx`
 * (2026-08-14) — the "Your details" screens became real editable forms
 * (direct-save for most fields, owner-approval change-requests for phone/
 * email/address/DOB) instead of read-only rows, and Documents moved inline
 * onto the main Profile page. Kept per the repo's deprecate-don't-delete
 * convention; safe to delete once confirmed no other file imports it.
 *
 * Profile → "Your details" drill-ins + Documents — Stayo Tenant.dc.html's personal_info/contact_info/emergency_info/academic_info/kyc_docs, built from the real `GET /tenants/me/profile` payload.
 */
export function buildProfileDetailConfigs(ctx: ProfileDetailContext): Record<string, DetailConfig> {
  const { tenant: t, profile: p, contacts, documents } = ctx;

  const verifiedDocs = documents.filter((d) => d.document_status === 'VERIFIED' || d.is_verified);
  const pendingDocs = documents.filter((d) => !(d.document_status === 'VERIFIED' || d.is_verified));

  return {
    personal_info: {
      title: 'Personal information',
      sub: 'Your identity on file',
      sections: [
        {
          kind: 'rows',
          title: 'Identity',
          rows: [
            { label: 'Full name', value: dash(p?.name) },
            { label: 'Date of birth', value: dateLabel(t?.date_of_birth) },
            { label: 'Gender', value: dash(t?.gender) },
            { label: 'Tenant since', value: dateLabel(t?.joined_on) },
          ],
        },
        { kind: 'actions', actions: [{ label: 'Request a correction', style: 'primary', onClick: () => stayoToast.success('Correction request sent to warden') }] },
      ],
    },
    contact_info: {
      title: 'Contact details',
      sub: 'How we reach you',
      sections: [
        {
          kind: 'rows',
          title: 'Contact',
          rows: [
            { label: 'Phone', value: dash(contacts?.tenant_phone?.value ?? p?.phone) },
            { label: 'Email', value: dash(p?.email ?? p?.account_email) },
          ],
        },
        ...(t?.permanent_address
          ? [{ kind: 'rows' as const, title: 'Permanent address', rows: [{ label: 'Address', value: dash(t.permanent_address) }] }]
          : []),
      ],
    },
    emergency_info: {
      title: 'Emergency contact',
      sub: 'Who we call in an emergency',
      sections: [
        {
          kind: 'rows',
          title: 'Details',
          rows: [
            { label: 'Contact', value: dash(p?.emergency_contact) },
            { label: 'Phone', value: dash(contacts?.emergency_phone?.value ?? contacts?.guardian_phone?.value) },
          ],
        },
        { kind: 'actions', actions: [{ label: 'Update emergency contact', style: 'primary', onClick: () => stayoToast.success('Emergency contact updated') }] },
      ],
    },
    academic_info: {
      title: t?.profile_type === 'WORKING_PROFESSIONAL' ? 'Work details' : 'Academic details',
      sub: t?.profile_type === 'WORKING_PROFESSIONAL' ? 'Employer & role' : 'College & course',
      sections:
        t?.profile_type === 'WORKING_PROFESSIONAL'
          ? [{ kind: 'rows', title: 'Work', rows: [
              { label: 'Company', value: dash(t?.office_name) },
              { label: 'Role', value: dash(t?.job_role) },
              { label: 'Location', value: dash(t?.office_location) },
            ] }]
          : [{ kind: 'rows', title: 'Institution', rows: [
              { label: 'College', value: dash(t?.college_name) },
              { label: 'Course', value: dash(t?.course) },
              { label: 'Branch', value: dash(t?.branch) },
              { label: 'Year', value: dash(t?.year_of_study) },
              { label: 'Roll no.', value: dash(t?.roll_number), mono: true },
            ] }],
    },
    kyc_docs: {
      title: 'Documents',
      sub: 'KYC & agreement',
      sections: [
        ...(verifiedDocs.length > 0
          ? [{ kind: 'notices' as const, title: 'Verified', notices: verifiedDocs.map((d) => ({ title: d.doc_type_label ?? d.doc_type, meta: `Verified · ${dateLabel(d.uploaded_at ?? d.created_at)}`, tone: 'green' as const })) }]
          : []),
        ...(pendingDocs.length > 0
          ? [{ kind: 'notices' as const, title: 'Pending', notices: pendingDocs.map((d) => ({ title: d.doc_type_label ?? d.doc_type, meta: d.document_status === 'REJECTED' ? 'Rejected — re-upload needed' : 'Awaiting verification', tone: (DOC_TONE[d.document_status] ?? 'yellow') as OverlayTone })) }]
          : []),
        { kind: 'actions', actions: [{ label: 'Upload a document', style: 'primary', onClick: ctx.onUploadDocument }] },
      ],
    },
  };
}
