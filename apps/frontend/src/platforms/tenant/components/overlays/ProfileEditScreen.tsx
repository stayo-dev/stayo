import { useState } from 'react';
import { ChevronLeft, Lock } from 'lucide-react';
import type { DetailSection, OverlayTone } from './types';
import { TONE_COLOR } from './types';
import { Section, sectionLabel, card } from './Section';

export interface ProfileEditField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'document';
  value: string;
  options?: string[];
  /** Needs owner approval before it takes effect (only phone/email, per product decision) — direct fields save immediately. */
  governed?: boolean;
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
  pendingRequest: PendingRequestSummary | null;
  isSaving: boolean;
  onBack: () => void;
  onSaveDirect: (patch: Record<string, string>) => Promise<void>;
  onSubmitGoverned: (fields: Record<string, string>, reason: string) => Promise<void>;
  /** Opens the existing document-upload flow for a `type: 'document'` field (e.g. Aadhaar) instead of a text input. */
  onUploadDocument?: (docType: string) => void;
}

/**
 * Profile "Your details" screen — read-only card view (matching Stayo Tenant.dc.html
 * exactly) by default, switching to an editable form in the same card layout on tap.
 * Direct fields save immediately via `PATCH /api/tenants/me/profile`; governed fields
 * (phone/email only, locked icon) queue a `POST /api/tenants/me/profile-requests`
 * change request pending owner approval instead. Opening edit mode never itself
 * requires approval.
 */
export function ProfileEditScreen({
  title,
  sub,
  viewSections,
  headPill,
  pillTone,
  editButtonLabel,
  sections,
  pendingRequest,
  isSaving,
  onBack,
  onSaveDirect,
  onSubmitGoverned,
  onUploadDocument,
}: ProfileEditScreenProps) {
  const [editing, setEditing] = useState(false);
  const initial = Object.fromEntries(sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);

  const allFields = sections.flatMap((s) => s.fields);
  const changedKeys = allFields.filter((f) => f.type !== 'document' && (values[f.key] ?? '') !== (f.value ?? '')).map((f) => f.key);
  const changedGoverned = changedKeys.filter((k) => allFields.find((f) => f.key === k)?.governed);
  const changedDirect = changedKeys.filter((k) => !allFields.find((f) => f.key === k)?.governed);
  const hasChanges = changedKeys.length > 0;
  const pendingKeys = pendingRequest ? Object.keys(pendingRequest.diff) : [];

  const enterEdit = () => {
    setValues(Object.fromEntries(sections.flatMap((s) => s.fields.map((f) => [f.key, f.value]))));
    setEditing(true);
  };

  const handleSave = async () => {
    if (changedGoverned.length > 0 && !showReason) {
      setShowReason(true);
      return;
    }
    if (changedDirect.length > 0) {
      const patch = Object.fromEntries(changedDirect.map((k) => [k, values[k]]));
      await onSaveDirect(patch);
    }
    if (changedGoverned.length > 0) {
      if (!reason.trim()) return;
      const fields = Object.fromEntries(changedGoverned.map((k) => [k, values[k]]));
      await onSubmitGoverned(fields, reason.trim());
      setReason('');
      setShowReason(false);
    }
    setEditing(false);
  };

  const pillTheme = pillTone ? TONE_COLOR[pillTone] : null;

  return (
    <div className="stayo-panel-slide-in fixed inset-0 z-[45] flex flex-col bg-background">
      <div className="flex flex-none items-center gap-3 border-b border-[#EEE4D8] px-[18px] pb-3 pt-14">
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
        {pendingRequest && (
          <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-[#F1E2C4] bg-warning-bg p-[13px_15px]">
            <Lock className="h-4 w-4 flex-none text-warning" />
            <p className="flex-1 text-[12px] font-semibold text-[#7A5A24]">
              A change to {pendingKeys.length} field{pendingKeys.length === 1 ? '' : 's'} is awaiting your owner's approval.
            </p>
          </div>
        )}

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
                    const locked = field.governed && pendingKeys.includes(field.key);
                    if (field.type === 'document') {
                      return (
                        <button
                          key={field.key}
                          type="button"
                          onClick={() => field.docType && onUploadDocument?.(field.docType)}
                          className="flex items-center justify-between rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-left"
                        >
                          <span>
                            <span className="mb-0.5 block text-[11.5px] font-semibold text-[#8A7F75]">{field.label}</span>
                            <span className="font-mono text-sm font-medium text-foreground">{field.value || 'Not uploaded'}</span>
                          </span>
                          <span className="flex-none text-[12px] font-bold text-primary">Re-upload</span>
                        </button>
                      );
                    }
                    return (
                      <label key={field.key} className="block">
                        <span className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#8A7F75]">
                          {field.label}
                          {field.governed && <Lock className="h-3 w-3 text-[#B0A597]" />}
                        </span>
                        {field.type === 'select' ? (
                          <select
                            value={values[field.key] ?? ''}
                            disabled={locked}
                            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                            className="w-full rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-sm font-medium text-foreground outline-none focus:border-primary disabled:opacity-50"
                          >
                            <option value="">—</option>
                            {field.options?.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            value={values[field.key] ?? ''}
                            disabled={locked}
                            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                            className="w-full rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-sm font-medium text-foreground outline-none focus:border-primary disabled:opacity-50"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && showReason && changedGoverned.length > 0 && (
          <div className="stayo-accordion-reveal mt-5 rounded-2xl border border-[#F1E2C4] bg-warning-bg p-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-warning" />
              <span className="font-display text-[13px] font-bold text-[#7A5A24]">Needs owner approval</span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[#7A5A24]">
              {allFields.filter((f) => changedGoverned.includes(f.key)).map((f) => f.label).join(', ')} will only update once your owner approves it.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell your owner why you're requesting this change"
              className="mt-3 min-h-[76px] w-full resize-none rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-[13px] font-medium text-foreground outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      <div className="flex-none border-t border-[#EEE4D8] bg-background px-[18px] pb-[26px] pt-3.5">
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
            disabled={!hasChanges || isSaving || (showReason && changedGoverned.length > 0 && !reason.trim())}
            className="w-full rounded-2xl bg-[#A45D44] py-4 text-center font-display text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(164,93,68,0.25)] disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : showReason && changedGoverned.length > 0 ? 'Submit for approval' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}
