import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Info } from 'lucide-react';

import type { IdentityPatch, ProfileType } from '@features/profile/api';
import { useProfileIdentity, useUpdateProfileIdentity } from '@features/profile/hooks/useProfileIdentity';

import { PrimaryButton } from './components/DiscoverShell';
import { C, FONT } from './discoverTheme';

/**
 * The portable profile's editor (phase B).
 *
 * Reachable with **no hostel involved** — that is the requirement this screen
 * exists for. A tenant fills it in before enquiring anywhere, and every later
 * onboarding opens pre-filled instead of asking again.
 */

type FieldKind = 'text' | 'date' | 'number' | 'textarea' | 'select';

interface FieldSpec {
  name: keyof IdentityPatch;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Part of the set onboarding needs before it can skip asking. */
  core?: boolean;
}

const PERSONAL: FieldSpec[] = [
  { name: 'date_of_birth', label: 'Date of birth', kind: 'date', core: true },
  {
    name: 'gender',
    label: 'Gender',
    kind: 'select',
    core: true,
    options: [
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
      { value: 'Other', label: 'Other' },
    ],
  },
  { name: 'nationality', label: 'Nationality', kind: 'text', placeholder: 'Indian' },
  { name: 'personal_email', label: 'Personal email', kind: 'text', placeholder: 'you@example.com' },
  { name: 'permanent_address', label: 'Permanent address', kind: 'textarea', core: true, placeholder: 'Your home address' },
];

const GUARDIAN: FieldSpec[] = [
  { name: 'guardian_name', label: 'Guardian name', kind: 'text', core: true },
  { name: 'guardian_phone', label: 'Guardian phone', kind: 'text', core: true, placeholder: '+91…' },
  { name: 'guardian_relation', label: 'Relationship', kind: 'text', placeholder: 'Father, mother, guardian…' },
];

const ACADEMIC: FieldSpec[] = [
  { name: 'college_name', label: 'College', kind: 'text' },
  { name: 'course', label: 'Course', kind: 'text', placeholder: 'B.Tech CSE' },
  { name: 'year_of_study', label: 'Year of study', kind: 'number' },
  { name: 'branch', label: 'Branch', kind: 'text' },
  { name: 'roll_number', label: 'Roll number', kind: 'text' },
];

const PROFESSIONAL: FieldSpec[] = [
  { name: 'office_name', label: 'Company', kind: 'text' },
  { name: 'job_role', label: 'Role', kind: 'text' },
  { name: 'office_location', label: 'Office location', kind: 'text' },
];

export function ProfileEditPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useProfileIdentity();
  const update = useUpdateProfileIdentity();

  const [draft, setDraft] = useState<IdentityPatch>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Your details — Stayo';
  }, []);

  const profileType: ProfileType =
    (draft.profile_type as ProfileType) ?? data?.profile_type ?? 'STUDENT';

  const value = (name: keyof IdentityPatch): string => {
    const raw = name in draft ? draft[name] : (data as any)?.[name];
    if (raw === null || raw === undefined) return '';
    // The API returns an ISO timestamp; <input type="date"> wants YYYY-MM-DD.
    if (name === 'date_of_birth') return String(raw).slice(0, 10);
    return String(raw);
  };

  const sections = useMemo(
    () => [
      { title: 'About you', fields: PERSONAL },
      { title: 'Guardian', fields: GUARDIAN, note: 'Hostels ask for a guardian contact at move-in.' },
      profileType === 'WORKING_PROFESSIONAL'
        ? { title: 'Work', fields: PROFESSIONAL }
        : { title: 'Studies', fields: ACADEMIC },
    ],
    [profileType],
  );

  const save = () => {
    setError(null);
    if (Object.keys(draft).length === 0) {
      navigate('/profile');
      return;
    }
    update.mutate(draft, {
      onSuccess: () => {
        setDraft({});
        setSaved(true);
        setTimeout(() => setSaved(false), 2200);
      },
      onError: (mutationError: any) =>
        setError(mutationError?.response?.data?.message ?? 'Could not save. Please try again.'),
    });
  };

  const missing = data?.missing_core_fields ?? [];

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/profile')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
            Your details
          </h1>
          <p className="text-[11.5px]" style={{ color: C.textMuted }}>
            Filled once, reused at every hostel
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-6 px-5 py-5">
        {/* Why this screen exists, said plainly */}
        <div
          className="flex gap-3 rounded-2xl border p-4"
          style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}
        >
          <Info className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.clay }} />
          <p className="text-[11.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
            You don't need a hostel to fill this in. When you join one, its onboarding opens with
            these details already there — and so does the one after that.
          </p>
        </div>

        {!isLoading && missing.length > 0 && (
          <p className="px-1 text-[12px] font-semibold" style={{ color: C.amber }}>
            {missing.length} detail{missing.length === 1 ? '' : 's'} left before onboarding can skip ahead.
          </p>
        )}

        {/* Student vs working professional decides which section shows */}
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            You are
          </h2>
          <div className="flex gap-2">
            {(['STUDENT', 'WORKING_PROFESSIONAL'] as ProfileType[]).map((type) => {
              const active = profileType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, profile_type: type }))}
                  aria-pressed={active}
                  className="flex-1 rounded-xl py-3 text-[12.5px] font-semibold"
                  style={{
                    background: active ? C.clayPaleBg : '#fff',
                    border: active ? `1.5px solid ${C.clay}` : `1px solid ${C.lineInput}`,
                    color: active ? '#A4482F' : C.textBody,
                  }}
                >
                  {type === 'STUDENT' ? 'A student' : 'Working'}
                </button>
              );
            })}
          </div>
        </section>

        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
              {section.title}
            </h2>
            <div
              className="overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
            >
              {section.fields.map((field, index) => (
                <Field
                  key={field.name as string}
                  spec={field}
                  value={value(field.name)}
                  first={index === 0}
                  missing={missing.includes(field.name as string)}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      [field.name]: field.kind === 'number' ? (next === '' ? null : Number(next)) : next,
                    }))
                  }
                />
              ))}
            </div>
            {'note' in section && section.note && (
              <p className="mt-2 px-1 text-[11px]" style={{ color: C.textFaint }}>
                {section.note}
              </p>
            )}
          </section>
        ))}

        {error && (
          <p
            role="alert"
            className="rounded-xl px-3.5 py-3 text-[12.5px] font-medium"
            style={{ background: '#F7E4DF', color: '#B3402F' }}
          >
            {error}
          </p>
        )}
      </main>

      <div
        className="sticky bottom-0 flex-none border-t px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <PrimaryButton full disabled={update.isPending} onClick={save}>
          {update.isPending ? 'Saving…' : saved ? 'Saved' : 'Save details'}
        </PrimaryButton>
      </div>
    </div>
  );
}

function Field({
  spec,
  value,
  onChange,
  first,
  missing,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (next: string) => void;
  first: boolean;
  missing: boolean;
}) {
  const id = `field-${String(spec.name)}`;
  const inputStyle = {
    color: C.inkSoft,
    fontFamily: FONT.body,
  } as const;

  return (
    <div className="px-4 py-3" style={{ borderTop: first ? 'none' : `1px solid ${C.lineSoft}` }}>
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.02em]"
        style={{ color: missing ? C.amber : C.textGhost }}
      >
        {spec.label}
        {spec.core && <span aria-hidden style={{ color: C.clay }}>•</span>}
        {!missing && value && <Check className="h-3 w-3" strokeWidth={3} style={{ color: C.green }} />}
      </label>

      {spec.kind === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          rows={2}
          placeholder={spec.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full resize-none bg-transparent text-[13.5px] font-semibold outline-none"
          style={inputStyle}
        />
      ) : spec.kind === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full bg-transparent text-[13.5px] font-semibold outline-none"
          style={inputStyle}
        >
          <option value="">Select…</option>
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={spec.kind === 'date' ? 'date' : spec.kind === 'number' ? 'number' : 'text'}
          value={value}
          placeholder={spec.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full bg-transparent text-[13.5px] font-semibold outline-none"
          style={inputStyle}
        />
      )}
    </div>
  );
}
