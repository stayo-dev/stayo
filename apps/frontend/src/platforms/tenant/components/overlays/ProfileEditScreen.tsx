import { useState } from 'react';
import { authApi } from '@lib/authApi';
import { contactApi } from '@features/tenant-profile/api/contactApi';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { C, GRID_GROUND } from '@/app/pages/discover/discoverTheme';
import type { DetailSection, OverlayTone } from './types';
import { TONE_COLOR } from './types';
import { Section, sectionLabel, card } from './Section';

/** One input shape, so a select and a text box never sit at different heights. */
const inputClass =
  'w-full rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-sm font-medium text-foreground outline-none transition-colors placeholder:font-normal placeholder:text-[#C2B7A9] focus:border-primary';

/** `2006-05-21` → `21 May 2006`. */
function readableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export interface ProfileEditField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'document';
  value: string;
  options?: string[];
  /** Changing this needs a code sent to the new value before it saves. Nobody approves it. */
  verify?: 'PHONE' | 'EMAIL';
  /** Shown in an empty field. An empty box with no hint is a question with no wording. */
  placeholder?: string;
  /** Marked in the label, so nobody hunts for a value they were never required to give. */
  optional?: boolean;
  /** For type: 'document' — tapping the row opens the document-upload flow instead of an input (e.g. Aadhaar). */
  docType?: string;
}

export interface ProfileEditSection {
  title: string;
  fields: ProfileEditField[];
}

interface PendingRequestSummary {
  id: string;
  diff: Record<string, string | null>;
}

interface ProfileEditScreenProps {
  title: string;
  sub: string;
  /** Read-only card view shown before the tenant taps into edit mode — same visual language as `DetailScreen` (Stayo Tenant.dc.html's own card design for these screens). */
  viewSections: DetailSection[];
  headPill?: string;
  pillTone?: OverlayTone;
  /** The design's own copy for the bottom action button in view mode — tapping it enters edit mode; it does not by itself require any approval. */
  editButtonLabel: string;
  sections: ProfileEditSection[];
  isSaving: boolean;
  onBack: () => void;
  onSaveDirect: (patch: Record<string, string>) => Promise<void>;
  /** Opens the existing document-upload flow for a `type: 'document'` field (e.g. Aadhaar) instead of a text input. */
  onUploadDocument?: (docType: string) => void;
}

/**
 * Profile "Your details" screen — read-only card view (matching Stayo Tenant.dc.html
 * exactly) by default, switching to an editable form in the same card layout on tap.
 * Everything saves directly via `PATCH /api/tenants/me/profile`. Nobody approves
 * a change to your own details (ADR-119) — a changed phone or email is the one
 * thing that has to be *proved*, with a code sent to the new value, which is
 * what the `verify` step below is for.
 */
export function ProfileEditScreen({
  title,
  sub,
  viewSections,
  headPill,
  pillTone,
  editButtonLabel,
  sections,
  isSaving,
  onBack,
  onSaveDirect,
  onUploadDocument,
}: ProfileEditScreenProps) {
  const [editing, setEditing] = useState(false);
  const initial = Object.fromEntries(sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const allFields = sections.flatMap((s) => s.fields);
  const changedKeys = allFields.filter((f) => f.type !== 'document' && (values[f.key] ?? '') !== (f.value ?? '')).map((f) => f.key);
  const changedVerified = changedKeys.filter((k) => allFields.find((f) => f.key === k)?.verify);
  const verifyChannel = changedVerified.length > 0
    ? allFields.find((f) => f.key === changedVerified[0])?.verify ?? null
    : null;
  const hasChanges = changedKeys.length > 0;

  const enterEdit = () => {
    setValues(Object.fromEntries(sections.flatMap((s) => s.fields.map((f) => [f.key, f.value]))));
    setEditing(true);
  };

  /**
   * Saving is now direct. These fields used to need the owner's approval
   * before they took effect — a queue with **0 rows, ever** standing between
   * someone and their own phone number. A new number still has to be proved,
   * because it is where WhatsApp reaches them, but proving it is the person's
   * own job and takes one code (ADR-119).
   */
  const handleSave = async () => {
    if (changedVerified.length > 0 && !otpSent) {
      const target = values[changedVerified[0]];
      setOtpError(null);
      setSendingOtp(true);
      try {
        const result = verifyChannel === 'EMAIL'
          ? await contactApi.startEmailVerification(target)
          : await authApi.sendPhoneOtp(target);
        setOtpSent(true);
        // ADR-034: WhatsApp could not deliver, so there is no code coming.
        // Waiting for one would strand the edit; save it instead.
        if (!result.verification_required) {
          await saveAll();
        }
      } catch (err: any) {
        setOtpError(
          err?.response?.data?.error?.message
            || `Could not send a code to that ${verifyChannel === 'EMAIL' ? 'address' : 'number'}`,
        );
      } finally {
        setSendingOtp(false);
      }
      return;
    }

    if (changedVerified.length > 0) {
      const target = values[changedVerified[0]];
      setOtpError(null);
      setSendingOtp(true);
      try {
        if (verifyChannel === 'EMAIL') {
          await contactApi.confirmEmailVerification(target, otp.trim());
        } else {
          await authApi.verifyPhoneOtp(target, otp.trim());
        }
      } catch (err: any) {
        setOtpError(err?.response?.data?.error?.message || 'That code did not match. Try again.');
        setSendingOtp(false);
        return;
      }
      setSendingOtp(false);
    }

    await saveAll();
  };

  const saveAll = async () => {
    if (changedKeys.length > 0) {
      await onSaveDirect(Object.fromEntries(changedKeys.map((k) => [k, values[k]])));
    }
    setOtp('');
    setOtpSent(false);
    setOtpError(null);
    setEditing(false);
  };

  const pillTheme = pillTone ? TONE_COLOR[pillTone] : null;

  return (
    <div className="stayo-panel-slide-in fixed inset-0 z-[45] flex flex-col" style={GRID_GROUND}>
      {/*
        The header sits on solid paper rather than the grid, so the graph lines
        start where the content does — the same seam every other Stayo screen
        has between its header and its body.
      */}
      <div
        className="flex flex-none items-center gap-3 border-b px-[18px] pb-3 pt-[max(2.5rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          onClick={editing ? () => setEditing(false) : onBack}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-[#EFE6DA] bg-card"
        >
          <ChevronLeft className="h-[18px] w-[18px] text-[#4A433C]" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-foreground">{title}</div>
          <div className="text-[11.5px] font-medium text-[#8A7F75]">{sub}</div>
        </div>
        {!editing && headPill && pillTheme && (
          <span className="flex-none rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ background: pillTheme.bg, color: pillTheme.c }}>
            {headPill}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto px-[18px] pb-5 pt-4">
        {!editing ? (
          <div className="flex flex-col gap-5">
            {viewSections.map((section, i) => (
              <div key={i} className="flex flex-col gap-2.5">
                {'title' in section && section.title && <span className={sectionLabel}>{section.title}</span>}
                <Section section={section} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <div key={section.title} className="flex flex-col gap-3">
                <span className={sectionLabel}>{section.title}</span>
                <div className={`${card} flex flex-col gap-3 p-4`}>
                  {section.fields.map((field) => {
                    const locked = false;
                    if (field.type === 'document') {
                      return (
                        <button
                          key={field.key}
                          type="button"
                          onClick={() => field.docType && onUploadDocument?.(field.docType)}
                          className="flex items-center justify-between rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-left"
                        >
                          <span className="min-w-0">
                            <span className="mb-0.5 block text-[11.5px] font-semibold text-[#8A7F75]">{field.label}</span>
                            {/* Mono is for document numbers. "Not uploaded" is a sentence. */}
                            {field.value ? (
                              <span className="block truncate font-mono text-sm font-medium text-foreground">{field.value}</span>
                            ) : (
                              <span className="block text-sm font-medium text-[#B0A597]">Not uploaded yet</span>
                            )}
                          </span>
                          <span className="flex-none text-[12px] font-bold text-primary">
                            {field.value ? 'Replace' : 'Upload'}
                          </span>
                        </button>
                      );
                    }
                    return (
                      <label key={field.key} className="block">
                        <span className="mb-1.5 flex items-baseline gap-1.5 text-[11.5px] font-semibold text-[#8A7F75]">
                          {field.label}
                          {field.optional && <span className="font-medium text-[#B0A597]">optional</span>}
                          {/*
                            Said before Save, not after. Learning that a change
                            costs a verification step only once you have
                            committed to it is how a form feels like a trap.
                          */}
                          {field.verify && (
                            <span className="ml-auto font-medium text-[#B0A597]">
                              {field.verify === 'EMAIL' ? 'we’ll email a code' : 'we’ll send a code'}
                            </span>
                          )}
                        </span>
                        {field.type === 'select' ? (
                          <div className="relative">
                            <select
                              value={values[field.key] ?? ''}
                              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                              className={`${inputClass} appearance-none pr-10`}
                            >
                              <option value="">Choose one</option>
                              {field.options?.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B0A597]" />
                          </div>
                        ) : (
                          <>
                            <input
                              type={field.type}
                              value={values[field.key] ?? ''}
                              placeholder={field.placeholder}
                              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                              className={inputClass}
                            />
                            {/*
                              A native date input renders in the browser's locale —
                              `05/21/2006` on a US-defaulted phone, for an Indian
                              birthday. Restating it removes the ambiguity without
                              fighting a control we cannot style.
                            */}
                            {field.type === 'date' && values[field.key] && (
                              <span className="mt-1 block text-[11px] font-medium text-[#B0A597]">
                                {readableDate(values[field.key])}
                              </span>
                            )}
                          </>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && otpSent && changedVerified.length > 0 && (
          <div className="stayo-accordion-reveal mt-5 rounded-2xl border border-[#E7DDD1] bg-card p-4">
            <div className="font-display text-[13px] font-bold text-foreground">
              Enter the code we sent
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              We sent a 6-digit code {verifyChannel === 'EMAIL' ? 'to' : 'on WhatsApp to'}{' '}
              {values[changedVerified[0]]}. Nobody has to approve this — proving it is yours
              is the only step.
            </p>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="······"
              className="mt-3 w-full rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-center text-[18px] font-bold tracking-[0.4em] text-foreground outline-none focus:border-primary"
            />
            {otpError && <p className="mt-2 text-[11.5px] font-semibold text-[#B4453A]">{otpError}</p>}
          </div>
        )}

        {editing && !otpSent && otpError && (
          <p className="mt-3 text-[11.5px] font-semibold text-[#B4453A]">{otpError}</p>
        )}
      </div>

      <div
        className="flex-none border-t px-[18px] pb-[26px] pt-3.5"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        {!editing ? (
          <button
            type="button"
            onClick={enterEdit}
            className="w-full rounded-2xl bg-[#A45D44] py-4 text-center font-display text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(164,93,68,0.25)]"
          >
            {editButtonLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving || sendingOtp || (otpSent && otp.length < 6)}
            className={
              hasChanges
                ? 'w-full rounded-2xl bg-[#A45D44] py-4 text-center font-display text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(164,93,68,0.25)] disabled:opacity-60'
                : 'w-full rounded-2xl border border-[#E4DACE] bg-card py-4 text-center font-display text-[15px] font-bold text-[#B0A597]'
            }
          >
            {isSaving || sendingOtp
              ? 'Working…'
              : otpSent
                ? 'Confirm and save'
                : changedVerified.length > 0
                  ? 'Send code'
                  : hasChanges
                    ? `Save ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}`
                    : 'Nothing to save yet'}
          </button>
        )}
      </div>
    </div>
  );
}
