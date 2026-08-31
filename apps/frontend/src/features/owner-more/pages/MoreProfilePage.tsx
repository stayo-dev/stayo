import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { ownerService } from '@features/owners/api';
import { useUpdateOwnerProfile } from '@features/settings/settingsHooks';
import { queryKeys } from '@lib/queryKeys';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { hasChanges } from '../config/dirtyState';

interface ProfileFields {
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_PROFILE: ProfileFields = { name: '', address: '', city: '', state: '', pincode: '' };

interface OwnerProfile {
  name: string;
  email: string;
  phone: string;
  role: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

/**
 * More → Settings → My Profile. Real data via `ownerService.getProfile`
 * (`GET /owner/me/profile`) and `useUpdateOwnerProfile` (`PATCH /owner/me/
 * profile`). Phone/email are read-only here — changing phone requires a
 * separate OTP-verification step the backend enforces (`phone_otp`), out of
 * scope for this pass; name/address are freely editable.
 */
export function MoreProfilePage() {
  const navigate = useNavigate();
  const profileQuery = useQuery({
    queryKey: queryKeys.owner.profile(),
    queryFn: async () => (await ownerService.getProfile())?.data?.owner as OwnerProfile,
    staleTime: 60_000,
  });
  const updateMutation = useUpdateOwnerProfile();

  /** One object so the baseline comparison behind Save is a single exact check. */
  const [fields, setFields] = useState<ProfileFields>(EMPTY_PROFILE);
  const [baseline, setBaseline] = useState<ProfileFields | null>(null);

  useEffect(() => {
    const p = profileQuery.data;
    if (p) {
      const loaded: ProfileFields = {
        name: p.name ?? '',
        address: p.address ?? '',
        city: p.city ?? '',
        state: p.state ?? '',
        pincode: p.pincode ?? '',
      };
      setFields(loaded);
      setBaseline(loaded);
    }
  }, [profileQuery.data]);

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const { name, address, city, state, pincode } = fields;
  const dirty = hasChanges(baseline, fields);

  const save = () => {
    if (!name.trim()) {
      stayoToast.error('Name is required');
      return;
    }
    updateMutation.mutate(
      { name: name.trim(), address: address.trim() || null, city: city.trim() || null, state: state.trim() || null, pincode: pincode.trim() || null },
      {
        onSuccess: () => {
          stayoToast.success('Profile updated');
          navigate('/owner/more');
        },
        onError: () => stayoToast.error('Could not update your profile'),
      },
    );
  };

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader backTo="/owner/more" backLabel="Configuration" title="My profile" />

      {profileQuery.isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Account</span>
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <label className="block">
                <span className={labelStyle}>Name *</span>
                <input value={name} onChange={(e) => set('name', e.target.value)} className={inputStyle} />
              </label>
              <label className="block">
                <span className={labelStyle}>Email</span>
                <input value={profileQuery.data?.email ?? ''} disabled className={`${inputStyle} opacity-60`} />
              </label>
              <label className="block">
                <span className={labelStyle}>Phone</span>
                <input value={profileQuery.data?.phone ?? ''} disabled className={`${inputStyle} opacity-60`} />
                <p className="mt-1 text-[10.5px] text-muted-foreground">Changing your phone number requires OTP verification — not available here yet.</p>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Address</span>
            <div className={`${card} flex flex-col gap-3 p-4`}>
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
