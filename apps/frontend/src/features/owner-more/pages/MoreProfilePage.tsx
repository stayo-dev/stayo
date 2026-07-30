import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { ownerService } from '@features/owners/api';
import { useUpdateOwnerProfile } from '@features/settings/settingsHooks';
import { queryKeys } from '@lib/queryKeys';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

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

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');

  useEffect(() => {
    const p = profileQuery.data;
    if (p) {
      setName(p.name ?? '');
      setAddress(p.address ?? '');
      setCity(p.city ?? '');
      setState(p.state ?? '');
      setPincode(p.pincode ?? '');
    }
  }, [profileQuery.data]);

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
          navigate('/owner/more/settings');
        },
        onError: () => stayoToast.error('Could not update your profile'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-28 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/settings" backLabel="Settings" title="My profile" />

      {profileQuery.isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Account</span>
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <label className="block">
                <span className={labelStyle}>Name *</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputStyle} />
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
                <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputStyle} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelStyle}>City</span>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className={inputStyle} />
                </label>
                <label className="block">
                  <span className={labelStyle}>State</span>
                  <input value={state} onChange={(e) => setState(e.target.value)} className={inputStyle} />
                </label>
              </div>
              <label className="block">
                <span className={labelStyle}>Pincode</span>
                <input value={pincode} onChange={(e) => setPincode(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={inputStyle} />
              </label>
            </div>
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-background px-4 py-3 sm:mx-auto sm:max-w-[480px] sm:px-6">
        <button
          type="button"
          onClick={save}
          disabled={updateMutation.isPending || profileQuery.isLoading}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
