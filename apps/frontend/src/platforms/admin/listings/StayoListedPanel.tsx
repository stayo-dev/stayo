import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, MessageSquare, UserPlus, X, Search, Info } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { ADMIN_CARD, tintForId } from '../theme/palette';
import { EmptyState } from '../ui';
import { useToast } from '../layout/toastContext';

const HOSTEL_TYPES = [
  { key: 'CO_LIVING', label: 'Co-living' },
  { key: 'BOYS', label: 'Boys' },
  { key: 'GIRLS', label: 'Girls' },
  { key: 'WORKING_PROS', label: 'Working professionals' },
];

/**
 * Hostels Stayo listed itself, for coverage — nobody operates them here yet.
 *
 * The enquiry count is the point of this screen: demand on an unclaimed
 * listing is the argument for approaching that owner, and it flows into the
 * Leads pipeline.
 */
export function StayoListedPanel() {
  const queryClient = useQueryClient();
  const fireToast = useToast();
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<{ id: string; name: string; address: string } | null>(null);

  const listings = useQuery({
    queryKey: ['admin', 'platform-listings'],
    queryFn: () => platformAdminService.getPlatformListings(),
    staleTime: 30_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'platform-listings'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'hostels'] });
  };

  const rows = listings.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 rounded-2xl border border-[#E6DCD1] bg-[#F7F3EF] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 flex-none text-[#8A7F75]" strokeWidth={1.8} />
          <p className="text-[12px] leading-relaxed text-[#5A5147]">
            Listings Stayo authored so Discovery covers a city, not just the hostels that signed up.
            These have no rooms in Stayo, so they never show live vacancy — availability reads as
            unconfirmed until a real owner claims the listing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex flex-none items-center gap-2 rounded-xl bg-[#B46A55] px-[18px] py-3 font-admin text-[12.5px] font-bold text-white shadow-[0_4px_12px_rgba(180,106,85,.28)]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          List a hostel
        </button>
      </div>

      {listings.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading listings…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No Stayo-listed hostels yet"
          message="Add hostels in a city you want covered, write their marketing page, and publish."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((h) => (
            <div key={h.id} className={`${ADMIN_CARD} p-5`}>
              <div className="flex items-start gap-3">
                <span
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-xl font-admin text-[14px] font-bold text-white"
                  style={{ background: tintForId(h.id) }}
                >
                  {h.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-admin text-[14.5px] font-bold tracking-[-0.01em] text-[#221E1A]">
                    {h.name}
                  </div>
                  <div className="mt-0.5 flex items-start gap-1 text-[11.5px] text-[#8A7F75]">
                    <MapPin className="mt-0.5 h-3 w-3 flex-none" strokeWidth={1.8} />
                    <span className="line-clamp-2">{h.address}</span>
                  </div>
                </div>
                <span
                  className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                    h.listing_status === 'LIVE'
                      ? 'bg-[#EAF3EE] text-[#1F7A52]'
                      : 'bg-[#F2ECE5] text-[#8A7F75]'
                  }`}
                >
                  {h.listing_status === 'LIVE' ? 'Live' : 'Not published'}
                </span>
              </div>

              {/* The demand signal — the reason to call this owner. */}
              <div
                className={`mt-4 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 ${
                  h.enquiry_count > 0 ? 'bg-[#FBF1DE]' : 'bg-[#FAF6F1]'
                }`}
              >
                <MessageSquare
                  className={`h-4 w-4 flex-none ${h.enquiry_count > 0 ? 'text-[#B8792B]' : 'text-[#B0A597]'}`}
                  strokeWidth={1.8}
                />
                <span className="text-[12px] text-[#5A5147]">
                  {h.enquiry_count > 0 ? (
                    <>
                      <b className="font-admin text-[13px] text-[#B8792B]">{h.enquiry_count}</b>{' '}
                      {h.enquiry_count === 1 ? 'enquiry' : 'enquiries'} waiting — worth a call
                    </>
                  ) : (
                    'No enquiries yet'
                  )}
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2.5">
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setAssignFor({ id: h.id, name: h.name, address: h.address })}
                  className="flex items-center gap-1.5 rounded-[11px] border border-[#E9DFD3] bg-white px-3.5 py-2.5 font-admin text-[12px] font-bold text-[#5A5147]"
                >
                  <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
                  Assign to owner
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateListingModal
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            refresh();
            fireToast(`${name} listed — now write its marketing page`);
          }}
          onError={() => fireToast('Could not create that listing', 'no')}
        />
      )}

      {assignFor && (
        <AssignOwnerModal
          hostel={assignFor}
          onClose={() => setAssignFor(null)}
          onAssigned={(ownerName) => {
            setAssignFor(null);
            refresh();
            fireToast(`Listing handed to ${ownerName}`);
          }}
          onError={(msg) => fireToast(msg, 'no')}
        />
      )}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-[adFade_.2s_ease] bg-[rgba(28,22,18,.44)]"
      />
      <div className="relative w-full max-w-[520px] animate-[adUp_.24s_ease] overflow-hidden rounded-[20px] bg-white shadow-[0_24px_60px_rgba(30,20,12,.3)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#F2ECE5] px-6 py-5">
          <div>
            <div className="font-admin text-[16px] font-extrabold tracking-[-0.01em] text-[#221E1A]">{title}</div>
            <div className="mt-0.5 text-[12px] text-[#8A7F75]">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-[#F2ECE5]"
          >
            <X className="h-3.5 w-3.5 text-[#7A6F63]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold text-[#5A5147]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-[#A2978B]">{hint}</span>}
    </label>
  );
}

const INPUT =
  'w-full rounded-[11px] border border-[#E7DDD1] bg-[#FCFAF7] px-3.5 py-2.5 text-[13px] text-[#2A2521] outline-none focus:border-[#B46A55] focus:bg-white';

function CreateListingModal({ onClose, onCreated, onError }: {
  onClose: () => void; onCreated: (name: string) => void; onError: () => void;
}) {
  const [form, setForm] = useState({
    name: '', city: '', address: '', phone: '', hostel_type: 'CO_LIVING',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => platformAdminService.createPlatformListing(form),
    onSuccess: () => onCreated(form.name),
    onError,
  });

  const ready = form.name.trim().length > 1 && form.city.trim() && form.address.trim().length > 3 && form.phone.trim().length > 5;

  return (
    <Modal
      title="List a hostel on Stayo"
      subtitle="For a property nobody manages here yet"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3.5 px-6 py-5">
        <Field label="Hostel name">
          <input className={INPUT} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Green Nest Koramangala" />
        </Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="City">
            <input className={INPUT} value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Bengaluru" />
          </Field>
          <Field label="Contact phone" hint="Used to reach the hostel">
            <input className={INPUT} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98860 77120" />
          </Field>
        </div>
        <Field label="Full address">
          <textarea
            className={`${INPUT} min-h-[70px] resize-y`}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="128, 5th Cross, Koramangala 4th Block, Bengaluru 560034"
          />
        </Field>
        <Field label="Who it's for">
          <div className="flex flex-wrap gap-1.5">
            {HOSTEL_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => set('hostel_type', t.key)}
                className={`rounded-full border px-3.5 py-2 text-[12px] font-semibold ${
                  form.hostel_type === t.key
                    ? 'border-[#221E1A] bg-[#221E1A] text-white'
                    : 'border-[#EAE1D8] bg-white text-[#5A5147]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-1 rounded-xl bg-[#FAF6F1] px-3.5 py-3 text-[11.5px] leading-relaxed text-[#8A7F75]">
          This creates the listing only — it stays unpublished until you write its marketing page
          and approve it, exactly like an owner's.
        </div>
      </div>

      <div className="flex gap-3 border-t border-[#F2ECE5] px-6 py-4">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-[#E9DFD3] bg-white py-3 font-admin text-[13px] font-bold text-[#5A5147]">
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || create.isPending}
          onClick={() => create.mutate()}
          className="flex-[1.4] rounded-xl bg-[#B46A55] py-3 font-admin text-[13px] font-bold text-white disabled:opacity-40"
        >
          {create.isPending ? 'Creating…' : 'Create listing'}
        </button>
      </div>
    </Modal>
  );
}

function AssignOwnerModal({ hostel, onClose, onAssigned, onError }: {
  hostel: { id: string; name: string; address: string };
  onClose: () => void;
  onAssigned: (ownerName: string) => void;
  onError: (msg: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  const owners = useQuery({
    queryKey: ['admin', 'owners', search],
    queryFn: () => platformAdminService.getOwners({ search: search || undefined, limit: 20 }),
    staleTime: 30_000,
  });

  const assign = useMutation({
    mutationFn: () => platformAdminService.assignListingOwner(hostel.id, picked!.id),
    onSuccess: () => onAssigned(picked!.name),
    onError: () => onError('Could not hand over that listing'),
  });

  return (
    <Modal title="Assign this listing" subtitle={hostel.name} onClose={onClose}>
      <div className="px-6 py-5">
        {/* Matching a hostel to an owner by name is fuzzy, so the full address
            is shown and a pick must be confirmed — never auto-matched. */}
        <div className="mb-4 rounded-xl border border-[#F0DFC4] bg-[#FBF1DE] px-3.5 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#B8792B]">Confirm this is the right property</div>
          <div className="mt-1 text-[12px] leading-relaxed text-[#6E5B4E]">{hostel.address}</div>
        </div>

        <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-[#E7DDD1] bg-[#FCFAF7] px-3.5 py-2.5">
          <Search className="h-4 w-4 flex-none text-[#988D82]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPicked(null); }}
            placeholder="Search owners by name, email or phone…"
            className="w-full min-w-0 border-none bg-transparent text-[13px] text-[#2A2521] outline-none"
          />
        </div>

        <div className="max-h-[240px] overflow-auto rounded-xl border border-[#EFE6DA]">
          {owners.isLoading ? (
            <div className="py-8 text-center text-[12px] text-[#8A7F75]">Searching…</div>
          ) : (owners.data?.owners ?? []).length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#8A7F75]">No owners match that search.</div>
          ) : (
            (owners.data?.owners ?? []).map((o: any, i: number) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setPicked({ id: o.id, name: o.name })}
                className={`flex w-full items-center gap-3 px-3.5 py-3 text-left ${
                  i > 0 ? 'border-t border-[#F2ECE5]' : ''
                } ${picked?.id === o.id ? 'bg-[#F5E9E3]' : 'hover:bg-[#FCFAF7]'}`}
              >
                <span
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-admin text-[11px] font-bold text-white"
                  style={{ background: tintForId(o.id) }}
                >
                  {(o.name ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[#2A2521]">{o.name}</span>
                  <span className="block truncate text-[11px] text-[#9A8F84]">{o.email || o.phone || '—'}</span>
                </span>
                {picked?.id === o.id && (
                  <span className="flex-none text-[11px] font-bold text-[#B46A55]">Selected</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex gap-3 border-t border-[#F2ECE5] px-6 py-4">
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-[#E9DFD3] bg-white py-3 font-admin text-[13px] font-bold text-[#5A5147]">
          Cancel
        </button>
        <button
          type="button"
          disabled={!picked || assign.isPending}
          onClick={() => assign.mutate()}
          className="flex-[1.4] rounded-xl bg-[#1F7A52] py-3 font-admin text-[13px] font-bold text-white disabled:opacity-40"
        >
          {assign.isPending ? 'Handing over…' : picked ? `Hand to ${picked.name}` : 'Pick an owner'}
        </button>
      </div>
    </Modal>
  );
}
