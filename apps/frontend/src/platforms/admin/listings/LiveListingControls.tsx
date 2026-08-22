import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, EyeOff, PenLine, Power } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { useToast } from '../layout/toastContext';

/**
 * What an admin can do to a listing that is already approved and live.
 *
 * Until this existed the answer was nothing. Both `approve` and `reject` require
 * a revision in `PENDING_REVIEW`, so the moment a listing went live it left the
 * console's reach — a wrong price could only be dealt with by suspending the
 * whole hostel, taking a real verified hostel off Discovery to fix a sentence.
 *
 * Three levers, in increasing blast radius, and the labels say which is which
 * because that is the only thing the admin is really choosing between:
 *
 *   1. **Request changes** — page stays live, owner gets a draft and your note.
 *   2. **Unpublish** — page goes blank now, hostel stays on Discovery.
 *   3. **Suspend hostel** — the whole hostel comes off Discovery.
 *
 * Suspend already existed end to end on the backend and in the API wrapper, and
 * was wired to no button anywhere in the app.
 */

type Pending = 'REQUEST_CHANGES' | 'UNPUBLISH' | null;

interface LiveListingControlsProps {
  hostelId: string;
  hostelName: string;
  /** From the admin hostel GET — whether an APPROVED revision exists. */
  hasLiveListing: boolean;
  /** `PENDING_REVIEW` here means the queue already owns this hostel. */
  openStatus: string | null;
  listingStatus: string;
  onDone: () => void;
}

export function LiveListingControls({
  hostelId,
  hostelName,
  hasLiveListing,
  openStatus,
  listingStatus,
  onDone,
}: LiveListingControlsProps) {
  const fireToast = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');

  const suspended = listingStatus === 'SUSPENDED';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'hostel', hostelId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'hostels'] });
    queryClient.invalidateQueries({ queryKey: ['marketing', 'queue'] });
  };

  const act = useMutation({
    mutationFn: (action: 'REQUEST_CHANGES' | 'UNPUBLISH') =>
      platformAdminService.actOnLiveListing(hostelId, action, note.trim()),
    onSuccess: refresh,
  });

  const toggleSuspension = useMutation({
    mutationFn: () =>
      suspended
        ? platformAdminService.reactivateListing(hostelId)
        : platformAdminService.suspendListing(hostelId),
    onSuccess: refresh,
  });

  // Nothing live and not suspended: the normal review flow owns this hostel and
  // these controls would only be noise.
  if (!hasLiveListing && !suspended) return null;

  const queued = openStatus === 'PENDING_REVIEW';

  return (
    <div className="mb-3 rounded-2xl border border-[#EFE6DA] bg-white p-4">
      <div className="flex items-center gap-2">
        <Power className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: '#B46A55' }} />
        <div className="font-admin text-[13.5px] font-bold text-[#221E1A]">Live listing</div>
        <div className="flex-1" />
        <span
          className="rounded-full px-2 py-[3px] text-[10px] font-semibold"
          style={
            suspended
              ? { background: '#FBEFE9', color: '#B3402F' }
              : { background: '#EAF3EE', color: '#1F7A52' }
          }
        >
          {suspended ? 'Suspended' : hasLiveListing ? 'Live on Discovery' : 'No content live'}
        </span>
      </div>

      {pending === null ? (
        <>
          {queued && (
            <div className="mt-2.5 flex gap-2 rounded-[11px] bg-[#FBF1DE] p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-none" strokeWidth={2} style={{ color: '#B8792B' }} />
              <div className="text-[11.5px] leading-[1.5] text-[#8A6A31]">
                A new submission is already waiting for you below — review that instead of
                requesting changes on the live page.
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasLiveListing && (
              <>
                <button
                  type="button"
                  disabled={queued}
                  onClick={() => { setPending('REQUEST_CHANGES'); setNote(''); }}
                  className="flex items-center gap-1.5 rounded-[10px] border border-[#E9DFD3] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#5A5147] hover:border-[#B46A55] hover:text-[#B46A55] disabled:opacity-40 disabled:hover:border-[#E9DFD3] disabled:hover:text-[#5A5147]"
                >
                  <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
                  Request changes
                </button>
                <button
                  type="button"
                  onClick={() => { setPending('UNPUBLISH'); setNote(''); }}
                  className="flex items-center gap-1.5 rounded-[10px] border border-[#E6C7BF] bg-[#FBEFE9] px-3 py-2 font-admin text-[11.5px] font-bold text-[#B3402F]"
                >
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
                  Unpublish
                </button>
              </>
            )}
            <div className="flex-1" />
            <button
              type="button"
              disabled={toggleSuspension.isPending}
              onClick={async () => {
                try {
                  await toggleSuspension.mutateAsync();
                  fireToast(suspended ? 'Hostel is back on Discovery' : 'Hostel suspended from Discovery');
                  onDone();
                } catch {
                  fireToast('Could not change that', 'no');
                }
              }}
              className="rounded-[10px] border border-[#E9DFD3] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#8A7F75] hover:border-[#B3402F] hover:text-[#B3402F]"
            >
              {toggleSuspension.isPending
                ? 'Working…'
                : suspended
                  ? 'Reactivate hostel'
                  : 'Suspend whole hostel'}
            </button>
          </div>

          <p className="mt-2.5 text-[10.5px] leading-[1.5] text-[#B0A597]">
            Request changes leaves the page up while the owner fixes it. Unpublish blanks the
            listing but keeps the hostel on Discovery. Suspend removes the hostel entirely.
          </p>
        </>
      ) : (
        <div className="mt-3">
          <div className="mb-2 text-[11.5px] font-semibold text-[#5A5147]">
            {pending === 'UNPUBLISH'
              ? `Why is ${hostelName}'s listing coming down? The owner sees this.`
              : `What should ${hostelName} fix? The owner sees this.`}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder={
              pending === 'UNPUBLISH'
                ? 'The ₹4,500 tier does not exist at this hostel.'
                : 'The mess menu is from last term — please update it.'
            }
            className="w-full resize-none rounded-[11px] border border-[#E7DDD1] px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none focus:border-[#B46A55]"
          />
          {pending === 'UNPUBLISH' && (
            <p className="mt-2 text-[11px] leading-[1.5] text-[#B3402F]">
              The listing goes blank immediately. {hostelName} stays on Discovery with no
              details until the owner resubmits and you approve it.
            </p>
          )}
          <div className="mt-3 flex gap-2.5">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="flex-1 rounded-[10px] border border-[#E9DFD3] bg-white py-2.5 font-admin text-[12px] font-bold text-[#5A5147]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={act.isPending || !note.trim()}
              onClick={async () => {
                const action = pending;
                try {
                  await act.mutateAsync(action);
                  fireToast(
                    action === 'UNPUBLISH'
                      ? 'Listing unpublished — the owner has been told why'
                      : 'Changes requested — the page stays live meanwhile',
                  );
                  setPending(null);
                  setNote('');
                  onDone();
                } catch (error: any) {
                  fireToast(
                    error?.response?.data?.error?.message || 'Could not do that',
                    'no',
                  );
                }
              }}
              className="flex-[1.4] rounded-[10px] py-2.5 font-admin text-[12px] font-bold text-white disabled:opacity-40"
              style={{ background: pending === 'UNPUBLISH' ? '#B3402F' : '#B46A55' }}
            >
              {act.isPending
                ? 'Working…'
                : pending === 'UNPUBLISH'
                  ? 'Unpublish listing'
                  : 'Send request'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
