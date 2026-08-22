import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { useToast } from '../layout/toastContext';

/**
 * The hostel's postal address, correctable by an admin.
 *
 * The address is owner-typed and reaches every Discovery card and the listing
 * page, and Stayo's team fields the "the address is wrong" mails — but until now
 * had no way to fix one without asking the owner to do it themselves.
 *
 * Narrow on purpose: five fields, nothing else. Name, phone, pricing and listing
 * state all have their own governed paths, and widening this into a general
 * hostel editor is how those get bypassed.
 *
 * Pairs with [[NavigationBlock]] under one "Location" heading — the address is
 * what the listing *prints*, the Place ID is what Maps *navigates to*, and they
 * are edited together because they describe the same building.
 */

interface AddressDraft {
  address: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY: AddressDraft = { address: '', city: '', state: '', pincode: '' };

const FIELD =
  'w-full rounded-[11px] border border-[#E7DDD1] bg-white px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none focus:border-[#B46A55]';
const LABEL = 'mb-1.5 block text-[11px] font-semibold text-[#8A7F75]';

export function AddressBlock({ hostelId }: { hostelId: string }) {
  const fireToast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AddressDraft>(EMPTY);

  const hostel = useQuery({
    queryKey: ['admin', 'hostel', hostelId],
    queryFn: () => platformAdminService.getHostel(hostelId),
  });

  useEffect(() => {
    const h = hostel.data;
    if (!h) return;
    setDraft({
      address: h.address ?? '',
      city: h.city ?? '',
      state: h.state ?? '',
      pincode: h.pincode ?? '',
    });
  }, [hostel.data, hostelId]);

  const save = useMutation({
    mutationFn: () =>
      platformAdminService.updateHostelAddress(hostelId, {
        address: draft.address.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        pincode: draft.pincode.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'hostel', hostelId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'hostels'] });
    },
  });

  return (
    <div className="rounded-2xl border border-[#EFE6DA] bg-white p-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: '#B46A55' }} />
        <div className="font-admin text-[13.5px] font-bold text-[#221E1A]">Address</div>
        <div className="flex-1" />
        <span className="text-[10.5px] text-[#B0A597]">Shown on the listing</span>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label className={LABEL} htmlFor={`addr-${hostelId}`}>Street address</label>
          <input
            id={`addr-${hostelId}`}
            value={draft.address}
            onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
            placeholder="Ameerpet"
            className={FIELD}
          />
        </div>
        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={LABEL} htmlFor={`city-${hostelId}`}>City</label>
            <input
              id={`city-${hostelId}`}
              value={draft.city}
              onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
              placeholder="Hyderabad"
              className={FIELD}
            />
          </div>
          <div className="flex-1">
            <label className={LABEL} htmlFor={`state-${hostelId}`}>State</label>
            <input
              id={`state-${hostelId}`}
              value={draft.state}
              onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}
              placeholder="Telangana"
              className={FIELD}
            />
          </div>
          <div className="w-[104px] flex-none">
            <label className={LABEL} htmlFor={`pin-${hostelId}`}>Pincode</label>
            <input
              id={`pin-${hostelId}`}
              value={draft.pincode}
              onChange={(e) => setDraft((d) => ({ ...d, pincode: e.target.value }))}
              placeholder="500016"
              inputMode="numeric"
              className={FIELD}
            />
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex justify-end">
        <button
          type="button"
          disabled={save.isPending || !draft.address.trim()}
          onClick={async () => {
            try {
              await save.mutateAsync();
              fireToast('Address updated');
            } catch (error: any) {
              fireToast(
                error?.response?.data?.error?.message || 'Could not update the address',
                'no',
              );
            }
          }}
          className="rounded-[10px] bg-[#B46A55] px-4 py-2 font-admin text-[12px] font-bold text-white disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save address'}
        </button>
      </div>
    </div>
  );
}
