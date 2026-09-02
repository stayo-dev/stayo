import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelIdentity, useUpdateHostelPolicy, useUploadHostelLogo, useRemoveHostelLogo } from '@features/settings/settingsHooks';
import { HOSTEL_TYPE_OPTIONS } from '@features/owner-hostel-builder/hostelType';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
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

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
/**
 * Sentence case, not SHOUTING CAPS. Nine stacked uppercase labels read as nine
 * warnings; owners here are not technical and the form should feel like
 * answering questions, not filling a database row.
 */
const labelStyle = 'mb-1 block text-[12.5px] font-semibold text-foreground';
const hintStyle = 'mt-1.5 block text-[11px] leading-[1.45] text-muted-foreground';
const inputStyle = 'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none';

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
          if (legalName.trim() !== (baseline?.legalName ?? '')) {
            updatePolicyMutation.mutate({ branding: { legal_name: legalName.trim() || null } });
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
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader title="Hostel identity" />

      {policyQuery.isLoading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          {/*
            Sections are the questions an owner is answering, not the tables
            the fields land in. "Details" told them nothing about what the
            details were for; "Payments & Tax" put the UPI they are paid into
            beside a GST number that only appears on receipts.
          */}
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>What tenants see</span>
            <div className={`${card} flex flex-col gap-4 p-4`}>
              <div className="flex items-center gap-3.5">
                <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl bg-secondary">
                  {hostel?.logo_url ? (
                    <img src={hostel.logo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-display text-lg font-bold text-primary">{name ? name[0]?.toUpperCase() : 'H'}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  {/*
                    One primary action. Upload and Remove used to sit side by
                    side at equal width and weight, so a destructive action was
                    as loud as the one an owner actually came for.
                  */}
                  <button
                    type="button"
                    disabled={uploadLogoMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl border border-border bg-card px-4 py-2 font-display text-[12.5px] font-bold text-foreground disabled:opacity-50"
                  >
                    {uploadLogoMutation.isPending ? 'Uploading…' : hostel?.logo_url ? 'Change logo' : 'Add logo'}
                  </button>
                  <span className={hintStyle}>
                    Shown on receipts and your Stayo listing.
                    {hostel?.logo_url && (
                      <>
                        {' '}
                        <button
                          type="button"
                          disabled={removeLogoMutation.isPending}
                          onClick={() => removeLogoMutation.mutate(undefined, { onSuccess: () => stayoToast.success('Logo removed') })}
                          className="font-semibold text-destructive underline underline-offset-2 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/*
            Who this hostel takes. Long a nullable column the backend already
            knew how to use — it derives a tenant's gender from it and skips the
            question during onboarding — but which nothing ever wrote, so it
            stayed NULL and every tenant was asked anyway. New hostels are asked
            in the builder; this is where the rest get set.
          */}
          <div className="block">
            <span className={labelStyle}>Who stays here</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {HOSTEL_TYPE_OPTIONS.map((option) => {
                const selected = hostelType === option.code;
                return (
                  <button
                    key={option.code}
                    type="button"
                    onClick={() => set('hostelType', option.code)}
                    aria-pressed={selected}
                    className={`rounded-xl border-[1.5px] px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${
                      selected ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-card text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <span className={hintStyle}>
              {hostelType
                ? HOSTEL_TYPE_OPTIONS.find((o) => o.code === hostelType)?.hint
                : 'Unset means every tenant is asked their gender when they join.'}
            </span>
          </div>

          <label className="block">
                <span className={labelStyle}>Hostel name</span>
                <input value={name} onChange={(e) => set('name', e.target.value)} className={inputStyle} />
                <span className={hintStyle}>Required. Tenants see this everywhere — invites, receipts and reminders.</span>
              </label>

              <label className="block">
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
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Where you are</span>
            <div className={`${card} flex flex-col gap-4 p-4`}>
              <label className="block">
                <span className={labelStyle}>Address</span>
                {/*
                  A textarea, because a real address is two or three lines. The
                  single-line input truncated most of it out of sight, so an
                  owner could not check what they had typed.
                */}
                <textarea
                  value={address}
                  onChange={(e) => set('address', e.target.value)}
                  rows={2}
                  className={`${inputStyle} resize-none`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelStyle}>City</span>
                  <input value={city} onChange={(e) => set('city', e.target.value)} className={inputStyle} />
                </label>
                <label className="block">
                  <span className={labelStyle}>State</span>
                  <input value={state} onChange={(e) => set('state', e.target.value)} className={inputStyle} />
                </label>
              </div>
              <label className="block w-1/2 pr-1.5">
                <span className={labelStyle}>Pincode</span>
                {/* Half width: a six-digit field stretched across the screen
                    reads as though more is expected. */}
                <input
                  value={pincode}
                  onChange={(e) => set('pincode', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  className={inputStyle}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>On receipts and paperwork</span>
            <div className={`${card} flex flex-col gap-4 p-4`}>
              <label className="block">
                <span className={labelStyle}>Registered name</span>
                <input
                  value={legalName}
                  onChange={(e) => set('legalName', e.target.value)}
                  placeholder={name || 'Same as hostel name'}
                  className={inputStyle}
                />
                <span className={hintStyle}>
                  Only if your legal name differs from the hostel's name. Leave blank to use the hostel name.
                </span>
              </label>
              <label className="block">
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
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>How tenants pay you</span>
            <div className={`${card} flex flex-col gap-4 p-4`}>
              <label className="block">
                <span className={labelStyle}>UPI ID</span>
                <input value={upiId} onChange={(e) => set('upiId', e.target.value)} placeholder="name@bank" className={inputStyle} />
                <span className={hintStyle}>
                  Shown to tenants when they pay by UPI. This is not where Stayo settles your rent — that is your bank
                  account, under Configuration.
                </span>
              </label>
            </div>
          </div>

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
