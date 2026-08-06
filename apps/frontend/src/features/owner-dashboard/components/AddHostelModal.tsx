import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin, Phone } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { identityService } from '@features/auth/api';
import { ownerService } from '@features/owners/api';
import { isValidIndianMobile } from '@features/owner-onboarding/hooks/onboardingValidation';
import { queryKeys } from '@lib/queryKeys';

interface AddHostelModalProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_FORM = { name: '', address: '', city: '', state: '', pincode: '', phone: '' };

const sectionLabel = 'flex items-center gap-2 text-[13px] font-bold text-foreground';
const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Add Hostel — a quick bottom-sheet for an owner adding a 2nd/3rd hostel,
 * deliberately lighter than the 12-step onboarding wizard (no floors/rooms/
 * rent up front — those are added afterward via the Rooms tab's own "Add
 * Room"/"Add Floor" flow). Submits to `POST /owner/hostels`
 * (`ownerService.createHostel`), which creates a bare `hostels` row and has
 * no floor/room/rent requirements — a real, working endpoint with no prior
 * frontend caller. Password-gated like Change Rent/Change Frequency
 * (`identityService.confirmIdentity(password, 'CREATE_HOSTEL')`), per
 * explicit product direction that adding a hostel should require a step-up
 * confirmation.
 */
export function AddHostelModal({ open, onClose }: AddHostelModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'form' | 'password'>('form');
  const [form, setForm] = useState(EMPTY_FORM);
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('form');
      setForm(EMPTY_FORM);
      setPassword('');
      setFieldError(null);
    }
  }, [open]);

  const setField = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }));

  const mutation = useMutation({
    mutationFn: async () => {
      const identity = await identityService.confirmIdentity(password, 'CREATE_HOSTEL');
      const identityToken = identity?.identity_token;
      if (!identityToken) throw new Error('Identity verification failed. Invalid password.');
      return ownerService.createHostel({
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        phone: form.phone.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.summary() });
      queryClient.invalidateQueries({ queryKey: ['owner', 'hostels'] });
      stayoToast.success(`${form.name.trim()} added`);
      onClose();
    },
  });

  const handleContinue = () => {
    if (form.name.trim().length < 2) return setFieldError('Give your hostel a name.');
    if (form.address.trim().length < 6) return setFieldError('Add the full street address.');
    if (form.city.trim().length < 2) return setFieldError('Which city is it in?');
    if (form.state.trim().length < 2) return setFieldError('Which state is it in?');
    if (!/^\d{6}$/.test(form.pincode.trim())) return setFieldError('Enter a valid 6-digit pincode.');
    if (!isValidIndianMobile(form.phone)) return setFieldError('Enter a valid 10-digit Indian mobile number.');
    setFieldError(null);
    setStep('password');
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={step === 'password' ? 'Confirm your password' : 'Add hostel'}>
      {step === 'form' ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>
              <Building2 className="h-4 w-4 text-primary" strokeWidth={1.9} /> Basic Information
            </span>
            <label className="block">
              <span className={labelStyle}>Hostel Name *</span>
              <input
                value={form.name}
                onChange={(e) => setField({ name: e.target.value })}
                placeholder="e.g. Sri Adithya Boys Hostel"
                className={inputStyle}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>
              <MapPin className="h-4 w-4 text-primary" strokeWidth={1.9} /> Location Details
            </span>
            <label className="block">
              <span className={labelStyle}>Street Address *</span>
              <input
                value={form.address}
                onChange={(e) => setField({ address: e.target.value })}
                placeholder="Enter full address"
                className={inputStyle}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelStyle}>City *</span>
                <input value={form.city} onChange={(e) => setField({ city: e.target.value })} placeholder="City" className={inputStyle} />
              </label>
              <label className="block">
                <span className={labelStyle}>State *</span>
                <input value={form.state} onChange={(e) => setField({ state: e.target.value })} placeholder="State" className={inputStyle} />
              </label>
            </div>
            <label className="block">
              <span className={labelStyle}>Pincode *</span>
              <input
                value={form.pincode}
                onChange={(e) => setField({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                inputMode="numeric"
                placeholder="560001"
                className={inputStyle}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className={sectionLabel}>
              <Phone className="h-4 w-4 text-primary" strokeWidth={1.9} /> Contact Information
            </span>
            <label className="block">
              <span className={labelStyle}>Contact Number *</span>
              <input
                value={form.phone}
                onChange={(e) => setField({ phone: e.target.value.replace(/[^\d+ ]/g, '') })}
                placeholder="+91 98765 43210"
                className={inputStyle}
              />
            </label>
          </div>

          {fieldError && <p className="text-[11.5px] font-semibold text-destructive">{fieldError}</p>}

          <button
            type="button"
            onClick={handleContinue}
            className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground"
          >
            Continue
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary font-display text-lg font-bold text-primary">••</span>
          <p className="font-display text-base font-extrabold text-foreground">Confirm with your password</p>
          <p className="max-w-[280px] text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Adding <b className="text-foreground">{form.name.trim()}</b> requires your account password.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoFocus
            className="mt-1 w-full rounded-[14px] border-[1.5px] border-border bg-card px-4 py-3.5 text-center text-[15px] font-semibold tracking-widest text-foreground focus:border-primary focus:outline-none"
          />
          {mutation.isError && (
            <p className="text-[11.5px] font-semibold text-destructive">{getErrorMessage(mutation.error, 'Could not add this hostel. Please try again.')}</p>
          )}
          <div className="mt-1 flex w-full gap-2.5">
            <button
              type="button"
              onClick={() => setStep('form')}
              disabled={mutation.isPending}
              className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!password.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
              className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending ? 'Adding…' : 'Confirm & Add'}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
