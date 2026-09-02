import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelIdentity, useUpdateHostelPolicy, useUploadHostelLogo, useRemoveHostelLogo } from '@features/settings/settingsHooks';
import { HOSTEL_TYPE_OPTIONS } from '@features/owner-hostel-builder/hostelType';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { legalNameToStore } from '../config/legalName';
import { hasChanges } from '../config/dirtyState';

interface IdentityFields {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  upiId: string;
  gstNumber: string;
  /** `hostels.hostel_type` — decides whether tenants are asked their gender. */
  hostelType: string;
  /** `policy.branding.legal_name` — the only field here that is not on the
   *  hostel row itself, and the only one that had no editor anywhere. */
  legalName: string;
}

const EMPTY_IDENTITY: IdentityFields = {
  name: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  upiId: '',
  gstNumber: '',
  hostelType: '',
  legalName: '',
};

/**
 * Sentence case, not SHOUTING CAPS. Nine stacked uppercase labels read as nine
 * warnings; owners here are not technical and the form should feel like
 * answering questions, not filling a database row.
 */
const labelStyle = 'text-[12px] font-semibold text-muted-foreground';
const hintStyle = 'mt-1 block text-[11px] leading-[1.45] text-muted-foreground';
const inputStyle =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/**
 * More → Settings → Hostel Identity. Real data via `useHostelPolicy`
 * (`GET /hostels/:id/preferences`, `.hostel` field) and `useUpdateHostel
 * Identity`/`useUploadHostelLogo`/`useRemoveHostelLogo` (`PATCH /hostels/
 * :id`, `POST`/`DELETE /hostels/:id/logo`). Mounted at both
 * `/owner/more/hostel` (Settings' own entry point — edits the owner's
 * primary hostel, same single-hostel limitation as the Billing screen since
 * the original design has no hostel picker there) and
 * `/owner/more/hostel/:hostelId` (the per-card "Edit hostel details" option
 * on the dashboard, which knows exactly which hostel it means).
 */
export function MoreHostelIdentityPage() {
  const navigate = useNavigate();
  const { hostelId: hostelIdParam } = useParams<{ hostelId?: string }>();
  const session = useOwnerSession();
  const hostelId = hostelIdParam ?? session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelIdentity(hostelId ?? '');
  // `legal_name` lives on the policy, not the hostel row, so it saves through
  // a second mutation fired alongside the first.
  const updatePolicyMutation = useUpdateHostelPolicy(hostelId ?? '');
  const uploadLogoMutation = useUploadHostelLogo(hostelId ?? '');
  const removeLogoMutation = useRemoveHostelLogo(hostelId ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** One object rather than eight useStates, so the baseline comparison that
   *  decides whether Save exists is a single exact check. */
  const [fields, setFields] = useState<IdentityFields>(EMPTY_IDENTITY);
  const [baseline, setBaseline] = useState<IdentityFields | null>(null);

  const hostel = policyQuery.data?.hostel;

  useEffect(() => {
    if (hostel) {
      const loaded: IdentityFields = {
        name: hostel.name ?? '',
        phone: hostel.phone ?? '',
        address: hostel.address ?? '',
        city: hostel.city ?? '',
        state: hostel.state ?? '',
        pincode: hostel.pincode ?? '',
        upiId: hostel.upi_id ?? '',
        gstNumber: hostel.gst_number ?? '',
        hostelType: hostel.hostel_type ?? '',
        legalName: (policyQuery.data?.policy as any)?.branding?.legal_name ?? '',
      };
      setFields(loaded);
      setBaseline(loaded);
    }
  }, [hostel, policyQuery.data]);

  const set = <K extends keyof IdentityFields>(key: K, value: IdentityFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const { name, phone, address, city, state, pincode, upiId, gstNumber, hostelType, legalName } = fields;
  const dirty = hasChanges(baseline, fields);

  const save = () => {
    if (!name.trim()) {
      stayoToast.error('Hostel name is required');
      return;
    }
    updateMutation.mutate(
      {
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        pincode: pincode.trim() || null,
        upi_id: upiId.trim() || null,
        gst_number: gstNumber.trim() || null,
        hostel_type: hostelType || null,
      },
      {
        onSuccess: () => {
          // A registered name identical to the hostel name is a duplicate,
          // not an answer — it freezes the receipt's name against a later
          // rename. Stored as null so the hostel name keeps doing the work.
          const nextLegalName = legalNameToStore(legalName, name);
          if (nextLegalName !== (baseline?.legalName?.trim() || null)) {
            updatePolicyMutation.mutate({ branding: { legal_name: nextLegalName } });
          }
          stayoToast.success('Hostel identity updated');
          navigate(-1);
        },
        onError: () => stayoToast.error('Could not update hostel identity'),
      },
    );
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    uploadLogoMutation.mutate(file, {
      onSuccess: () => stayoToast.success('Logo updated'),
      onError: () => stayoToast.error('Could not upload logo'),
    });
  };

  return (
    <div className={`flex flex-col gap-6 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader title="Hostel identity" />

      {policyQuery.isLoading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          {/*
            No cards. Every field sat inside a white card on a near-white
            ground, so a white input had nothing to sit against and the edge
            that says *type here* washed out — the same fault Details had.
            Fields now sit on the page under a section heading, which is also
            what Password and Payouts do, so the owner's account screens read
            as one design rather than four.

            Sections are the questions an owner is answering, not the tables
            the fields land in.
          */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionLabel}>What tenants see</h2>

            <div className="flex items-center gap-3.5">
              <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl bg-secondary">
                {hostel?.logo_url ? (
                  <img src={hostel.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-lg font-bold text-primary">
                    {name ? name[0]?.toUpperCase() : 'H'}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                {/*
                  One primary action, and Remove is its own control rather than
                  underlined red text inside the hint sentence — a destructive
                  action should not sit in running copy, where it is reached by
                  someone aiming at the words around it.
                */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={uploadLogoMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl border border-border bg-card px-3.5 py-2 font-display text-[12.5px] font-bold text-foreground disabled:opacity-50"
                  >
                    {uploadLogoMutation.isPending ? 'Uploading…' : hostel?.logo_url ? 'Change logo' : 'Add logo'}
                  </button>
                  {hostel?.logo_url && (
                    <button
                      type="button"
                      disabled={removeLogoMutation.isPending}
                      onClick={() =>
                        removeLogoMutation.mutate(undefined, {
                          onSuccess: () => stayoToast.success('Logo removed'),
                        })
                      }
                      className="px-1.5 py-2 text-[12px] font-semibold text-muted-foreground disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <span className={hintStyle}>Shown on receipts and your Stayo listing.</span>
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>Hostel name</span>
              <input value={name} onChange={(e) => set('name', e.target.value)} className={inputStyle} />
              <span className={hintStyle}>Tenants see this everywhere — invites, receipts and reminders.</span>
            </label>

            {/*
              A dropdown, not a 2×2 grid of buttons. It is one choice from four
              short options, and as a grid it took ~100px and rendered heavier
              than the hostel's own name directly below it — which is the more
              important field on the screen.
            */}
            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>Who stays here</span>
              <div className="relative">
                <select
                  value={hostelType}
                  onChange={(e) => set('hostelType', e.target.value)}
                  className={`${inputStyle} appearance-none pr-10`}
                >
                  <option value="">Not set</option>
                  {HOSTEL_TYPE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={2}
                />
              </div>
              <span className={hintStyle}>
                {hostelType
                  ? HOSTEL_TYPE_OPTIONS.find((o) => o.code === hostelType)?.hint
                  : 'While this is unset, every tenant is asked their gender when they join.'}
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>Phone</span>
              <input
                value={phone}
                onChange={(e) => set('phone', e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="Number tenants can call"
                className={inputStyle}
              />
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className={sectionLabel}>Where you are</h2>

            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>Street address</span>
              {/*
                A textarea, because a real address is two or three lines. The
                hint now says what belongs here: the field was collecting the
                city, state and pincode that are asked for again directly
                below, so owners were typing the same facts twice.
              */}
              <textarea
                value={address}
                onChange={(e) => set('address', e.target.value)}
                rows={2}
                className={`${inputStyle} resize-none`}
              />
              <span className={hintStyle}>Building and street only — city, state and pincode are below.</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={labelStyle}>City</span>
                <input value={city} onChange={(e) => set('city', e.target.value)} className={inputStyle} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelStyle}>State</span>
                <input value={state} onChange={(e) => set('state', e.target.value)} className={inputStyle} />
              </label>
            </div>

            {/* Half width: a six-digit field stretched across the screen reads
                as though more is expected. */}
            <label className="flex w-1/2 flex-col gap-1.5 pr-1.5">
              <span className={labelStyle}>Pincode</span>
              <input
                value={pincode}
                onChange={(e) => set('pincode', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                className={inputStyle}
              />
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className={sectionLabel}>On receipts and paperwork</h2>

            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>Registered name</span>
              <input
                value={legalName}
                onChange={(e) => set('legalName', e.target.value)}
                placeholder={name || 'Same as hostel name'}
                className={inputStyle}
              />
              <span className={hintStyle}>
                Only if your legal entity is named differently. Left blank, receipts use the hostel name — and keep
                following it if you rename the hostel.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>GST number</span>
              <input
                value={gstNumber}
                onChange={(e) => set('gstNumber', e.target.value.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
                autoCapitalize="characters"
                className={`${inputStyle} uppercase`}
              />
              <span className={hintStyle}>Printed on every receipt once set. Leave blank if you do not charge GST.</span>
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className={sectionLabel}>How tenants pay you</h2>

            <label className="flex flex-col gap-1.5">
              <span className={labelStyle}>UPI ID</span>
              <input
                value={upiId}
                onChange={(e) => set('upiId', e.target.value)}
                placeholder="name@bank"
                className={inputStyle}
              />
              <span className={hintStyle}>
                Shown to tenants paying by UPI. This is not where Stayo settles your rent — that is your bank account,
                under Profile → Payouts.
              </span>
            </label>
          </section>
        </>
      )}

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => baseline && setFields(baseline)}
        label="Save changes"
      />
    </div>
  );
}
