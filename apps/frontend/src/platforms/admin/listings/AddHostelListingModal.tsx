import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { tintForId } from '../theme/palette';

/**
 * "Add Hostel Listing" — picks an EXISTING Stayo hostel to author a listing
 * for. This never creates a hostel (that's StayoListedPanel's "List a hostel",
 * for properties nobody runs here yet); it opens the same canonical-listing
 * editor an owner uses, creating/reusing that hostel's one listing.
 */
export function AddHostelListingModal({
  onClose, onPick,
}: {
  onClose: () => void;
  onPick: (hostelId: string) => void;
}) {
  const [search, setSearch] = useState('');

  const hostels = useQuery({
    queryKey: ['admin', 'hostels', 'add-listing-search', search],
    queryFn: () => platformAdminService.getHostels({ search: search || undefined }),
    staleTime: 15_000,
  });

  const rows = hostels.data ?? [];

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-[adFade_.2s_ease] bg-[rgba(28,22,18,.44)]"
      />
      <div className="relative flex w-full max-w-[520px] animate-[adUp_.24s_ease] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_24px_60px_rgba(30,20,12,.3)]">
        <div className="border-b border-[#F2ECE5] px-6 py-5">
          <div className="font-admin text-[16px] font-extrabold tracking-[-0.01em] text-[#221E1A]">
            Add hostel listing
          </div>
          <div className="mt-0.5 text-[12px] text-[#8A7F75]">
            Pick a hostel that's already on Stayo — this opens its listing, it never creates a new hostel.
          </div>
        </div>

        <div className="px-6 pt-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-[#E7DDD1] bg-[#FCFAF7] px-3.5 py-2.5">
            <Search className="h-4 w-4 flex-none text-[#988D82]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by hostel, owner, city or phone…"
              className="w-full min-w-0 border-none bg-transparent text-[13px] text-[#2A2521] outline-none"
            />
          </div>
        </div>

        <div className="max-h-[320px] overflow-auto px-6 py-4">
          <div className="max-h-[280px] overflow-auto rounded-xl border border-[#EFE6DA]">
            {hostels.isLoading ? (
              <div className="py-8 text-center text-[12px] text-[#8A7F75]">Searching…</div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[#8A7F75]">
                {search ? 'No hostels match that search.' : 'No hostels yet.'}
              </div>
            ) : (
              rows.map((h: any, i: number) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onPick(h.id)}
                  className={`flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[#FCFAF7] ${
                    i > 0 ? 'border-t border-[#F2ECE5]' : ''
                  }`}
                >
                  <span
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-admin text-[11px] font-bold text-white"
                    style={{ background: tintForId(h.id) }}
                  >
                    {String(h.name ?? '?').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-[#2A2521]">{h.name}</span>
                    <span className="block truncate text-[11px] text-[#9A8F84]">
                      {[h.owner, h.city].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex-none text-[11px] font-bold text-[#B46A55]">
                    {h.listing_updated_at ? 'Edit' : 'Start'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t border-[#F2ECE5] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-[#E9DFD3] bg-white py-3 font-admin text-[13px] font-bold text-[#5A5147]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
