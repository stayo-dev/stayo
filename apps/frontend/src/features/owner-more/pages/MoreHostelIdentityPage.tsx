import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelIdentity, useUploadHostelLogo, useRemoveHostelLogo } from '@features/settings/settingsHooks';
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
};

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

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
      };
      setFields(loaded);
      setBaseline(loaded);
    }
  }, [hostel]);

  const set = <K extends keyof IdentityFields>(key: K, value: IdentityFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const { name, phone, address, city, state, pincode, upiId, gstNumber } = fields;
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
      },
      {
        onSuccess: () => {
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
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Logo</span>
            <div className={`${card} flex items-center gap-3.5 p-4`}>
              <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl bg-secondary">
                {hostel?.logo_url ? (
                  <img src={hostel.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-lg font-bold text-primary">{name ? name[0]?.toUpperCase() : 'H'}</span>
                )}
              </span>
              <div className="flex flex-1 gap-2">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                <button
                  type="button"
                  disabled={uploadLogoMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-xl border border-border bg-card py-2.5 text-center font-display text-[12.5px] font-bold text-foreground disabled:opacity-50"
                >
                  {uploadLogoMutation.isPending ? 'Uploading…' : 'Upload'}
                </button>
                {hostel?.logo_url && (
                  <button
                    type="button"
                    disabled={removeLogoMutation.isPending}
                    onClick={() => removeLogoMutation.mutate(undefined, { onSuccess: () => stayoToast.success('Logo removed') })}
                    className="flex-1 rounded-xl border border-destructive/25 py-2.5 text-center font-display text-[12.5px] font-bold text-destructive disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Details</span>
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <label className="block">
                <span className={labelStyle}>Hostel Name *</span>
                <input value={name} onChange={(e) => set('name', e.target.value)} className={inputStyle} />
              </label>
              <label className="block">
                <span className={labelStyle}>Phone</span>
                <input value={phone} onChange={(e) => set('phone', e.target.value)} className={inputStyle} />
              </label>
              <label className="block">
                <span className={labelStyle}>Address</span>
                <input value={address} onChange={(e) => set('address', e.target.value)} className={inputStyle} />
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
              <label className="block">
                <span className={labelStyle}>Pincode</span>
                <input value={pincode} onChange={(e) => set('pincode', e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={inputStyle} />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Payments &amp; Tax</span>
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <label className="block">
                <span className={labelStyle}>UPI ID</span>
                <input value={upiId} onChange={(e) => set('upiId', e.target.value)} className={inputStyle} />
              </label>
              <label className="block">
                <span className={labelStyle}>GST Number</span>
                <input value={gstNumber} onChange={(e) => set('gstNumber', e.target.value)} className={inputStyle} />
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
